import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { JobResultRequestSchema } from '@restoran-pos/shared-types';
import { domainError } from '../errors.js';
import { requireTenantHeader } from '../middleware/bridge-token.js';

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
}

const DEFAULT_WAIT_SECONDS = 5;
const MAX_WAIT_SECONDS = 25;
const POLL_INTERVAL_MS = 500;

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

export function printJobsRouter(deps: PrintJobsRouterDeps): ExpressRouter {
  const router = Router();

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
    requireTenantHeader(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.tenantId!;
        const waitSeconds = parseWaitSeconds(req.query['wait']);
        const deadline = Date.now() + waitSeconds * 1000;

        // İlk sorgu deadline kontrolünden önce — wait=0 verilse bile en az
        // 1 deneme yapılır (non-blocking check semantiği).
        for (;;) {
          const result = await sql<PrintJobRow>`
            UPDATE print_jobs
            SET status = 'printing'
            WHERE id = (
              SELECT id FROM print_jobs
              WHERE tenant_id = ${tenantId}
                AND status = 'queued'
              ORDER BY created_at
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
    requireTenantHeader(),
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

        const updated = await sql<PrintJobRow>`
          UPDATE print_jobs
          SET status = ${nextStatus},
              attempts = ${nextAttempts}
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

  return router;
}
