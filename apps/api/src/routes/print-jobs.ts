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
import type { DB } from '@restoran-pos/db';
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
    console.warn(
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
} {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    attempts: row.attempts,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
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
        // kind bildirmeyen agent → yazılmaz, NULL bırakılır (UI "filtresiz
        // çekiyor" uyarısı bundan beslenir). Hata claim'i düşürmez (yutulur).
        if (kinds !== null && req.agentId !== undefined) {
          void deps.db
            .updateTable('agents')
            .set({ declared_kinds: [...new Set(kinds)] })
            .where('id', '=', req.agentId)
            .where('tenant_id', '=', tenantId)
            .execute()
            .catch(() => {
              /* sessizce yut — gözlem alanı, correctness etkilemez */
            });
        }

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
          const result = await sql<PrintJobRow>`
            UPDATE print_jobs
            SET status = 'printing'
            WHERE id = (
              SELECT id FROM print_jobs
              WHERE tenant_id = ${tenantId}
                -- ADR-032: iş-türü filtresi status-OR bloğunun DIŞINDA → 3 dalı
                -- da kapsar (queued/retry/printing-stale reclaim). kind=bill
                -- agent stale mutfak job'unu RECLAIM EDEMEZ. null→filtre yok.
                AND (${kinds}::text[] IS NULL OR payload->>'kind' = ANY(${kinds}::text[]))
                AND (
                  status = 'queued'
                  OR (status = 'retry' AND retry_at IS NOT NULL AND retry_at <= now())
                  OR (status = 'printing' AND updated_at < now() - make_interval(secs => ${RECLAIM_STALE_SECONDS}))
                )
              ORDER BY (status = 'printing'), created_at
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            RETURNING id, tenant_id, status, attempts, payload, created_at, updated_at
          `.execute(deps.db);

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
        const existing = await sql<PrintJobRow>`
          SELECT id, tenant_id, status, attempts, payload, created_at, updated_at
          FROM print_jobs
          WHERE id = ${jobId} AND tenant_id = ${tenantId}
        `.execute(deps.db);

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

        const updated = await sql<PrintJobRow>`
          UPDATE print_jobs
          SET status = ${nextStatus},
              attempts = ${nextAttempts},
              retry_at = ${retryAtExpr}
          WHERE id = ${jobId}
            AND tenant_id = ${tenantId}
            AND status = 'printing'
          RETURNING id, tenant_id, status, attempts, payload, created_at, updated_at
        `.execute(deps.db);

        const updatedRow = updated.rows[0];
        if (updatedRow !== undefined) {
          res.status(200).json({ job: rowToJobDto(updatedRow) });
          return;
        }

        // 5) 0 row affected — yarış: başka istek araya girip status'u
        //    printing'den çıkardı. Idempotency için tekrar oku ve aynı
        //    karar matrisi ile yanıtla.
        const reread = await sql<PrintJobRow>`
          SELECT id, tenant_id, status, attempts, payload, created_at, updated_at
          FROM print_jobs
          WHERE id = ${jobId} AND tenant_id = ${tenantId}
        `.execute(deps.db);
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
   * Flow:
   *   1. apiKey prefix `pk_<tenantIdShort>_...` parse → tenantIdShort
   *   2. `SELECT … FROM agents WHERE tenant_id::text LIKE '<short>%' AND
   *      revoked_at IS NULL` (dar aday listesi)
   *   3. Her aday için `bcrypt.compare(apiKey, api_key_hash)` — ilk match → tenant
   *   4. `(tenant_id, device_fingerprint)` lookup:
   *      - Aynı tenant'ta zaten varsa → idempotent: mevcut agent row re-use
   *      - Farklı tenant'ta aynı fingerprint var → 409 AGENT_FINGERPRINT_CONFLICT
   *      - Yoksa yeni `agents` row INSERT
   *   5. Access + refresh JWT issue → 200 `{ agentId, accessToken, refreshToken }`
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

        // Aday set'i: aynı 8-char prefix ile başlayan tenant'lardaki aktif
        // agent'lar. tenant_id UUID'leri `tenantIdShort` ile başlamak zorunda;
        // küçük dar arama (genelde N=1).
        const candidates = await deps.db
          .selectFrom('agents')
          .select(['id', 'tenant_id', 'api_key_hash', 'device_fingerprint'])
          .where(sql`tenant_id::text`, 'like', `${tenantIdShort}%`)
          .where('revoked_at', 'is', null)
          .execute();

        let matched: (typeof candidates)[number] | undefined;
        for (const c of candidates) {
          // bcrypt.compare constant-time; sıralı match'te ilkinde dur.
          // eslint-disable-next-line no-await-in-loop
          const ok = await bcrypt.compare(apiKey, c.api_key_hash);
          if (ok) {
            matched = c;
            break;
          }
        }
        if (matched === undefined) {
          return next(domainError('AUTH_INVALID_CREDENTIALS', 401));
        }

        const tenantId = matched.tenant_id;

        // device_fingerprint çakışma kontrolü:
        // (a) aynı tenant + aynı fingerprint → idempotent, mevcut row re-use
        // (b) farklı tenant + aynı fingerprint → 409 AGENT_FINGERPRINT_CONFLICT
        const fpExisting = await deps.db
          .selectFrom('agents')
          .select(['id', 'tenant_id', 'revoked_at'])
          .where('device_fingerprint', '=', deviceFingerprint)
          .execute();

        let agentId: string;
        const sameTenantRow = fpExisting.find(
          (r) => r.tenant_id === tenantId && r.revoked_at === null,
        );
        const otherTenantRow = fpExisting.find(
          (r) => r.tenant_id !== tenantId && r.revoked_at === null,
        );

        if (sameTenantRow !== undefined) {
          // Idempotent: agent yeniden boot etti, aynı cihaz/tenant.
          agentId = sameTenantRow.id;
        } else if (otherTenantRow !== undefined) {
          return next(domainError('AGENT_FINGERPRINT_CONFLICT', 409));
        } else {
          // Yeni agent row insert. UUIDv7 kütüphanesi yok → randomUUID v4
          // kullan (DB index locality kaybı küçük, MVP). API key hash
          // matched row'dan kopyalanır — aynı api_key_hash birden çok agent'a
          // ait olabilir (tek key paylaşılır; her cihaz ayrı row).
          agentId = randomUUID();
          await deps.db
            .insertInto('agents')
            .values({
              id: agentId,
              tenant_id: tenantId,
              device_fingerprint: deviceFingerprint,
              api_key_hash: matched.api_key_hash,
            })
            .execute();
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

        const row = await deps.db
          .selectFrom('agents')
          .select(['id'])
          .where('id', '=', agentId)
          .where('tenant_id', '=', tenantId)
          .where('revoked_at', 'is', null)
          .executeTakeFirst();
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
