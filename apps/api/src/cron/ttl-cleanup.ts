/**
 * ADR-002 §13 — TTL cleanup cron.
 *
 * Audit log retention 2 yıl, call_logs retention 30 gün (KVKK §13.2.A),
 * print_jobs retention 30 gün (ADR-004 Amd5 — paket mutfak fişi payload'ı
 * müşteri PII'si taşır; security-reviewer KVKK aksiyonu), refresh_tokens
 * retention 37 gün (migration 002:16'da BEYAN EDİLMİŞ, S136'da uygulandı —
 * satırlar `ip_address`/`user_agent`/`device_label` tutar, IP KVKK'da kişisel
 * veridir).
 * Her gece 03:30 Europe/Istanbul'da dört bağımsız task koşar:
 *   - purgeAuditLogs   → audit_logs  WHERE created_at  < now() - 2 years
 *   - purgeCallLogs    → call_logs   WHERE received_at < now() - 30 days
 *   - purgePrintJobs   → print_jobs  WHERE status terminal (success/failed/
 *                        cancelled) AND updated_at < now() - 30 days
 *                        (queued/printing/retry ASLA silinmez — iş kaybı olmaz)
 *   - purgeRefreshTokens → refresh_tokens WHERE expires_at < now() - 7 days
 *                        (30 gün sliding TTL + 7 gün pay = beyan edilen 37 gün)
 *                        ⚠️ TEK İSTİSNA: bu task satır SİLMEZ, PII kolonlarını
 *                        NULL'lar (anonimleştirme). Gerekçe aşağıda.
 *
 * Tasarım kuralları (§13.2):
 *   - Tenant döngüsü: her tenant'a ayrı DELETE (cross-tenant impact yok).
 *   - Batch: LIMIT 10000 — büyük tablo'da tek DELETE lock yığmasın.
 *   - Advisory lock: çakışan node'lar varsa ikinci instance silent exit.
 *   - Self-audit: her task tamamlanınca tek `audit.purge` event (§13.4).
 *   - audit_logs ek pass: tenant_id IS NULL (system-actor satırlar).
 *   - call_logs/print_jobs: yalnız tenant-loop (system-actor yok).
 */
import cron, { type ScheduledTask } from 'node-cron';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { withTenant, type DB } from '@restoran-pos/db';
import { CRON_LOCK_IDS } from '@restoran-pos/shared-domain';
import { writeAudit } from '../audit/writeAudit.js';
import { logger } from '../logger.js';

const BATCH_LIMIT = 10_000;
const SCHEDULE_EXPR = '0 30 3 * * *';
const TIMEZONE = 'Europe/Istanbul';

const AUDIT_LOG_RETENTION_DAYS = 365 * 2; // 2 yıl
const CALL_LOG_RETENTION_DAYS = 30;
// ADR-004 Amd5 — payload.bytesBase64 paket fişinde müşteri PII'si taşır (KVKK).
const PRINT_JOB_RETENTION_DAYS = 30;
/**
 * `refresh_tokens` retention payı — cutoff `expires_at` ÜZERİNDEN ölçülür,
 * `issued_at` üzerinden DEĞİL.
 *
 * Migration `002_add_refresh_tokens.sql:16` KVKK notu "max 37 gün retention"
 * beyan ediyordu ama hiçbir çağıranı olmadığı için hiç uygulanmamıştı. Yeni bir
 * süre İCAT EDİLMEDİ, beyan edilen süre uygulandı: refresh TTL 30 gün (sliding,
 * `auth/refresh.ts:13` `THIRTY_DAYS_MS`) + 7 gün pay = **37 gün**. `expires_at`
 * zaten `issued_at + 30 gün` olduğu için tek yüklem yeterlidir ve hem süresi
 * dolmuşları hem revoke edilmişleri kapsar (revoke edilen satırın `expires_at`'i
 * değişmez, yani en geç 30 günde o da yaşlanır).
 *
 * 🔴 NEDEN SİLME DEĞİL ANONİMLEŞTİRME — bu yorumun İLK HÂLİ YANLIŞTI.
 *
 * İlk yazımda burada "silme reuse-detection'a zarar vermez, çünkü expire olmuş
 * bir ailede iptal edilecek canlı token kalmamıştır" deniyordu. Güvenlik
 * denetimi bu öncülü **çürüttü**: TTL **sliding** olduğu için uzun ömürlü bir
 * ailenin 37 günü aşmış bir atası varken ailenin head'i pekâlâ CANLI olur
 * (her gün kullanılan bir cihaz Temmuz'dan beri aynı aileyi yeniliyor). O eski
 * ata satır silinirse ve o token çalınıp sunulursa davranış şöyle ayrışır:
 *   • satır DURUYORSA → `findByTokenHash` bulur, `revoked_at` yaşı grace
 *     penceresinin üstündedir → `revokeFamilyAll('reuse_detected')` koşar:
 *     **canlı oturum kapanır** + `logger.warn` izi düşer (containment).
 *   • satır SİLİNMİŞSE → bulunamaz → `AUTH_REFRESH_INVALID`: **canlı oturum
 *     devam eder ve hiçbir iz kalmaz** (containment + telemetri KAYBI).
 * Erişim etkisi iki durumda da aynıdır (token zaten expire → 401); kaybolan şey
 * erişim engeli değil, **sınırlama ve görünürlük**tür.
 *
 * Bu yüzden ürün sahibi kararı: **anonimleştir, silme.** `ip_address`,
 * `user_agent`, `device_label` NULL'lanır (KVKK m.7 yükümlülüğü anonimleştirme
 * ile karşılanır — ADR-003 §8.3 emsali: müşteri silme yerine anonimleştirme);
 * `token_hash` + `family_id` + `revoked_at` + `revoked_reason` **süresiz** kalır
 * → reuse-detection hiç kör kalmaz. GRANT tarafı: migration 067, yalnız bu üç
 * kolonda UPDATE (kolon-seviyesi, bilinçli daraltma).
 *
 * 🔎 Grace penceresi **10 dk DEĞİL** (ilk yorumdaki ikinci olgusal hata):
 * varsayılan **60 sn**, tavan **5 dk** (`config/authConfig.ts:10,13` —
 * `DEFAULT_REFRESH_GRACE_MS` / `MAX_REFRESH_GRACE_MS`). 10 dk olan
 * `GRACE_ABUSE_WINDOW_MS`'tir, o da ayrı bir şeyi sayar (grace kurtarma
 * sayısının tavanı). Pencere ne kadar kısa olursa 37 gün önceki bir satırın
 * yaşı grace'in o kadar üstünde olur → yukarıdaki `reuse_detected` yolu
 * **kesin**dir, sınırda bir durum değil.
 */
const REFRESH_TOKEN_GRACE_DAYS = 7;

/**
 * Watchdog'un "yapacak iş var mıydı" oracle'ı bu sabiti kullanır
 * (`cron/retention-watchdog.ts`). Export edilmesi bilinçli: iki yerde elle
 * yazılan `7` birbirinden sessizce ayrışabilirdi ve o ayrışma yanlış alarm
 * (veya alarmın hiç çalmaması) olarak görünürdü.
 */
export { REFRESH_TOKEN_GRACE_DAYS };

export interface TtlCleanupDeps {
  pool: Pool;
  db: Kysely<DB>;
}

/**
 * Try to acquire a session-level advisory lock. Returns null if lock failed
 * (another instance running) — caller must silent-exit.
 *
 * Lock holder = pool client. Caller MUST release via `releaseLock(client, id)`
 * in `finally`. Released-or-throw kuralı: client.release() finally'de.
 */
export async function tryAcquireLock(
  pool: Pool,
  lockId: bigint,
): Promise<{ release: () => Promise<void> } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockId.toString()],
    );
    if (res.rows[0]?.acquired !== true) {
      client.release();
      return null;
    }
    return {
      release: async () => {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [
            lockId.toString(),
          ]);
        } finally {
          client.release();
        }
      },
    };
  } catch (err) {
    client.release();
    throw err;
  }
}

interface BatchOutcome {
  deleted: number;
  batches: number;
}

/**
 * audit_logs için batch DELETE — bir tenant scope'u (tenantId NULL ise
 * system-actor satırlar).
 */
async function batchDeleteAuditLogs(
  db: Kysely<DB>,
  tenantId: string | null,
  cutoffIso: string,
): Promise<BatchOutcome> {
  let deleted = 0;
  let batches = 0;
  // Loop until affected_rows < BATCH_LIMIT.
  // CTE pattern: DELETE ... WHERE id IN (SELECT id ... LIMIT N).
  for (;;) {
    const result = await sql<{ deleted_id: string }>`
      WITH victims AS (
        SELECT id
          FROM audit_logs
         WHERE created_at < ${cutoffIso}::timestamptz
           AND ${tenantId === null ? sql`tenant_id IS NULL` : sql`tenant_id = ${tenantId}::uuid`}
         LIMIT ${BATCH_LIMIT}
      )
      DELETE FROM audit_logs
       USING victims
       WHERE audit_logs.id = victims.id
       RETURNING audit_logs.id AS deleted_id
    `.execute(db);
    const affected = result.rows.length;
    deleted += affected;
    batches += 1;
    if (affected < BATCH_LIMIT) break;
  }
  return { deleted, batches };
}

async function batchDeleteCallLogs(
  db: Kysely<DB>,
  tenantId: string,
  cutoffIso: string,
): Promise<BatchOutcome> {
  let deleted = 0;
  let batches = 0;
  for (;;) {
    const result = await sql<{ deleted_id: string }>`
      WITH victims AS (
        SELECT id
          FROM call_logs
         WHERE received_at < ${cutoffIso}::timestamptz
           AND tenant_id = ${tenantId}::uuid
         LIMIT ${BATCH_LIMIT}
      )
      DELETE FROM call_logs
       USING victims
       WHERE call_logs.id = victims.id
       RETURNING call_logs.id AS deleted_id
    `.execute(db);
    const affected = result.rows.length;
    deleted += affected;
    batches += 1;
    if (affected < BATCH_LIMIT) break;
  }
  return { deleted, batches };
}

/**
 * ADR-041 Amd4 K3 — print_jobs RLS: tenant context BATCH BAŞINA açılır.
 *
 * Sarım bilinçli olarak bu helper'ın İÇİNDE, `for(;;)` döngüsünün içinde:
 * batch döngüsü burada olduğu için çağırana konan tek bir `withTenant`
 * TÜM batch'leri tek transaction'a alırdı → `LIMIT 10000` × N satırlık
 * DELETE tek tx'te lock yığar. `batchDeleteCallLogs` çağıranda sarılıdır
 * (o hacim batch-limitin çok altında, tek tx sorun değil); print_jobs fiş
 * hacmi büyük olduğu için o gerekçe BURADA GEÇERSİZ.
 *
 * Yan fayda: yeni bir çağıran sarımı unutamaz (F4d-1'in tz.ts/tenant-info.ts
 * "sarımı helper'a göm" deseni).
 *
 * ⚠️ Bu yüzden `db` bir `Transaction` OLMAMALI — `withTenant` kendi
 * transaction'ını açar. Çağıran `deps.db` (Kysely) verir.
 *
 * Sarım olmadan: DELETE 0 satır döner, exception FIRLATMAZ, catch yalnız
 * logger.error'a düşer → KVKK retention sessizce ölür ve audit
 * `deleted_count: 0` yazar (Amd4 K5 sessiz-bozulma sınıfı).
 */
async function batchDeletePrintJobs(
  db: Kysely<DB>,
  tenantId: string,
  cutoffIso: string,
): Promise<BatchOutcome> {
  let deleted = 0;
  let batches = 0;
  for (;;) {
    // Yalnız TERMİNAL statüler silinir — queued/printing/retry iş kuyruğudur,
    // retention onlara DOKUNMAZ (Print Agent henüz basmadı → iş kaybı olurdu).
    const result = await withTenant(db, tenantId, (trx) =>
      sql<{ deleted_id: string }>`
      WITH victims AS (
        SELECT id
          FROM print_jobs
         WHERE status IN ('success', 'failed', 'cancelled')
           AND updated_at < ${cutoffIso}::timestamptz
           AND tenant_id = ${tenantId}::uuid
         LIMIT ${BATCH_LIMIT}
      )
      DELETE FROM print_jobs
       USING victims
       WHERE print_jobs.id = victims.id
       RETURNING print_jobs.id AS deleted_id
    `.execute(trx),
    );
    const affected = result.rows.length;
    deleted += affected;
    batches += 1;
    if (affected < BATCH_LIMIT) break;
  }
  return { deleted, batches };
}

/**
 * Anonimleştirme sonucu. Bilinçli olarak `BatchOutcome`'dan AYRI tip: diğer üç
 * task gerçekten siliyor, bu task satır sayısını hiç değiştirmiyor. Tek tipi
 * paylaşmak `deleted` alanının bir çağırıda "silinen", diğerinde
 * "anonimleştirilen" anlamına gelmesine yol açardı.
 */
interface AnonymizeOutcome {
  anonymized: number;
  batches: number;
}

/**
 * `refresh_tokens` için batch ANONİMLEŞTİRME (UPDATE) — bir tenant scope'u.
 *
 * Satır SİLİNMEZ; yalnız üç PII kolonu NULL'lanır. Gerekçe
 * `REFRESH_TOKEN_GRACE_DAYS` JSDoc'unda (containment + telemetri korunur),
 * GRANT tarafı migration 067'de (kolon-seviyesi UPDATE).
 *
 * ⚠️ İKİNCİ YÜKLEM (`… IS NOT NULL`) ŞARTTIR, kozmetik değil — İKİ sebeple:
 *   1. **Sayaç/alarm doğruluğu:** onsuz aynı satırlar HER GECE yeniden UPDATE
 *      edilir (NULL'a NULL yazmak da bir satır günceller) → `audit.purge` izinin
 *      sayacı sürekli şişer, watchdog'un "anlamlı iş yapıldı mı" sinyali
 *      anlamsızlaşır ve WAL'a her gece gereksiz yazma düşer.
 *   2. **Döngü sonlanması:** `for(;;)` döngüsü "etkilenen satır < BATCH_LIMIT"
 *      ile biter. Guard olmadan victim kümesi hiç küçülmez → 10k'dan fazla
 *      uygun satır olduğu an döngü **sonsuza** girer. Yani bu yüklem aynı
 *      zamanda bir sonlanma koşuludur.
 * Birlikte: ilk koşum büyük (prod'da tüm geçmiş), sonraki koşumlar yalnız o gün
 * yaşlananları işler.
 *
 * ⚠️ `withTenant` sarımı YOK ve olmamalı. Gerçek gerekçe: bu task prod'da
 * **paylaşımlı cron pool'u** (`cron_purger`, BYPASSRLS) ile koşar — aynı pool
 * `purgeAuditLogs`'un NULL-tenant pass'i ve dört task'ın NULL-tenant self-audit
 * INSERT'i için teknik ZORUNLULUK (mig 063 SELECT/INSERT policy'si NULL'ı
 * dışlar). BYPASSRLS rolde `withTenant` sarmak hiçbir şey eklemez, yalnız her
 * batch'i gereksiz bir transaction'a alır.
 * 🔎 Not: "`refresh_tokens`'ta NULL-tenant satır var" gerekçesi YANLIŞ olurdu —
 * `tenant_id` bu tabloda NOT NULL. Sarımsızlığın sebebi tablonun kendisi değil,
 * pool'un paylaşımlı olmasıdır.
 * `tenant_id` yüklemi yine de yazılıdır: tenant-loop izolasyonu RLS'e değil
 * SORGUYA dayanır (§13.2).
 */
async function batchAnonymizeRefreshTokens(
  db: Kysely<DB>,
  tenantId: string,
  cutoffIso: string,
): Promise<AnonymizeOutcome> {
  let anonymized = 0;
  let batches = 0;
  for (;;) {
    const result = await sql<{ anonymized_id: string }>`
      WITH victims AS (
        SELECT id
          FROM refresh_tokens
         WHERE expires_at < ${cutoffIso}::timestamptz
           AND tenant_id = ${tenantId}::uuid
           AND (ip_address IS NOT NULL
                OR user_agent IS NOT NULL
                OR device_label IS NOT NULL)
         LIMIT ${BATCH_LIMIT}
      )
      UPDATE refresh_tokens
         SET ip_address = NULL, user_agent = NULL, device_label = NULL
        FROM victims
       WHERE refresh_tokens.id = victims.id
       RETURNING refresh_tokens.id AS anonymized_id
    `.execute(db);
    const affected = result.rows.length;
    anonymized += affected;
    batches += 1;
    if (affected < BATCH_LIMIT) break;
  }
  return { anonymized, batches };
}

function cutoffIso(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

async function listTenantIds(db: Kysely<DB>): Promise<string[]> {
  const rows = await db
    .selectFrom('tenants')
    .select('id')
    .where('deleted_at', 'is', null)
    .execute();
  return rows.map((r) => r.id);
}

/**
 * audit_logs (2 yıl) purge task. Advisory lock + tenant-loop + system-actor pass.
 * §13.4 self-audit: tek `audit.purge` event yazılır.
 */
export async function purgeAuditLogs(deps: TtlCleanupDeps): Promise<void> {
  const startedAt = Date.now();
  const lock = await tryAcquireLock(
    deps.pool,
    CRON_LOCK_IDS.TTL_CLEANUP_AUDIT_LOGS,
  );
  if (lock === null) {
    logger.warn(
      { task: 'audit_logs' },
      '[ttl-cleanup] advisory lock taken; silent exit',
    );
    return;
  }
  let totalDeleted = 0;
  let totalBatches = 0;
  const cutoff = cutoffIso(AUDIT_LOG_RETENTION_DAYS);
  try {
    const tenantIds = await listTenantIds(deps.db);
    for (const tenantId of tenantIds) {
      try {
        const t0 = Date.now();
        const out = await batchDeleteAuditLogs(deps.db, tenantId, cutoff);
        totalDeleted += out.deleted;
        totalBatches += out.batches;
        logger.info(
          {
            task: 'audit_logs',
            tenant_id: tenantId,
            deleted_count: out.deleted,
            batch_count: out.batches,
            duration_ms: Date.now() - t0,
          },
          '[ttl-cleanup] audit_logs tenant batch done',
        );
        if (out.deleted > 0 && out.deleted % BATCH_LIMIT === 0) {
          logger.warn(
            { task: 'audit_logs', tenant_id: tenantId, deleted: out.deleted },
            '[ttl-cleanup] retention pressure: hit BATCH_LIMIT exactly',
          );
        }
      } catch (err) {
        logger.error(
          { task: 'audit_logs', tenant_id: tenantId, err },
          '[ttl-cleanup] audit_logs tenant batch failed',
        );
      }
    }
    // System-actor pass (tenant_id IS NULL).
    try {
      const t0 = Date.now();
      const out = await batchDeleteAuditLogs(deps.db, null, cutoff);
      totalDeleted += out.deleted;
      totalBatches += out.batches;
      logger.info(
        {
          task: 'audit_logs',
          tenant_id: null,
          deleted_count: out.deleted,
          batch_count: out.batches,
          duration_ms: Date.now() - t0,
        },
        '[ttl-cleanup] audit_logs system-actor batch done',
      );
    } catch (err) {
      logger.error(
        { task: 'audit_logs', tenant_id: null, err },
        '[ttl-cleanup] audit_logs system-actor batch failed',
      );
    }
    // Self-audit (§13.4) — tek event, tenantId=null sistem actor.
    try {
      await writeAudit(deps.db, {
        tenantId: null,
        eventType: 'audit.purge',
        actorUserId: null,
        actor: { user_agent: 'cron/ttl-cleanup' },
        rawPayload: {
          table: 'audit_logs',
          deleted_count: totalDeleted,
          batch_count: totalBatches,
          duration_ms: Date.now() - startedAt,
          cutoff_date: cutoff,
        },
      });
    } catch (err) {
      logger.error(
        { task: 'audit_logs', err },
        '[ttl-cleanup] self-audit write failed',
      );
    }
  } finally {
    await lock.release();
  }
}

/**
 * call_logs (30 gün) purge task. Advisory lock + tenant-loop only.
 * KVKK §13.2.A retention.
 */
export async function purgeCallLogs(deps: TtlCleanupDeps): Promise<void> {
  const startedAt = Date.now();
  const lock = await tryAcquireLock(
    deps.pool,
    CRON_LOCK_IDS.TTL_CLEANUP_CALL_LOGS,
  );
  if (lock === null) {
    logger.warn(
      { task: 'call_logs' },
      '[ttl-cleanup] advisory lock taken; silent exit',
    );
    return;
  }
  let totalDeleted = 0;
  let totalBatches = 0;
  const cutoff = cutoffIso(CALL_LOG_RETENTION_DAYS);
  try {
    const tenantIds = await listTenantIds(deps.db);
    for (const tenantId of tenantIds) {
      try {
        const t0 = Date.now();
        // ADR-041 F4a — call_logs RLS: per-tenant DELETE tenant context altında
        // koşmalı (aksi halde app_tenant fail-closed 0 satır siler → retention
        // sessizce kırılır). NULL-tenant call_logs yok → cron_purger gerekmez;
        // withTenant yeterli (Amd3 F4a-revizyonu). call_logs hacmi batch-limitin
        // çok altında → tek tx sorun değil.
        const out = await withTenant(deps.db, tenantId, (trx) =>
          batchDeleteCallLogs(trx, tenantId, cutoff),
        );
        totalDeleted += out.deleted;
        totalBatches += out.batches;
        logger.info(
          {
            task: 'call_logs',
            tenant_id: tenantId,
            deleted_count: out.deleted,
            batch_count: out.batches,
            duration_ms: Date.now() - t0,
          },
          '[ttl-cleanup] call_logs tenant batch done',
        );
        if (out.deleted > 0 && out.deleted % BATCH_LIMIT === 0) {
          logger.warn(
            { task: 'call_logs', tenant_id: tenantId, deleted: out.deleted },
            '[ttl-cleanup] retention pressure: hit BATCH_LIMIT exactly',
          );
        }
      } catch (err) {
        logger.error(
          { task: 'call_logs', tenant_id: tenantId, err },
          '[ttl-cleanup] call_logs tenant batch failed',
        );
      }
    }
    try {
      await writeAudit(deps.db, {
        tenantId: null,
        eventType: 'audit.purge',
        actorUserId: null,
        actor: { user_agent: 'cron/ttl-cleanup' },
        rawPayload: {
          table: 'call_logs',
          deleted_count: totalDeleted,
          batch_count: totalBatches,
          duration_ms: Date.now() - startedAt,
          cutoff_date: cutoff,
        },
      });
    } catch (err) {
      logger.error(
        { task: 'call_logs', err },
        '[ttl-cleanup] self-audit write failed',
      );
    }
  } finally {
    await lock.release();
  }
}

/**
 * print_jobs (30 gün, yalnız terminal statüler) purge task. Advisory lock +
 * tenant-loop. ADR-004 Amd5 KVKK aksiyonu: paket mutfak fişi payload'ı
 * müşteri adı/telefon/adres taşır — base64 kodlamadır, şifreleme değil;
 * süresiz tutulamaz.
 */
export async function purgePrintJobs(deps: TtlCleanupDeps): Promise<void> {
  const startedAt = Date.now();
  const lock = await tryAcquireLock(
    deps.pool,
    CRON_LOCK_IDS.TTL_CLEANUP_PRINT_JOBS,
  );
  if (lock === null) {
    logger.warn(
      { task: 'print_jobs' },
      '[ttl-cleanup] advisory lock taken; silent exit',
    );
    return;
  }
  let totalDeleted = 0;
  let totalBatches = 0;
  const cutoff = cutoffIso(PRINT_JOB_RETENTION_DAYS);
  try {
    const tenantIds = await listTenantIds(deps.db);
    for (const tenantId of tenantIds) {
      try {
        const t0 = Date.now();
        const out = await batchDeletePrintJobs(deps.db, tenantId, cutoff);
        totalDeleted += out.deleted;
        totalBatches += out.batches;
        logger.info(
          {
            task: 'print_jobs',
            tenant_id: tenantId,
            deleted_count: out.deleted,
            batch_count: out.batches,
            duration_ms: Date.now() - t0,
          },
          '[ttl-cleanup] print_jobs tenant batch done',
        );
        if (out.deleted > 0 && out.deleted % BATCH_LIMIT === 0) {
          logger.warn(
            { task: 'print_jobs', tenant_id: tenantId, deleted: out.deleted },
            '[ttl-cleanup] retention pressure: hit BATCH_LIMIT exactly',
          );
        }
      } catch (err) {
        logger.error(
          { task: 'print_jobs', tenant_id: tenantId, err },
          '[ttl-cleanup] print_jobs tenant batch failed',
        );
      }
    }
    try {
      await writeAudit(deps.db, {
        tenantId: null,
        eventType: 'audit.purge',
        actorUserId: null,
        actor: { user_agent: 'cron/ttl-cleanup' },
        rawPayload: {
          table: 'print_jobs',
          deleted_count: totalDeleted,
          batch_count: totalBatches,
          duration_ms: Date.now() - startedAt,
          cutoff_date: cutoff,
        },
      });
    } catch (err) {
      logger.error(
        { task: 'print_jobs', err },
        '[ttl-cleanup] self-audit write failed',
      );
    }
  } finally {
    await lock.release();
  }
}

/**
 * `refresh_tokens` (37 gün) ANONİMLEŞTİRME task'ı. Advisory lock + tenant-loop.
 *
 * KVKK m.7 — satırlar `ip_address` (INET, düz metin) + `user_agent` +
 * `device_label` tutar; IP KVKK'da kişisel veridir. Retention migration
 * `002:16`'da beyan edilmişti ama `deleteExpired()`'in hiçbir çağıranı
 * olmadığı için **hiç uygulanmamıştı**: S136 ölçümünde prod'da 4434 satırın
 * en eskisi 2026-07-04 tarihliydi. Bu task o boşluğu kapatır.
 *
 * ⚠️ DÖRT TASK'IN TEK İSTİSNASI: satır SİLMEZ, üç PII kolonunu NULL'lar.
 * Gerekçe `REFRESH_TOKEN_GRACE_DAYS` JSDoc'unda — silme, sliding TTL yüzünden
 * hâlâ canlı bir ailenin eski atasını yok ederek reuse-detection'ın
 * containment + telemetri yolunu kaybediyordu.
 *
 * ⚠️ AKTİF OTURUMLARA DOKUNMAZ: yüklem `expires_at < now() - 7 gün`. Aktif bir
 * token'ın `expires_at`'i gelecektedir → hiçbir koşulda cutoff'un altına
 * düşmez. En kritik regresyon canlı oturumun PII'sini (veya daha kötüsü
 * `token_hash`'ini) bozmaktır ve testte ayrıca assert edilir.
 */
export async function purgeRefreshTokens(deps: TtlCleanupDeps): Promise<void> {
  const startedAt = Date.now();
  const lock = await tryAcquireLock(
    deps.pool,
    CRON_LOCK_IDS.TTL_CLEANUP_REFRESH_TOKENS,
  );
  if (lock === null) {
    logger.warn(
      { task: 'refresh_tokens' },
      '[ttl-cleanup] advisory lock taken; silent exit',
    );
    return;
  }
  let totalAnonymized = 0;
  let totalBatches = 0;
  const cutoff = cutoffIso(REFRESH_TOKEN_GRACE_DAYS);
  try {
    const tenantIds = await listTenantIds(deps.db);
    for (const tenantId of tenantIds) {
      try {
        const t0 = Date.now();
        const out = await batchAnonymizeRefreshTokens(
          deps.db,
          tenantId,
          cutoff,
        );
        totalAnonymized += out.anonymized;
        totalBatches += out.batches;
        logger.info(
          {
            task: 'refresh_tokens',
            tenant_id: tenantId,
            anonymized_count: out.anonymized,
            batch_count: out.batches,
            duration_ms: Date.now() - t0,
          },
          '[ttl-cleanup] refresh_tokens tenant batch done (anonymized)',
        );
        if (out.anonymized > 0 && out.anonymized % BATCH_LIMIT === 0) {
          logger.warn(
            {
              task: 'refresh_tokens',
              tenant_id: tenantId,
              anonymized: out.anonymized,
            },
            '[ttl-cleanup] retention pressure: hit BATCH_LIMIT exactly',
          );
        }
      } catch (err) {
        logger.error(
          { task: 'refresh_tokens', tenant_id: tenantId, err },
          '[ttl-cleanup] refresh_tokens tenant batch failed',
        );
      }
    }
    try {
      await writeAudit(deps.db, {
        tenantId: null,
        eventType: 'audit.purge',
        actorUserId: null,
        actor: { user_agent: 'cron/ttl-cleanup' },
        rawPayload: {
          table: 'refresh_tokens',
          // ⚠️ ALAN ADI BİLİNÇLİ OLARAK `deleted_count` KALDI, `anonymized_count`
          // YAPILMADI: `audit.purge` payload'ı bir **kontrat**tır ve okuyucusu
          // retention watchdog'udur (`retention-watchdog.ts` →
          // `payload->>'deleted_count'`). Yeniden adlandırmak watchdog'u sessizce
          // kör ederdi — tam olarak Amd6'nın engellemek için var olduğu
          // sessiz-bozulma sınıfı ([[feedback_adr_sibling_drift]]). Anlam
          // farkını adın yerine AYRI bir alan taşır:
          operation: 'anonymize',
          deleted_count: totalAnonymized,
          batch_count: totalBatches,
          duration_ms: Date.now() - startedAt,
          cutoff_date: cutoff,
        },
      });
    } catch (err) {
      logger.error(
        { task: 'refresh_tokens', err },
        '[ttl-cleanup] self-audit write failed',
      );
    }
  } finally {
    await lock.release();
  }
}

/**
 * Schedule all tasks daily at 03:30 Europe/Istanbul.
 * Returns the scheduled task handle so callers can stop it (tests).
 */
export function startTtlCleanup(deps: TtlCleanupDeps): ScheduledTask {
  const task = cron.schedule(
    SCHEDULE_EXPR,
    () => {
      void (async () => {
        try {
          await purgeAuditLogs(deps);
        } catch (err) {
          logger.error({ err }, '[ttl-cleanup] purgeAuditLogs crashed');
        }
        try {
          await purgeCallLogs(deps);
        } catch (err) {
          logger.error({ err }, '[ttl-cleanup] purgeCallLogs crashed');
        }
        try {
          await purgePrintJobs(deps);
        } catch (err) {
          logger.error({ err }, '[ttl-cleanup] purgePrintJobs crashed');
        }
        try {
          await purgeRefreshTokens(deps);
        } catch (err) {
          logger.error({ err }, '[ttl-cleanup] purgeRefreshTokens crashed');
        }
      })();
    },
    { timezone: TIMEZONE },
  );
  logger.info(
    { schedule: SCHEDULE_EXPR, timezone: TIMEZONE },
    '[ttl-cleanup] scheduled',
  );
  return task;
}
