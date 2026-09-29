import cron, { type ScheduledTask } from 'node-cron';
import { sql, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { DB } from '@restoran-pos/db';
import { CRON_LOCK_IDS } from '@restoran-pos/shared-domain';
import { logger } from '../logger.js';
import { captureError } from '../observability/sentry.js';
import { tryAcquireLock } from './ttl-cleanup.js';

/**
 * ADR-041 Amendment 6 — retention watchdog: **sessiz-bozulma alarmı**.
 *
 * Gece 03:30 TTL-cleanup cron'unun (`ttl-cleanup.ts`) üç task'ının GERÇEKTEN
 * koştuğunu, bıraktıkları `audit.purge` izlerinden doğrular. Bir DoD borcunun
 * kapatılmasıdır (Amd4 K6 + Amd5), yeni özellik değil.
 *
 * ⚠️ NEDEN KOD, NEDEN SENTRY KURALI DEĞİL: `observability/sentry.ts` yalnız
 * **exception** görür (`captureError` → `captureException`; `errorHandler.ts`
 * 5xx'te çağırır). Sessiz bozulmada fırlatılan hata YOKTUR → Sentry'ye hiçbir
 * şey ulaşmaz. Alarm zorunlu olarak uygulama içinde **aktif bir kontrol** olmalı.
 *
 * S134'te bu borcun teorik olmadığı iki kez görüldü: (1) `purgePrintJobs`
 * süperuser pool altında sahte-yeşildi — sarım sökülüyken de test 4/4 geçiyordu;
 * (2) cron self-audit'leri `42501` alıp task'ın `try/catch`'ine yutuluyordu —
 * test yeşil, log kırmızı. İkisi de ancak ELLE bakınca çıktı.
 *
 * ⚠️ KAPSAMIN SINIRI (Amd6 Trade-off): bu watchdog "cron koştu ama task'ı
 * sessizce başarısız oldu mu" sorusunu çözer; **"cron süreci yaşıyor mu"
 * sorusunu ÇÖZMEZ**. Scheduler ölürse (süreç çökmesi, `DISABLE_CRON=1`)
 * watchdog da ölür ve sessizlik geri döner — bunu kapatmak harici bir monitör
 * ister (kapsam dışı, bilinçli kalıntı).
 */

/** Amd6 K1 — 09:00; gece cron'unun İÇİNE konamaz (tavuk-yumurta). */
const SCHEDULE_EXPR = '0 0 9 * * *';
const TIMEZONE = 'Europe/Istanbul';

/** Amd6 K2 — 24 saat + tolerans (DST geçişi ve gecikmeli koşum için). */
const WINDOW_HOURS = 26;

/**
 * Amd6 K3 — izlenen task'lar ve `deleted_count: 0` durumunun yorumu.
 *
 * ⚠️ `audit_logs` için 0 **NORMALDİR**: retention 2 yıl ve prod'daki en eski
 * kayıt 2026-07-04 → ilk gerçek silme 2028'de. Bu ayrım olmadan watchdog HER
 * GÜN yanlış alarm çalar, alarm yorgunluğu yaratır ve asıl sinyali gömerdi.
 * (2028 civarında bu istisna gözden geçirilmeli — o tarihten sonra 0 dönmesi
 * şüpheli hâle gelir.)
 */
const WATCHED_TASKS = [
  { table: 'audit_logs', zeroIsSuspicious: false },
  { table: 'call_logs', zeroIsSuspicious: true },
  { table: 'print_jobs', zeroIsSuspicious: true },
] as const;

export interface RetentionWatchdogDeps {
  /** ⚠️ Amd6 K5 — `cron_purger` (BYPASSRLS) pool'u ZORUNLU, aşağıya bakın. */
  pool: Pool;
  db: Kysely<DB>;
}

interface PurgeTrace {
  table: string;
  deletedCount: number;
  createdAt: Date;
}

/**
 * Pencere içindeki `audit.purge` izlerini okur.
 *
 * ⚠️ Amd6 K5 — bu sorgu `tenant_id IS NULL` (sistem-actor) satırları okur ve
 * migration 063'ün SELECT policy'si NULL'ı **dışlar**. Yani `app_tenant` ile
 * koşulursa sonuç HER ZAMAN boş döner ve watchdog "hiç task koşmamış" sanıp
 * **sürekli yanlış alarm** üretir. `cron_purger` (BYPASSRLS + `audit_logs`
 * SELECT grant'i, Amd5'te canlıya indi) teknik bir zorunluluktur, tercih değil.
 */
async function readPurgeTraces(db: Kysely<DB>): Promise<PurgeTrace[]> {
  const res = await sql<{
    table: string | null;
    deleted_count: string | null;
    created_at: Date;
  }>`
    SELECT payload->>'table'         AS table,
           payload->>'deleted_count' AS deleted_count,
           created_at
      FROM audit_logs
     WHERE tenant_id IS NULL
       AND event_type = 'audit.purge'
       AND created_at > now() - make_interval(hours => ${WINDOW_HOURS})
     ORDER BY created_at DESC
  `.execute(db);

  return res.rows.flatMap((r) => {
    if (r.table === null) return [];
    // ⚠️ Bozuk payload SESSİZ GEÇMESİN (qa bulgusu): `Number('abc')` → NaN ve
    // `NaN === 0` false olduğu için şüpheli-sıfır kontrolü atlanır, yani alarm
    // hiç çıkmaz. Sayıya çevrilemeyen bir değer "0 silinmiş" sayılır
    // (fail-closed) — yanlış alarm, sessizlikten iyidir.
    const parsed = Number(r.deleted_count ?? 0);
    return [
      {
        table: r.table,
        deletedCount: Number.isFinite(parsed) ? parsed : 0,
        createdAt: r.created_at,
      },
    ];
  });
}

/**
 * Tek koşum — schedule dışında da çağrılabilir (test + elle doğrulama).
 * Bulunan alarmların metinlerini döner (boş dizi = her şey sağlıklı).
 */
export async function runRetentionWatchdog(
  deps: RetentionWatchdogDeps,
): Promise<string[]> {
  const lock = await tryAcquireLock(
    deps.pool,
    CRON_LOCK_IDS.RETENTION_WATCHDOG,
  );
  if (lock === null) {
    // Başka bir instance koşuyor — sessiz çık (ttl-cleanup deseni).
    logger.info('[watchdog] advisory lock alınamadı, atlanıyor');
    return [];
  }

  const alerts: string[] = [];
  try {
    const traces = await readPurgeTraces(deps.db);

    // ⚠️ Task başına TOPLA — "en yeni izi al" YANLIŞ olur (qa bulgusu, S134):
    // cron bir gecede iki kez koşabilir (`pm2 restart`, elle tetikleme) ve
    // İKİNCİ koşum daima `deleted_count: 0` bırakır (ilki zaten silmiştir).
    // En yeni ize bakan bir watchdog bu durumda **yanlış alarm** çalar — yani
    // sağlıklı bir sistemi arızalı gösterir, ki bu watchdog'un en büyük
    // başarısızlık modudur (alarm yorgunluğu). Doğru soru "bu task son 26
    // saatte anlamlı iş yaptı mı" → pencere içindeki toplam.
    const byTable = new Map<string, { traceCount: number; totalDeleted: number }>();
    for (const t of traces) {
      const cur = byTable.get(t.table) ?? { traceCount: 0, totalDeleted: 0 };
      byTable.set(t.table, {
        traceCount: cur.traceCount + 1,
        totalDeleted: cur.totalDeleted + t.deletedCount,
      });
    }

    for (const task of WATCHED_TASKS) {
      const agg = byTable.get(task.table);

      if (agg === undefined) {
        // Amd6 K3 — task hiç koşmamış (veya self-audit'i yazılamamış).
        alerts.push(
          `[watchdog] retention task '${task.table}' son ${WINDOW_HOURS} saatte audit.purge izi BIRAKMADI — cron koşmadı veya self-audit sessizce başarısız oldu`,
        );
        continue;
      }

      if (task.zeroIsSuspicious && agg.totalDeleted === 0) {
        // Amd6 K3 — 0 satır silinmiş: retention sessizce ölmüş olabilir.
        // `audit_logs` bu kontrolden MUAF (2 yıl TTL → 2028'e kadar 0 normal).
        alerts.push(
          `[watchdog] retention task '${task.table}' koştu ama deleted_count=0 — RLS context'i veya yetki sessizce kırılmış olabilir`,
        );
      }
    }

    if (alerts.length === 0) {
      logger.info(
        {
          tasks: [...byTable].map(
            ([table, a]) => `${table}:${a.totalDeleted}(${a.traceCount}iz)`,
          ),
        },
        '[watchdog] retention sağlıklı — üç task da iz bıraktı',
      );
      return alerts;
    }

    for (const message of alerts) {
      // Amd6 K4 — yeni Sentry yüzeyi açılmaz: sentetik Error mevcut
      // `captureError` kanalından geçer, yani ADR-040'ın `beforeSend` →
      // `deepRedact` PII temizliği aynen uygulanır ve event Sentry'de `error`
      // seviyesinde görünür (mevcut alert kuralları yakalar).
      // `logger.error` ikinci iz: Sentry kapalıyken (DSN yok) tek kayıt odur.
      logger.error({ alert: message }, '[watchdog] SESSİZ BOZULMA ALARMI');
      captureError(new Error(message));
    }
    return alerts;
  } catch (err) {
    // Amd6 K7 — watchdog kendi başarısızlığını YUTMAZ. `ttl-cleanup.ts`'in
    // task'ları hatayı `logger.error`'a yazıp yutuyor ve S134'te bulunan
    // sessizliğin kaynağı tam olarak buydu; alarmın kendisi aynı tuzağa
    // düşerse "alarmı izleyen alarm yok" durumu doğar. Prefix bulgu-alarmından
    // AYRI ki Sentry'de ikisi karışmasın.
    logger.error({ err }, '[watchdog] KOŞAMADI — kontrol sorgusu başarısız');
    captureError(
      err instanceof Error
        ? err
        : new Error(`[watchdog] koşamadı: ${String(err)}`),
    );
    return alerts;
  } finally {
    await lock.release();
  }
}

/**
 * Schedule'ı kurar. `startTtlCleanup` deseni: `ScheduledTask` döner (test ve
 * kapanışta `.stop()` için).
 */
export function startRetentionWatchdog(
  deps: RetentionWatchdogDeps,
): ScheduledTask {
  const task = cron.schedule(
    SCHEDULE_EXPR,
    () => {
      void runRetentionWatchdog(deps);
    },
    { timezone: TIMEZONE },
  );
  logger.info(
    { schedule: SCHEDULE_EXPR, timezone: TIMEZONE, windowHours: WINDOW_HOURS },
    '[watchdog] retention watchdog kuruldu',
  );
  return task;
}
