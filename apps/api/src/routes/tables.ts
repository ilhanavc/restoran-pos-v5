import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { createTablesRepository, type DB } from '@restoran-pos/db';
import {
  TableCreateRequestSchema,
  TableListQuerySchema,
  TableUpdateRequestSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';
import { writeAudit } from '../audit/writeAudit.js';
import { AuthError, AUTH_MESSAGE_KEYS } from '../errors.js';

export interface TablesRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * Domain code → AuthError envelope kısayolu.
 * `messageKey` AUTH_MESSAGE_KEYS sözlüğünde yoksa `error.internal`'a düşer.
 */
function domainError(code: string, status: number): AuthError {
  return new AuthError(code, AUTH_MESSAGE_KEYS[code] ?? 'error.internal', status);
}

/**
 * Tables CRUD — Sprint 1 (POST) + Sprint 2 (GET) + Sprint 4 Görev 19 (PATCH/DELETE).
 *
 * ADR-002 §6 RBAC: POST/PATCH/DELETE admin-only. GET 4 rol erişebilir.
 * ADR-006 §5.2 error registry: TABLE_NOT_FOUND (404), TABLE_ALREADY_OCCUPIED (409),
 * VALIDATION_ERROR (400), AUTH_FORBIDDEN (403).
 *
 * `status` derived field — orders LEFT JOIN (status='open') ile türetilir
 * (ADR-003 §14.2.B). PATCH ile değiştirilemez; `area_id` Sprint 5 ADR-009 +
 * migration 007 sonrası eklenir.
 *
 * `permissions.ts` merkezi mekanizma Sprint 3b kapsamı dışı (PR #31 plan
 * revizyonu): authorize() middleware + inline conditional pattern.
 */
export function tablesRouter(deps: TablesRouterDeps): ExpressRouter {
  const router = Router();

  /**
   * POST /tables — admin-only. 201 + Table + audit `table.created`.
   * Tek transaction: INSERT tables + audit INSERT (ADR-002 §10.4 atomicity).
   * Duplicate code → RepositoryError 'unique' → 409 TABLE_ALREADY_EXISTS
   * (errorHandler envelope).
   */
  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(TableCreateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const tableId = randomUUID();

        const table = await deps.db.transaction().execute(async (trx) => {
          const repo = createTablesRepository(trx);
          const row = await repo.create(tenantId, {
            id: tableId,
            code: req.body.code,
            capacity: req.body.capacity ?? null,
          });

          await writeAudit(trx, {
            tenantId,
            eventType: 'table.created',
            actorUserId: req.user!.userId,
            entityType: 'table',
            entityId: row.id,
            rawPayload: {
              table_id: row.id,
              code: row.code,
              capacity: row.capacity,
            },
          });

          return row;
        });

        res.status(201).json({ data: { table } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * GET /tables — 4 rol erişebilir. Optional `status` query (available|occupied).
   * Tenant-scoped, deleted_at IS NULL filtresi repo'da.
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter', 'kitchen']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = TableListQuerySchema.safeParse(req.query);
        if (!parsed.success) return next(parsed.error);

        const repo = createTablesRepository(deps.db);
        const tables =
          parsed.data.status !== undefined
            ? await repo.findByStatus(req.user!.tenantId, parsed.data.status)
            : await repo.findAll(req.user!.tenantId);
        res.status(200).json({ data: { tables } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /tables/:id — admin-only partial update (code/capacity).
   *
   * `status` PATCH ile değişmez (derived field, orders JOIN). `area_id` Sprint 5
   * ADR-009 sonrası. `TableUpdateRequestSchema.refine()` boş body'i 400
   * VALIDATION_ERROR ile keser (validateBody middleware).
   *
   * Tek transaction: UPDATE tables + audit INSERT (ADR-002 §10.4 atomicity).
   * Duplicate code → 409 TABLE_ALREADY_EXISTS (RepositoryError 'unique').
   * Cross-tenant id → findById null → 404 TABLE_NOT_FOUND (enumeration sızdırılmaz).
   */
  router.patch(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(TableUpdateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const tableId = req.params.id as string;

        const updated = await deps.db.transaction().execute(async (trx) => {
          const repo = createTablesRepository(trx);
          const existing = await repo.findById(tenantId, tableId);
          if (existing === null) {
            throw domainError('TABLE_NOT_FOUND', 404);
          }

          const patch: { code?: string; capacity?: number | null } = {};
          if (req.body.code !== undefined) patch.code = req.body.code;
          if (req.body.capacity !== undefined) patch.capacity = req.body.capacity;

          const row = await repo.update(tenantId, tableId, patch);
          if (row === null) {
            throw domainError('TABLE_NOT_FOUND', 404);
          }

          // Audit — sanitize whitelist 'table.updated': table_id, changed_fields,
          // code_before/after, capacity_before/after. Code masa kodu (PII değil),
          // değişim izlenmesi için before/after yazılır.
          const changedFields = Object.keys(req.body as Record<string, unknown>);
          await writeAudit(trx, {
            tenantId,
            eventType: 'table.updated',
            actorUserId: req.user!.userId,
            entityType: 'table',
            entityId: row.id,
            rawPayload: {
              table_id: row.id,
              changed_fields: changedFields,
              code_before: existing.code,
              code_after: row.code,
              capacity_before: existing.capacity,
              capacity_after: row.capacity,
            },
          });

          return row;
        });

        res.status(200).json({ data: { table: updated } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * DELETE /tables/:id — admin-only soft delete.
   *
   * ADR-002 §10.4 atomicity kontratı (TEK transaction):
   *   1. SELECT target (tenant-scoped) — yok/cross-tenant → 404 TABLE_NOT_FOUND.
   *   2. hasActiveOrders guard (Seçenek A — defansif): masa açık siparişe
   *      bağlıysa 409 TABLE_ALREADY_OCCUPIED. Admin önce siparişi kapatmalı,
   *      yoksa orphan order kalır.
   *   3. UPDATE tables SET deleted_at = now().
   *   4. INSERT audit_logs (table.deleted) — AYNI transaction içinde (§10.7).
   */
  router.delete(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorId = req.user!.userId;
        const tableId = req.params.id as string;

        await deps.db.transaction().execute(async (trx) => {
          const repo = createTablesRepository(trx);
          const target = await repo.findById(tenantId, tableId);
          if (target === null) {
            throw domainError('TABLE_NOT_FOUND', 404);
          }

          // Seçenek A: aktif sipariş varsa DELETE engellenir. Cascade soft delete
          // YOK — orders FK orphan kalır + raporlama bütünlüğü bozulur.
          const hasActive = await repo.hasActiveOrders(tenantId, tableId);
          if (hasActive) {
            throw domainError('TABLE_ALREADY_OCCUPIED', 409);
          }

          await repo.softDelete(tenantId, tableId);

          await writeAudit(trx, {
            tenantId,
            eventType: 'table.deleted',
            actorUserId: actorId,
            entityType: 'table',
            entityId: tableId,
            rawPayload: {
              table_id: tableId,
              soft_delete: true,
            },
          });
        });

        res.status(204).end();
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
