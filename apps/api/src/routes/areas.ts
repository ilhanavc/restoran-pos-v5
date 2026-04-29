import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { createAreasRepository, type DB } from '@restoran-pos/db';
import {
  AreaCreateRequestSchema,
  AreaUpdateRequestSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  validateBody,
  validateParams,
  idParamSchema,
} from '../middleware/validate.js';
import { writeAudit } from '../audit/writeAudit.js';
import { AreaService } from '../domain/areas/AreaService.js';
import { AuthError, AUTH_MESSAGE_KEYS } from '../errors.js';

export interface AreasRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * Domain code → AuthError envelope kısayolu (tables.ts/menu.ts pattern).
 */
function domainError(code: string, status: number): AuthError {
  return new AuthError(code, AUTH_MESSAGE_KEYS[code] ?? 'error.internal', status);
}

/**
 * Areas CRUD — Sprint 5 Görev 23 (ADR-009 Karar 4).
 *
 * RBAC matrix:
 *   - POST/PATCH/DELETE: admin-only (`areas.manage` action, ADR-002 §6
 *     amendment cross-ref)
 *   - GET: 4 rol (admin/cashier/waiter/kitchen) — `tables.read` seviyesi,
 *     ADR-009 Karar 4: bölge listesi masa listesinin doğal parçası.
 *
 * ADR-006 §5.2 error codes:
 *   - AREA_NOT_FOUND (404) — cross-tenant + bilinmeyen + soft-deleted
 *   - AREA_NAME_ALREADY_EXISTS (409) — partial UNIQUE
 *     `lower(trim(name)) WHERE deleted_at IS NULL` ihlali
 *   - VALIDATION_ERROR (400) — boş PATCH body, schema parse
 *
 * DELETE Domain service (Karar 5): cascade NULL service-level — TEK
 * transaction içinde soft delete + tables.area_id NULL + audit. Aktif tables
 * guard YOK; bölge silindi diye masa silinmez.
 */
export function areasRouter(deps: AreasRouterDeps): ExpressRouter {
  const router = Router();

  /**
   * POST /areas — admin-only. 201 + Area + audit `area.created`.
   * Tek transaction: INSERT + audit (ADR-002 §10.4).
   * Duplicate (case-insensitive) name → 409 AREA_NAME_ALREADY_EXISTS.
   */
  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(AreaCreateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const areaId = randomUUID();

        const area = await deps.db.transaction().execute(async (trx) => {
          const repo = createAreasRepository(trx);
          const row = await repo.create(tenantId, {
            id: areaId,
            name: req.body.name,
            ...(req.body.sortOrder !== undefined && {
              sortOrder: req.body.sortOrder,
            }),
          });

          await writeAudit(trx, {
            tenantId,
            eventType: 'area.created',
            actorUserId: req.user!.userId,
            entityType: 'area',
            entityId: row.id,
            rawPayload: {
              area_id: row.id,
              name: row.name,
              sort_order: row.sort_order,
            },
          });

          return row;
        });

        res.status(201).json({ data: { area } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * GET /areas — 4 rol erişebilir (ADR-009 Karar 4). Tenant-scoped, soft
   * deleted hariç. Sıralama: sort_order ASC, name ASC tiebreaker.
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter', 'kitchen']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createAreasRepository(deps.db);
        const areas = await repo.findAll(req.user!.tenantId);
        res.status(200).json({ data: { areas } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /areas/:id — admin-only partial update (name, sortOrder).
   *
   * Boş body 400 VALIDATION_ERROR (`AreaUpdateRequestSchema.refine()`).
   * Cross-tenant id → 404 AREA_NOT_FOUND (no enumeration). Duplicate name
   * → 409 AREA_NAME_ALREADY_EXISTS (RepositoryError 'unique').
   *
   * Tek transaction: UPDATE areas + audit INSERT (ADR-002 §10.4).
   */
  router.patch(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    validateBody(AreaUpdateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const areaId = req.params.id as string;

        const updated = await deps.db.transaction().execute(async (trx) => {
          const repo = createAreasRepository(trx);
          const existing = await repo.findById(tenantId, areaId);
          if (existing === null) {
            throw domainError('AREA_NOT_FOUND', 404);
          }

          const patch: { name?: string; sortOrder?: number } = {};
          if (req.body.name !== undefined) patch.name = req.body.name;
          if (req.body.sortOrder !== undefined) {
            patch.sortOrder = req.body.sortOrder;
          }

          const row = await repo.update(tenantId, areaId, patch);
          if (row === null) {
            throw domainError('AREA_NOT_FOUND', 404);
          }

          // Audit — whitelist 'area.updated': area_id, changed_fields,
          // name_before/after, sort_order_before/after.
          const changedFields = Object.keys(req.body as Record<string, unknown>);
          await writeAudit(trx, {
            tenantId,
            eventType: 'area.updated',
            actorUserId: req.user!.userId,
            entityType: 'area',
            entityId: row.id,
            rawPayload: {
              area_id: row.id,
              changed_fields: changedFields,
              name_before: existing.name,
              name_after: row.name,
              sort_order_before: existing.sort_order,
              sort_order_after: row.sort_order,
            },
          });

          return row;
        });

        res.status(200).json({ data: { area: updated } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * DELETE /areas/:id — admin-only soft delete + cascade NULL.
   *
   * AreaService.softDelete (ADR-009 Domain service Karar 5):
   *   1. SELECT target — yok/cross-tenant → 404 AREA_NOT_FOUND
   *   2. UPDATE areas SET deleted_at = now()
   *   3. UPDATE tables SET area_id = NULL WHERE area_id = $1 AND deleted_at IS NULL
   *   4. INSERT audit_logs (area.deleted, tables_unlinked_count)
   *  Hepsi TEK transaction (ADR-002 §10.4 + §10.7).
   */
  router.delete(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const service = new AreaService(deps.db);
        await service.softDelete({
          tenantId: req.user!.tenantId,
          areaId: req.params.id as string,
          actorUserId: req.user!.userId,
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
