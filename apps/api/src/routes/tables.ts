import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import type { Server as IoServer } from 'socket.io';
import {
  createAreasRepository,
  createTablesRepository,
  type DB,
} from '@restoran-pos/db';
import {
  TableAreaAssignRequestSchema,
  TableCreateRequestSchema,
  TableListQuerySchema,
  TableUpdateRequestSchema,
  TablesChangedPayloadSchema,
  type TablesChangedPayload,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  validateBody,
  validateParams,
  idParamSchema,
} from '../middleware/validate.js';
import { writeAudit } from '../audit/writeAudit.js';
import { emitToTenant } from '../realtime/emit.js';
import { AuthError, AUTH_MESSAGE_KEYS, domainError } from '../errors.js';

export interface TablesRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
  /** Realtime server (prod). Undefined in tests → emits skipped. */
  io?: IoServer;
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

  // ADR-010 §11.6 Amendment (2026-07-01) — masa/bölge admin-CRUD board sync.
  // Emit invalidate-only `tables.changed` to the tenant room so other terminals
  // (web + mobil masa tahtası) canlı tazelesin. `deps.io === undefined` →
  // test/no-io no-op (mevcut io'suz testler kırılmaz).
  function emitTablesChanged(
    tenantId: string,
    payload: TablesChangedPayload,
  ): void {
    if (deps.io === undefined) {
      return;
    }
    emitToTenant(
      {
        io: deps.io,
        eventName: 'tables.changed',
        payloadSchema: TablesChangedPayloadSchema,
      },
      tenantId,
      payload,
    );
  }

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

        emitTablesChanged(tenantId, { action: 'created', tableId: table.id });
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
    validateParams(idParamSchema),
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

        emitTablesChanged(tenantId, { action: 'updated', tableId: updated.id });
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
   *   2. hasActiveOrders guard (Seçenek A): masa açık siparişe bağlıysa 409
   *      TABLE_ALREADY_OCCUPIED. Geçmiş paid/cancelled siparişler engel değil
   *      (FK ON DELETE SET NULL Migration 030 + table_code_snapshot raporu korur).
   *   3. DELETE FROM tables (Session 53b — hard delete, ADR-003 + ADR-009 Amend.).
   *   4. INSERT audit_logs (table.deleted) — AYNI transaction içinde (§10.7).
   */
  router.delete(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
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

          // Seçenek A guard (Görev 19 + Session 53b): aktif sipariş varsa DELETE
          // engellenir. Geçmiş (paid/cancelled) siparişler engel değil; FK
          // ON DELETE SET NULL (Migration 030) + orders.table_code_snapshot
          // raporu korur — bölge adı dahil.
          const hasActive = await repo.hasActiveOrders(tenantId, tableId);
          if (hasActive) {
            throw domainError('TABLE_ALREADY_OCCUPIED', 409);
          }

          await repo.hardDelete(tenantId, tableId);

          await writeAudit(trx, {
            tenantId,
            eventType: 'table.deleted',
            actorUserId: actorId,
            entityType: 'table',
            entityId: tableId,
            rawPayload: {
              table_id: tableId,
            },
          });
        });

        emitTablesChanged(tenantId, { action: 'deleted', tableId });
        res.status(204).end();
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /tables/:id/area — admin-only (ADR-009 Karar 4). Masayı bir
   * bölgeye bağlar veya bölgeden çıkarır (`area_id: null`).
   *
   * Sıralı kontrol:
   *   1. Tables findById (tenant-scoped) → null ise 404 TABLE_NOT_FOUND
   *      (cross-tenant + bilinmeyen, no enumeration).
   *   2. `area_id !== null` ise areas findById (tenant-scoped, soft-deleted
   *      hariç) → null ise 404 AREA_NOT_FOUND (cross-tenant area_id da burada
   *      yakalanır; composite FK defansif backstop).
   *   3. UPDATE tables SET area_id + audit `table.area_assigned` AYNI
   *      transaction (ADR-002 §10.4).
   */
  router.patch(
    '/:id/area',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    validateBody(TableAreaAssignRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const tableId = req.params.id as string;
        const newAreaId = req.body.area_id as string | null;

        const updated = await deps.db.transaction().execute(async (trx) => {
          const tablesRepo = createTablesRepository(trx);
          const existing = await tablesRepo.findById(tenantId, tableId);
          if (existing === null) {
            throw domainError('TABLE_NOT_FOUND', 404);
          }

          // Sprint 8c PR #1 sonrası TableWithStatus projection'ı area_id'yi
          // içeriyor — `existing.area_id` audit before değeri olarak kullanılır.
          const areaIdBefore = existing.area_id;

          if (newAreaId !== null) {
            const areasRepo = createAreasRepository(trx);
            const area = await areasRepo.findById(tenantId, newAreaId);
            if (area === null) {
              throw domainError('AREA_NOT_FOUND', 404);
            }
          }

          const row = await tablesRepo.updateAreaId(tenantId, tableId, newAreaId);
          if (row === null) {
            throw domainError('TABLE_NOT_FOUND', 404);
          }

          // Audit — whitelist 'table.area_assigned': table_id,
          // area_id_before/after. Tablo kodu / bölge adı yazılmaz (snapshot
          // kuralı §7).
          await writeAudit(trx, {
            tenantId,
            eventType: 'table.area_assigned',
            actorUserId: req.user!.userId,
            entityType: 'table',
            entityId: tableId,
            rawPayload: {
              table_id: tableId,
              area_id_before: areaIdBefore,
              area_id_after: newAreaId,
            },
          });

          return row;
        });

        emitTablesChanged(tenantId, { action: 'area_assigned', tableId });
        res.status(200).json({ data: { table: updated } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
