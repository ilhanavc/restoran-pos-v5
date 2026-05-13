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
import { requireTenantHeader } from '../middleware/bridge-token.js';

/**
 * Print Agent endpoints — ADR-004 §6 Soru #6.
 *
 * Phase 3 PR-1 scope (decisions.md ADR-004 §Phase 3 PR-1 Scope Kilidi):
 *   - YALNIZ `GET /print/v1/jobs/next` long-poll endpoint.
 *   - Mock auth: `X-Tenant-Id` header (UUID format). Gerçek JWT akışı
 *     (`POST /print/v1/agent/register`, `POST /print/v1/agent/refresh`,
 *     `agents` tablosu) Phase 4+'da gelir.
 *   - Sonuç callback (`POST /print/v1/jobs/:id/result`) Phase 4+.
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

interface PrintJobRow {
  id: string;
  tenant_id: string;
  status: 'queued' | 'printing' | 'success' | 'failed' | 'cancelled' | 'retry';
  payload: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

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
            RETURNING id, tenant_id, status, payload, created_at, updated_at
          `.execute(deps.db);

          const row = result.rows[0];
          if (row !== undefined) {
            res.status(200).json({
              job: {
                id: row.id,
                tenantId: row.tenant_id,
                status: row.status,
                payload: row.payload,
                createdAt: row.created_at.toISOString(),
                updatedAt: row.updated_at.toISOString(),
              },
            });
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

  return router;
}
