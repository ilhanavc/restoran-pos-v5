import { randomBytes, randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { logger } from '../logger.js';
import { captureError } from '../observability/sentry.js';
import { withTenant, type DB } from '@restoran-pos/db';
import {
  AgentRefreshRequestSchema,
  AgentRegisterRequestSchema,
  JobResultRequestSchema,
  PrintJobKindSchema,
  type PrintJobKind,
} from '@restoran-pos/shared-types';
import { AUTH_MESSAGE_KEYS, domainError } from '../errors.js';
import { requireAgentJwt } from '../middleware/print-agent-auth.js';

/**
 * Print Agent endpoints — ADR-004 §6 Soru #6.
 *
 * Phase 3 PR-1 scope (decisions.md ADR-004 §Phase 3 PR-1 Scope Kilidi):
 *   - YALNIZ `GET /print/v1/jobs/next` long-poll endpoint.
 *   - Mock auth: `X-Tenant-Id` header (UUID format). Gerçek JWT akışı
 *     (`POST /print/v1/agent/register`, `POST /print/v1/agent/refresh`,
 *     `agents` tablosu) Phase 4+'da gelir.
 *
 * Phase 3 PR-2 scope (decisions.md ADR-004 §Amendment 1):
 *   - `POST /print/v1/jobs/:id/result` result callback + state machine.
 *   - State çarkı: queued → printing → success | (failed → retry |
 *     cancelled). `attempts` sayacı (Migration 036) yalnız failed
 *     branch'inde +1; success branch'inde DEĞİŞMEZ. attempts ≥ 3 →
 *     cancelled (terminal). Idempotency: terminal status üzerinde
 *     aynı status ile tekrar POST → 200 no-op.
 *   - Manuel iptal, retry → queued cron, audit log entry'leri Phase 4+.
 *
 * Atomik claim — yarış koşulu yok: `UPDATE … WHERE id = (SELECT … FOR
 * UPDATE SKIP LOCKED LIMIT 1)`. İki Agent eşzamanlı poll ederse Postgres
 * SKIP LOCKED ile birinin lock'unu atlayıp diğer sıradaki job'u verir.
 * Multi-tenant izolasyon: tenant filtresi inner SELECT'te.
 *
 * Long-poll implementasyonu: kısa pencere boyunca 500ms aralıklı DB
 * sorgu. Phase 4+'da Postgres LISTEN/NOTIFY ile gerçek event-driven
 * hale getirilebilir (queued job INSERT trigger'ı NOTIFY emitir).
 *
 * Limit: `wait` parametresi 0..25sn clamp edilir (ADR-004 §6 long-poll
 * üst sınırı). Default 5sn — Agent skeleton da bu varsayımı kullanır.
 */

export interface PrintJobsRouterDeps {
  db: Kysely<DB>;
  /**
   * ADR-004 Amendment 2 — Print Agent JWT secret. `requireAgentJwt`
   * middleware'e geçer; `agent/register` ve `agent/refresh` endpoint'leri
   * de bu secret ile access + refresh JWT imzalar.
   */
  agentSecret: string;
  /**
   * ADR-041 Amd7 K4(2) — sunucu-taraflı tenant sabiti. YALNIZ
   * `POST /agent/register` kullanır: istek pre-context'tir (henüz JWT yok),
   * bu yüzden tenant **istemciden ÖĞRENİLMEZ** — istemcinin sunduğu apiKey
   * prefix'i bu sabitin prefix'iyle karşılaştırılır (eşleşmezse 401).
   *
   * ⚠️ TEK-TENANT VARSAYIMI (sunset koşulu): `authRouter`'ın login'de
   * kullandığı `deps.tenantId` ile AYNI kaynaktır — yani yeni bir varsayım
   * eklenmiyor, mevcut varsayımın yayılma alanı içinde kalıyor ve DAHA
   * GÖRÜNÜR oluyor. Tenant #2 geldiğinde değişmesi gereken üç çağrı
   * noktasından biri burasıdır (diğerleri: `routes/auth.ts` login,
   * `auth/refresh.ts` rotasyon). Boot'taki sunset guard
   * (`config/singleTenantGuard.ts`) `tenants` tablosunda birden fazla satır
   * görürse alarm çalar.
   */
  tenantId: string;
}

const DEFAULT_WAIT_SECONDS = 5;
const MAX_WAIT_SECONDS = 25;
const POLL_INTERVAL_MS = 500;

// ADR-004 §Amendment 3 — stuck 'printing' reclaim eşiği (saniye). Agent claim
// sonrası result POST'a ulaşamadan ölürse, updated_at bu süreden eski olunca
// job bir sonraki /jobs/next claim'inde yeniden 'printing'e alınır (re-print).
//
// ADR-004 Amd6 B3 — reclaim/ack koordinasyonu: claim→ack süresi artık
// `transport timeoutMs (default 10s; print-agent printer/config.ts) +
// agent worst-case ack-retry bütçesi (53s; print-agent ack.ts)` = 63s;
// + 15s marj = 78s ≤ 90s default. Bu değer 78s'in altına çekilirse (veya
// agent timeoutMs yükseltilip burası yükseltilmezse) basılmış-ama-ack'i
// süren job erken reclaim edilir → kind'ı örtüşen ikinci agent varsa aynı
// fiş İKİNCİ KEZ basılır (P11-A-01). Agent tarafındaki ayna guard'lar:
// ack.test.ts "B3" testleri + printer/config.ts TimeoutMsSchema yorumu.
const RECLAIM_STALE_SECONDS = (() => {
  const raw = Number(process.env['PRINT_AGENT_RECLAIM_STALE_SECONDS']);
  const value = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 90;
  // B3 taban uyarısı (78s = 10s transport + 53s ack + 15s marj). Değer
  // operatör niyeti sayılıp KORUNUR; risk yalnız loglanır.
  if (value < 78) {
    logger.warn(
      `[print-jobs] PRINT_AGENT_RECLAIM_STALE_SECONDS=${value.toString()} ack-retry bütçesinin (78s) altında — basılmış job erken reclaim edilip çift basılabilir (ADR-004 Amd6 B3)`,
    );
  }
  return value;
})();

// ADR-004 §Amendment 3 — retry backoff base (saniye). printing→retry
// transition'ında retry_at = now() + BASE * 2^(attempts-1). attempts 1→10s,
// 2→20s (ceiling=3 olduğu için pratik üst sınır 20s).
const RETRY_BACKOFF_BASE_SECONDS = 10;

// ADR-004 §Amendment 2 §2 — bcrypt cost (user password ile aynı; operasyonel
// parite + ADR-002 §2).
const BCRYPT_COST = 12;

// ADR-004 §6 Soru #6 — access 1h, refresh 30d. Stateless rotation; revoke
// DB lookup ile zorlanır (`agents.revoked_at`).
const AGENT_ACCESS_TTL = '1h';
const AGENT_REFRESH_TTL = '30d';

// ADR-004 §Amendment 2 §2 — tenantIdShort = tenant_id UUID'nin ilk 8 char.
// Register sırasında apiKey prefix parse → tenant adayı listesi daraltma.
const TENANT_ID_SHORT_LEN = 8;
const TENANT_ID_SHORT_RE = /^pk_([0-9a-f]{8})_/i;

type PrintJobStatusDb =
  | 'queued'
  | 'printing'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'retry';

interface PrintJobRow {
  id: string;
  tenant_id: string;
  status: PrintJobStatusDb;
  attempts: number;
  payload: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  last_error: string | null;
}

/**
 * DB row → HTTP DTO. Tek nokta map'lemesi (GET /jobs/next ve POST
 * /jobs/:id/result aynı PrintJob şemasını döner; sözleşme drift'i
 * engellenir).
 */
function rowToJobDto(row: PrintJobRow): {
  id: string;
  tenantId: string;
  status: PrintJobStatusDb;
  attempts: number;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
} {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    attempts: row.attempts,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastError: row.last_error,
  };
}

/**
 * ADR-004 Amendment 1 — `printing → failed` transition'ında attempts+1
 * sonrası nihai status hesaplaması. attempts ≥ 3 → `cancelled`
 * (terminal); aksi halde `retry` (cron tarafından sonradan queued'a
 * çekilecek — Phase 4+).
 */
const FAILED_ATTEMPTS_CEILING = 3;

/**
 * `wait` query parametresini güvenli sayıya çevirir. Geçersiz / negatif /
 * NaN → default. Üst sınır clamp. Min 0 (Agent isterse pure non-blocking
 * sorgulayabilir; testte timeout süresini kısaltmak için kullanışlı).
 */
function parseWaitSeconds(raw: unknown): number {
  if (raw === undefined) return DEFAULT_WAIT_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || Number.isNaN(n)) return DEFAULT_WAIT_SECONDS;
  if (n < 0) return 0;
  if (n > MAX_WAIT_SECONDS) return MAX_WAIT_SECONDS;
  return Math.floor(n);
}

/**
 * ADR-032 — `GET /jobs/next?kind=` claim filtresi parse + doğrulama. Agent
 * tekrarlı param gönderir (`?kind=kitchen&kind=bill`); tek değer ve CSV de
 * kabul. Boş/eksik → `null` (filtre yok, tüm türler — geriye dönük, mevcut
 * bootstrap agent kırılmaz). Enum dışı değer → `domainError('VALIDATION_ERROR',
 * 400)` fırlatır (handler try/catch → next). Dönen dizi SQL'e `text[]` param.
 */
function parseKindFilter(raw: unknown): PrintJobKind[] | null {
  if (raw === undefined) return null;
  const values = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : [String(v)]))
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (values.length === 0) return null;
  const parsed = z.array(PrintJobKindSchema).safeParse(values);
  if (!parsed.success) throw domainError('VALIDATION_ERROR', 400);
  return parsed.data;
}

export function printJobsRouter(deps: PrintJobsRouterDeps): ExpressRouter {
  const router = Router();

  // Güvenlik (Session 70 denetimi) — agent auth endpoint'lerinde rate-limit.
  // /agent/register apiKey'i bcrypt(cost 12) ile karşılaştırır, /agent/refresh
  // JWT rotate eder. Throttle'sız bırakılırsa apiKey brute-force + bcrypt CPU
  // DoS açığı (loginLimiter `auth.ts` paritesi). Limit 30/15dk-IP: sağlıklı
  // agent ~1 çağrı/15dk (boot register + saatlik refresh) + integration test
  // ~8 çağrı bu sınırın çok altında; 192-bit apiKey entropisi zaten brute
  // edilemez, asıl koruma bcrypt CPU exhaustion. Per-app in-memory store
  // (buildApp başına izole — test suite'leri birbirini etkilemez).
  const agentAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'AUTH_RATE_LIMITED',
          message_key: AUTH_MESSAGE_KEYS.AUTH_RATE_LIMITED,
        },
      });
    },
  });

  /**
   * GET /print/v1/jobs/next?wait=N
   *
   * Yanıtlar:
   *   - 200 + `{ job: PrintJob }` → Atomik queued → printing transition'u
   *     yapıldı. Agent bu job'u işlemekle yükümlü (Phase 4+'da result
   *     callback ile sonucu bildirir).
   *   - 204 No Content              → Kuyrukta queued job yok, wait süresi
   *     doldu. Agent hemen yeniden poll'a girer.
   *   - 400 TENANT_HEADER_INVALID  → `X-Tenant-Id` header eksik veya
   *     UUID formatında değil (bridge-token middleware tarafından).
   */
  router.get(
    '/jobs/next',
    requireAgentJwt(deps),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.tenantId!;
        // ADR-032 — iş-türü filtresi (agent config `jobKinds` → `?kind=`).
        // null → filtre yok (tüm türler). Geçersiz kind → 400 (throw → catch).
        const kinds = parseKindFilter(req.query['kind']);

        // ADR-032 Amd2 K2 — declared_kinds GÖZLEM yazımı (yazıcı yönetim ekranı).
        // Agent'ın bildirdiği `?kind=` kümesini fire-and-forget
        // `agents.declared_kinds`'a yazar (last_seen_at deseni,
        // middleware/print-agent-auth.ts:127). OTORİTER DEĞİL — claim
        // SELECT/UPDATE'ine DOKUNULMAZ (ADR-032 Design B bit-bit korunur).
        // kind bildirmeyen agent → NULL YAZILIR (UI "filtresiz çekiyor"
        // uyarısı bundan beslenir). Yazım her poll'da koşulsuz yapılır:
        // "yalnız kinds!==null iken yaz" dalı, filtreli→filtresiz geçen bir
        // agent'ın eski dizisini satırda sonsuza dek bırakıyordu → uyarı hiç
        // yanmaz ve yetim-kuyruk hesabı bayat veriden kurulurdu. Gözlem
        // alanının bayat kalması, K2'nin panzehiri olduğunu iddia ettiği
        // v3 `roles` yalanının aynısıdır. Hata claim'i düşürmez (yutulur).
        //
        // ADR-041 Amd7 K3 — `agents` force-RLS (mig 064) → `withTenant`.
        // Amd7 K5 — `.catch(() => {})` KALDIRILDI: fire-and-forget davranışı
        // BİREBİR korunur (`await` YOK, claim düşmez, yanıt gecikmesi aynı),
        // ama `catch` boş kalmaz → gerçek DB hataları artık yutulmuyor.
        // ⚠️ K5'İN SINIRI (ampirik; print-agent-auth.ts'teki ikiz notla aynı):
        // **eksik sarımı bu catch YAKALAMAZ** — context'siz UPDATE 42501
        // fırlatmaz, policy satırı gizler ve komut "0 satır" ile başarıyla
        // döner. Amd6 watchdog'u da bu fazı KAPSAMAZ (K8). Bu yüzden aşağıda
        // ayrı bir `rowCount === 0` dalı var:
        //
        // ADR-041 Amd7 Düzeltme 1 (3b) — bu handler `requireAgentJwt`
        // arkasındadır (router.get, yukarıda) ve o middleware agent satırını
        // AYNI tenant context'inde SELECT edip bulmuştur; bulamasaydı 401 ile
        // dönerdi. Dolayısıyla burada 0 satırın tek yapısal açıklaması context
        // kaybıdır. Tek yanlış-pozitif (SELECT ile UPDATE arasında silinme)
        // tek seferliktir; eksik sarım her poll'da tetiklenir → Sentry sayacı
        // ayırt eder. Gerekçenin tamamı print-agent-auth.ts'teki ikiz notta.
        if (req.agentId !== undefined) {
          const observedAgentId = req.agentId;
          void withTenant(deps.db, tenantId, (trx) =>
            trx
              .updateTable('agents')
              .set({
                declared_kinds: kinds === null ? null : [...new Set(kinds)],
              })
              .where('id', '=', observedAgentId)
              .where('tenant_id', '=', tenantId)
              .execute(),
          )
            .then((rows) => {
              if ((rows[0]?.numUpdatedRows ?? 0n) === 0n) {
                const msg =
                  '[print-jobs] declared_kinds 0 satır güncelledi — tenant context kaybı şüphesi (ADR-041 Amd7 Düzeltme 1)';
                logger.error({ agentId: observedAgentId }, msg);
                captureError(new Error(msg));
              }
            })
            .catch((err: unknown) => {
              logger.error(
                {
                  err: err instanceof Error ? err.message : String(err),
                  agentId: observedAgentId,
                },
                '[print-jobs] declared_kinds yazımı başarısız — gözlem alanı donar (ADR-041 Amd7 K5)',
              );
              captureError(err);
            });
        }

        // ADR-032 Amd4 K1.3 — claim eden agent kimliği. `req.agentId` bu kod
        // tabanında `undefined` olabilen bir alandır; NULL'a düşürüyoruz ki
        // yüklem hedefli işleri kimliksiz çağrıya ASLA vermesin (iyimser cast
        // ile geçilemeyecek bir güvenlik koşulu).
        const claimantAgentId: string | null = req.agentId ?? null;

        const waitSeconds = parseWaitSeconds(req.query['wait']);
        const deadline = Date.now() + waitSeconds * 1000;

        // İlk sorgu deadline kontrolünden önce — wait=0 verilse bile en az
        // 1 deneme yapılır (non-blocking check semantiği).
        for (;;) {
          // ADR-004 §Amendment 3 — claim sorgusu 3 kaynaktan job alır:
          //   (1) queued — normal yeni job.
          //   (2) retry  — backoff penceresi geçmiş (retry_at <= now). Lazy
          //       requeue: ayrı cron yok, doğrudan retry→printing.
          //   (3) printing — agent ölmüş, updated_at stale: reclaim (re-print).
          // Dış UPDATE uniform SET status='printing' (CASE yok, attempts'a
          // DOKUNMAZ — tek attempts writer result handler kalır, interleaving
          // yok). ORDER BY (status='printing') → reclaim DAİMA taze queued/retry
          // SONRA (anti-starvation). FOR UPDATE SKIP LOCKED → race-free.
          //
          // ADR-041 Amd4 K2 — print_jobs RLS: claim tenant context altında
          // koşmalı. Aksi halde app_tenant fail-closed 0 satır döndürür →
          // RETURNING boş → sonsuza dek 204 → TÜM BASKI SESSİZCE DURUR
          // (hata yok, log yok; bu fazın sessiz-bozulma sınıfı, K5).
          // Sarım long-poll döngüsünün İÇİNDE, her iterasyondaki TEK claim
          // statement'ının etrafında: statement zaten implicit tek-statement
          // tx'indeydi → BEGIN/COMMIT atomikliği, SKIP LOCKED race-free'liğini
          // ve reclaim anti-starvation sıralamasını BİREBİR korur. Tüm
          // `for(;;)` döngüsünü tek tx'e almak REDDEDİLDİ: 25 s'ye kadar açık
          // transaction + tutulan pool client + VACUUM o süre boyunca ölü
          // satırları toplayamaz. Maliyet: poll başına 2 ek roundtrip.
          const result = await withTenant(deps.db, tenantId, (trx) =>
            sql<PrintJobRow>`
            UPDATE print_jobs
            SET status = 'printing'
            WHERE id = (
              SELECT id FROM print_jobs
              WHERE tenant_id = ${tenantId}
                -- ADR-032: iş-türü filtresi status-OR bloğunun DIŞINDA → 3 dalı
                -- da kapsar (queued/retry/printing-stale reclaim). kind=bill
                -- agent stale mutfak job'unu RECLAIM EDEMEZ. null→filtre yok.
                --
                -- ADR-032 Amd4 K1.3 — hedefleme yüklemi (BİREBİR):
                --   * Acik hedef, kind filtresini EZER: Izgara agent'i
                --     kitchen_izgara beyan etse bile kendisine hedeflenmis
                --     bill isini ceker (kind filtresi bir yapilandirma
                --     tercihidir, acik kullanici talimati ondan ustundur).
                --   * Hedefli is, hedefi DISINDAKI hicbir agent'a gitmez --
                --     reclaim dahil. Hedef cevrimdisiysa is BEKLER; sessizce
                --     yanlis yaziciyla basilan fis, gec basilandan kotudur.
                --   * Claimant agent id NULL (kimliksiz cagri) ise yalniz
                --     target_agent_id IS NULL dali uretilir: hedefli is asla
                --     kimliksiz bir cagriya verilmez (guvenlik yuklemi).
                AND (
                  (${claimantAgentId}::uuid IS NOT NULL AND target_agent_id = ${claimantAgentId}::uuid)
                  OR (
                    target_agent_id IS NULL
                    AND (${kinds}::text[] IS NULL OR payload->>'kind' = ANY(${kinds}::text[]))
                  )
                )
                AND (
                  status = 'queued'
                  OR (status = 'retry' AND retry_at IS NOT NULL AND retry_at <= now())
                  OR (status = 'printing' AND updated_at < now() - make_interval(secs => ${RECLAIM_STALE_SECONDS}))
                )
              ORDER BY (status = 'printing'), created_at
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            RETURNING id, tenant_id, status, attempts, payload, created_at, updated_at, last_error
          `.execute(trx),
          );

          const row = result.rows[0];
          if (row !== undefined) {
            res.status(200).json({ job: rowToJobDto(row) });
            return;
          }

          if (Date.now() >= deadline) {
            res.status(204).end();
            return;
          }

          await new Promise<void>((resolve) =>
            setTimeout(resolve, POLL_INTERVAL_MS),
          );
        }
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /print/v1/jobs/:id/result — ADR-004 Amendment 1 (Session 63 PR-2).
   *
   * Body: `JobResultRequestSchema` → `{ status: 'success' | 'failed',
   * errorText?: string }`.
   *
   * Server state machine:
   *   - printing + success  → success                   (attempts DEĞİŞMEZ)
   *   - printing + failed   → retry                     (attempts < ceiling)
   *                        → cancelled                  (attempts ≥ ceiling)
   *
   * Idempotency: Aynı job zaten terminal `success` veya `cancelled`
   * durumdaysa ve POST body'deki status terminal hâlle uyumluysa
   * (success↔success, failed↔cancelled) → 200 no-op, state DEĞİŞMEZ
   * (mevcut row aynen döner; updated_at korunur).
   *
   * Atomik UPDATE: WHERE status = 'printing' guard'ı sayesinde concurrent
   * iki agent aynı sonucu POST'larsa biri 0 row affected alır → ikincil
   * SELECT ile idempotent karar verilir.
   *
   * Yanıtlar:
   *   - 200 + { job: PrintJob }                    state geçiş veya idempotent no-op
   *   - 400 VALIDATION_ERROR                       body schema mismatch
   *   - 400 PRINT_JOB_NOT_IN_PRINTING_STATE        job mevcut ama printing değil ve idempotent koşula uymuyor
   *   - 400 TENANT_HEADER_INVALID                  middleware (header eksik/format)
   *   - 404 PRINT_JOB_NOT_FOUND                    job bu tenant'a ait değil veya yok
   */
  router.post(
    '/jobs/:id/result',
    requireAgentJwt(deps),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.tenantId!;
        // Express 5: req.params['id'] tipini `string | string[]` olarak
        // narrowlatmıyor. Path pattern `:id` tek segment garantiler ama
        // tip güvenliği için String() ile zorla daraltıyoruz.
        const jobId = String(req.params['id'] ?? '');

        // jobId UUID format guard — 404 yerine 400 olabilirdi, ama mevcut
        // kontratta jobId path param: format hatasında 404 PRINT_JOB_NOT_FOUND
        // semantiği (`bulunamadı`) doğal. SELECT zaten `WHERE id = $1` ile
        // boş set döner; tek UUID guard eklemek yerine Postgres'in
        // invalid_text_representation hatasından önce kısa-devre yapalım.
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            jobId,
          )
        ) {
          return next(domainError('PRINT_JOB_NOT_FOUND', 404));
        }

        const parsed = JobResultRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return next(parsed.error);
        }
        const input = parsed.data;

        // 1) Mevcut satırı oku (idempotency kararı + attempts hesabı için).
        //    NOT: failed sonucunda yeni attempts değerini "row.attempts + 1"
        //    olarak ileride atomik UPDATE içinde de tekrar hesaplıyoruz.
        //    Bu SELECT atomik UPDATE'in dışında, yalnız idempotency ve
        //    "halen printing mi" sorusunun cevabı için. Yarış: iki paralel
        //    POST gelirse atomik UPDATE'in `WHERE status='printing'` guard'ı
        //    birinin 0 row affected almasını sağlar; o branch idempotent
        //    karar verir.
        //    ADR-041 Amd4 — print_jobs RLS: context'siz okuma app_tenant
        //    altında 0 satır → 404 → agent sonucu BİLDİREMEZ → job sonsuza
        //    dek 'printing' → 90 s sonra reclaim → AYNI FİŞ TEKRAR BASILIR.
        //    Handler'ın üç sorgusu AYRI AYRI sarılır (tek tx'e alınmadı):
        //    mevcut autocommit semantiği korunur — aksi halde 5) adımının
        //    yarış-tespit yeniden okuması aynı tx'e girer ve HTTP yanıtı
        //    açık transaction içinden verilirdi.
        const existing = await withTenant(deps.db, tenantId, (trx) =>
          sql<PrintJobRow>`
          SELECT id, tenant_id, status, attempts, payload, created_at, updated_at, last_error
          FROM print_jobs
          WHERE id = ${jobId} AND tenant_id = ${tenantId}
        `.execute(trx),
        );

        const existingRow = existing.rows[0];
        if (existingRow === undefined) {
          return next(domainError('PRINT_JOB_NOT_FOUND', 404));
        }

        // 2) Idempotent no-op: terminal durumda aynı amaçla tekrar POST.
        //    success ↔ success → already-success
        //    failed  ↔ cancelled → already-cancelled (failed branch'in nihai
        //                          terminal hâli; aynı body ile tekrar
        //                          POST = aynı niyet).
        if (
          (existingRow.status === 'success' && input.status === 'success') ||
          (existingRow.status === 'cancelled' && input.status === 'failed')
        ) {
          res.status(200).json({ job: rowToJobDto(existingRow) });
          return;
        }

        // 3) Halen printing değilse ve idempotent koşula uymadıysa → 400.
        if (existingRow.status !== 'printing') {
          return next(domainError('PRINT_JOB_NOT_IN_PRINTING_STATE', 400));
        }

        // 4) Atomik transition. attempts hesabı:
        //    - success → mevcut attempts korunur
        //    - failed  → attempts+1; ≥ ceiling ise 'cancelled', aksi 'retry'
        const nextAttempts =
          input.status === 'failed'
            ? existingRow.attempts + 1
            : existingRow.attempts;
        const nextStatus: PrintJobStatusDb =
          input.status === 'success'
            ? 'success'
            : nextAttempts >= FAILED_ATTEMPTS_CEILING
              ? 'cancelled'
              : 'retry';

        // ADR-004 §Amendment 3 — retry backoff. printing→retry'de retry_at =
        // now()+10s*2^(attempts-1) (10s/20s); claim sorgusu retry_at<=now()
        // olunca job'u yeniden printing alır. Diğer transition'larda NULL.
        const retryAtExpr =
          nextStatus === 'retry'
            ? sql`now() + make_interval(secs => ${
                RETRY_BACKOFF_BASE_SECONDS * 2 ** (nextAttempts - 1)
              })`
            : sql`NULL`;

        // ADR-004 Amendment 13 — errorText geldiğinde ÜZERİNE yazar (en son
        // hata); gelmediğinde (success'te agent göndermez) mevcut last_error
        // KORUNUR — "bir ara zorlandı ama sonunda bastı" bilgisi kaybolmaz.
        // Boş string de "yok" sayılır (db-migration-guard önerisi) — aksi
        // halde `errorText: ''` önceki gerçek hatayı boş string ile ezerdi.
        const lastErrorExpr = sql`COALESCE(${input.errorText === undefined || input.errorText === '' ? null : input.errorText}, last_error)`;

        // ADR-041 Amd4 — RLS: tenant context (yukarıdaki notun aynısı).
        const updated = await withTenant(deps.db, tenantId, (trx) =>
          sql<PrintJobRow>`
          UPDATE print_jobs
          SET status = ${nextStatus},
              attempts = ${nextAttempts},
              retry_at = ${retryAtExpr},
              last_error = ${lastErrorExpr}
          WHERE id = ${jobId}
            AND tenant_id = ${tenantId}
            AND status = 'printing'
          RETURNING id, tenant_id, status, attempts, payload, created_at, updated_at, last_error
        `.execute(trx),
        );

        const updatedRow = updated.rows[0];
        if (updatedRow !== undefined) {
          res.status(200).json({ job: rowToJobDto(updatedRow) });
          return;
        }

        // 5) 0 row affected — yarış: başka istek araya girip status'u
        //    printing'den çıkardı. Idempotency için tekrar oku ve aynı
        //    karar matrisi ile yanıtla.
        //    ADR-041 Amd4 — RLS: tenant context. Ayrı tx olması KASITLI —
        //    yarış tespiti için taze snapshot gerekir (yukarıdaki not).
        const reread = await withTenant(deps.db, tenantId, (trx) =>
          sql<PrintJobRow>`
          SELECT id, tenant_id, status, attempts, payload, created_at, updated_at, last_error
          FROM print_jobs
          WHERE id = ${jobId} AND tenant_id = ${tenantId}
        `.execute(trx),
        );
        const rereadRow = reread.rows[0];
        if (rereadRow === undefined) {
          return next(domainError('PRINT_JOB_NOT_FOUND', 404));
        }
        if (
          (rereadRow.status === 'success' && input.status === 'success') ||
          (rereadRow.status === 'cancelled' && input.status === 'failed')
        ) {
          res.status(200).json({ job: rowToJobDto(rereadRow) });
          return;
        }
        return next(domainError('PRINT_JOB_NOT_IN_PRINTING_STATE', 400));
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /print/v1/agent/register — ADR-004 §Amendment 2 §6.
   *
   * Body: `{ apiKey, deviceFingerprint }` (zod).
   *
   * Flow (ADR-041 Amd7 K4(2) + K6 ile güncellendi):
   *   1. apiKey prefix `pk_<tenantIdShort>_...` parse → tenantIdShort
   *   2. tenantIdShort, **sunucu sabitinin** (`deps.tenantId`) prefix'iyle
   *      karşılaştırılır. Eşleşmezse → 401 AUTH_INVALID_CREDENTIALS.
   *      Tenant artık istemciden ÖĞRENİLMEZ; tenant-ötesi aday araması YOK.
   *   3. Geri kalan her şey `withTenant(deps.tenantId, …)` içinde koşar:
   *      a. `SELECT … FROM agents WHERE tenant_id = $tid AND revoked_at IS NULL`
   *      b. Her aday için `bcrypt.compare(apiKey, api_key_hash)` — ilk match.
   *         Döngü KORUNUR: aynı `api_key_hash` birden çok agent satırında
   *         olabilir (tek anahtar paylaşılır, her cihaz ayrı satır).
   *         Eşleşme yok → 401 AUTH_INVALID_CREDENTIALS
   *      c. `(tenant_id, device_fingerprint)` lookup:
   *         - Kendi tenant'ında varsa → idempotent: mevcut agent row re-use
   *         - Yoksa yeni `agents` row INSERT
   *   4. Access + refresh JWT issue → 200 `{ agentId, accessToken, refreshToken }`
   *
   * ⚠️ 409 `AGENT_FINGERPRINT_CONFLICT` dalı SİLİNDİ (Amd7 K6 — fingerprint
   * oracle): sorgu tenant-ötesi olduğu için 409 ↔ 200 farkı, geçerli apiKey
   * taşıyan çağırana "bu cihaz başka bir tenant'ta kayıtlı" bilgisini
   * sızdırıyordu. Dalı "RLS zaten boş döndürür" deyip BIRAKMADIK: güvenlik
   * kontrolü gibi görünen ölü kod, canlı kontrolden tehlikelidir.
   * Silmenin güvenli olduğunun kanıtı DB kısıtının kendisidir —
   * `037_create_agents_table.sql` `UNIQUE (tenant_id, device_fingerprint)`,
   * global DEĞİL → 23505 riski üretilemez. Davranış değişikliği: başka
   * tenant'ta kayıtlı bir fingerprint artık kendi tenant'ında BAŞARIYLA
   * kaydolur (aynı fiziksel PC meşru olarak iki işletmeye hizmet edebilir;
   * DB kısıtı bunu zaten öngörmüştü). Hata kodu ADR-003 kataloğunda
   * deprecated/ulaşılamaz olarak KALIR, yeni kullanım eklenmez.
   *
   * Auth: public — apiKey'in kendisi kimlik kanıtıdır.
   */
  router.post(
    '/agent/register',
    agentAuthLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = AgentRegisterRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return next(parsed.error);
        }
        const { apiKey, deviceFingerprint } = parsed.data;

        const prefixMatch = TENANT_ID_SHORT_RE.exec(apiKey);
        if (prefixMatch === null) {
          return next(domainError('AUTH_INVALID_CREDENTIALS', 401));
        }
        const tenantIdShort = prefixMatch[1]!.toLowerCase();

        // ADR-041 Amd7 K4(2) — TENANT ÇÖZÜMÜ: sunucu sabiti, istemci DEĞİL.
        // Eski kod tenant'ı `tenant_id::text LIKE '<short>%'` ile TÜM
        // tenant'larda arıyordu (bu fazın iki pre-context yüzeyinden biri).
        // Artık istemcinin sunduğu prefix, sunucunun kendi tenant'ının
        // prefix'iyle karşılaştırılır; eşleşmezse MEVCUT 401 döner — yeni
        // hata kodu YOK, yeni oracle YOK (prefix uyuşmazlığı ile bcrypt
        // uyuşmazlığı ayırt edilemez).
        //
        // REDDEDİLEN alternatif: auth yoluna sınırlı BYPASSRLS pool
        // (`cron_purger` deseni). Belirleyici gerekçe: BYPASSRLS'i kimliği
        // doğrulanmamış, dışarıdan tetiklenebilen bir istek yoluna koymak
        // ADR-041'in tam olarak engellemek için var olduğu şeydir.
        const serverTenantShort = deps.tenantId
          .replace(/-/g, '')
          .slice(0, TENANT_ID_SHORT_LEN)
          .toLowerCase();
        if (tenantIdShort !== serverTenantShort) {
          return next(domainError('AUTH_INVALID_CREDENTIALS', 401));
        }
        const tenantId = deps.tenantId;

        // `agents` force-RLS (mig 064) → tüm register akışı tek tenant
        // context'inde koşar. bcrypt döngüsü context içinde kalır (ADR kararı):
        // maliyeti, pool client'ının bcrypt süresince tutulması; `agentAuthLimiter`
        // bu endpoint'i zaten sınırlar ve aday sayısı tenant başına küçüktür.
        const agentId = await withTenant(deps.db, tenantId, async (trx) => {
          // Aday set'i: KENDİ tenant'ının aktif agent'ları.
          const candidates = await trx
            .selectFrom('agents')
            .select(['id', 'api_key_hash'])
            .where('tenant_id', '=', tenantId)
            .where('revoked_at', 'is', null)
            .execute();

          let matched: (typeof candidates)[number] | undefined;
          for (const c of candidates) {
            // bcrypt.compare constant-time; sıralı match'te ilkinde dur.
            // Döngü KORUNUR: aynı api_key_hash birden çok agent satırında
            // olabilir (tek anahtar paylaşılır, her cihaz ayrı satır).
            // eslint-disable-next-line no-await-in-loop
            const ok = await bcrypt.compare(apiKey, c.api_key_hash);
            if (ok) {
              matched = c;
              break;
            }
          }
          if (matched === undefined) {
            throw domainError('AUTH_INVALID_CREDENTIALS', 401);
          }

          // device_fingerprint lookup — KENDİ tenant'ında (Amd7 K6: sorgu
          // tenant-ötesi değil; tenant-ötesi 409 dalı silindi).
          // Aynı tenant + aynı fingerprint → idempotent, mevcut row re-use.
          const sameTenantRow = await trx
            .selectFrom('agents')
            .select(['id'])
            .where('tenant_id', '=', tenantId)
            .where('device_fingerprint', '=', deviceFingerprint)
            .where('revoked_at', 'is', null)
            .executeTakeFirst();
          if (sameTenantRow !== undefined) {
            // Idempotent: agent yeniden boot etti, aynı cihaz/tenant.
            return sameTenantRow.id;
          }

          // Yeni agent row insert. UUIDv7 kütüphanesi yok → randomUUID v4
          // kullan (DB index locality kaybı küçük, MVP). API key hash
          // matched row'dan kopyalanır — aynı api_key_hash birden çok agent'a
          // ait olabilir (tek key paylaşılır; her cihaz ayrı row).
          const newAgentId = randomUUID();
          await trx
            .insertInto('agents')
            .values({
              id: newAgentId,
              tenant_id: tenantId,
              device_fingerprint: deviceFingerprint,
              api_key_hash: matched.api_key_hash,
            })
            .execute();
          return newAgentId;
        });

        const accessToken = jwt.sign(
          { type: 'agent', tid: tenantId },
          deps.agentSecret,
          {
            algorithm: 'HS256',
            expiresIn: AGENT_ACCESS_TTL,
            subject: agentId,
            jwtid: randomUUID(),
          },
        );
        const refreshToken = jwt.sign(
          { type: 'agent_refresh', tid: tenantId },
          deps.agentSecret,
          {
            algorithm: 'HS256',
            expiresIn: AGENT_REFRESH_TTL,
            subject: agentId,
            jwtid: randomUUID(),
          },
        );

        res.status(200).json({ agentId, accessToken, refreshToken });
        return;
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /print/v1/agent/refresh — ADR-004 §Amendment 2 §6.
   *
   * Body: `{ refreshToken }` (zod).
   *
   * Flow:
   *   1. JWT verify (`type: 'agent_refresh'`, exp valid) → fail 401 AUTH_REFRESH_INVALID
   *   2. `SELECT id, tenant_id FROM agents WHERE id=$sub AND tenant_id=$tid
   *      AND revoked_at IS NULL` → 0 row → 401 AGENT_REVOKED
   *   3. Yeni access + refresh JWT issue → 200 `{ accessToken, refreshToken }`
   *
   * Auth: public — refresh token'ın kendisi kimlik kanıtıdır.
   */
  router.post(
    '/agent/refresh',
    agentAuthLimiter,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = AgentRefreshRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return next(parsed.error);
        }
        const { refreshToken: rawToken } = parsed.data;

        let payload: jwt.JwtPayload;
        try {
          const decoded = jwt.verify(rawToken, deps.agentSecret, {
            algorithms: ['HS256'],
          });
          if (typeof decoded === 'string') {
            throw new Error('string payload');
          }
          payload = decoded;
        } catch {
          return next(domainError('AUTH_REFRESH_INVALID', 401));
        }
        if (
          payload['type'] !== 'agent_refresh' ||
          typeof payload['sub'] !== 'string' ||
          typeof payload['tid'] !== 'string'
        ) {
          return next(domainError('AUTH_REFRESH_INVALID', 401));
        }
        const agentId = payload['sub'];
        const tenantId = payload['tid'];

        // ADR-041 Amd7 K3 — `agents` force-RLS (mig 064) → tenant context.
        // Tenant doğrulanmış refresh JWT'sinin `tid` claim'inden gelir, yani
        // bu site pre-context DEĞİLDİR (register'ın aksine).
        const row = await withTenant(deps.db, tenantId, (trx) =>
          trx
            .selectFrom('agents')
            .select(['id'])
            .where('id', '=', agentId)
            .where('tenant_id', '=', tenantId)
            .where('revoked_at', 'is', null)
            .executeTakeFirst(),
        );
        if (row === undefined) {
          return next(domainError('AGENT_REVOKED', 401));
        }

        const accessToken = jwt.sign(
          { type: 'agent', tid: tenantId },
          deps.agentSecret,
          {
            algorithm: 'HS256',
            expiresIn: AGENT_ACCESS_TTL,
            subject: agentId,
            jwtid: randomUUID(),
          },
        );
        const newRefreshToken = jwt.sign(
          { type: 'agent_refresh', tid: tenantId },
          deps.agentSecret,
          {
            algorithm: 'HS256',
            expiresIn: AGENT_REFRESH_TTL,
            subject: agentId,
            jwtid: randomUUID(),
          },
        );

        res.status(200).json({
          accessToken,
          refreshToken: newRefreshToken,
        });
        return;
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

/**
 * ADR-004 §Amendment 2 §2 — API key üretim helper'ı. Test fixture'ları ve
 * Phase 4+ Manager UI bu helper'ı çağırır; plaintext sadece dönüş değerinde.
 *
 * Format: `pk_<tenantIdShort>_<base64url-24-bytes>`
 *   - 8 char tenant prefix → register sırasında dar aday lookup
 *   - 24-byte (192-bit) random suffix base64url → cryptographically secure
 */
export function generateAgentApiKey(tenantId: string): string {
  const short = tenantId.replace(/-/g, '').slice(0, TENANT_ID_SHORT_LEN);
  const random = randomBytes(24).toString('base64url');
  return `pk_${short}_${random}`;
}

/**
 * Test/fixture helper — bcrypt cost-12 hash. Register flow'unun aynı
 * cost değerini kullandığını garanti eder (BCRYPT_COST sabit).
 */
export async function hashAgentApiKey(apiKey: string): Promise<string> {
  return bcrypt.hash(apiKey, BCRYPT_COST);
}
