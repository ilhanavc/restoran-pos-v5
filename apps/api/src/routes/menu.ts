import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { createCategoriesRepository, type DB } from '@restoran-pos/db';
import {
  CategoryCreateRequestSchema,
  CategoryUpdateRequestSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';
import { writeAudit } from '../audit/writeAudit.js';
import { AuthError, AUTH_MESSAGE_KEYS, domainError } from '../errors.js';

export interface MenuRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * Menu (categories) CRUD — Sprint 1 (POST), Sprint 2 (GET), Sprint 4 Görev 20
 * (PATCH/DELETE).
 *
 * ADR-002 §6 RBAC: POST/PATCH/DELETE admin-only. GET 4 rol erişebilir.
 * ADR-006 §5.2 error registry: MENU_CATEGORY_NOT_FOUND (404),
 * MENU_CATEGORY_ALREADY_EXISTS (409), MENU_CATEGORY_HAS_PRODUCTS (409 — Görev
 * 20 cascade kararı, ADR-003 §8.6 Amendment 2026-04-28b Seçenek A),
 * VALIDATION_ERROR (400), AUTH_FORBIDDEN (403).
 *
 * `permissions.ts` merkezi mekanizma Sprint 3b kapsamı dışı: authorize()
 * middleware + inline conditional pattern.
 */
export function menuRouter(deps: MenuRouterDeps): ExpressRouter {
  const router = Router();

  router.post(
    '/categories',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(CategoryCreateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createCategoriesRepository(deps.db);
        const category = await repo.create(req.user!.tenantId, {
          id: randomUUID(),
          name: req.body.name,
          ...(req.body.sortOrder !== undefined && { sortOrder: req.body.sortOrder }),
        });
        res.status(201).json({ data: { category } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/categories',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter', 'kitchen']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createCategoriesRepository(deps.db);
        const categories = await repo.findAll(req.user!.tenantId);
        res.status(200).json({ data: { categories } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /menu/categories/:id — admin-only partial update (name, sortOrder).
   *
   * `vatRateBps` MVP kapsamı dışı (DB kolonu yok). `CategoryUpdateRequestSchema
   * .refine()` boş body'i 400 VALIDATION_ERROR ile keser (validateBody).
   *
   * Tek transaction: UPDATE categories + audit INSERT (ADR-002 §10.4 atomicity).
   * Duplicate name → 409 MENU_CATEGORY_ALREADY_EXISTS (RepositoryError 'unique').
   * Cross-tenant id → repo update null → 404 MENU_CATEGORY_NOT_FOUND
   * (enumeration sızdırılmaz).
   */
  router.patch(
    '/categories/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(CategoryUpdateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const categoryId = req.params.id as string;

        const updated = await deps.db.transaction().execute(async (trx) => {
          const repo = createCategoriesRepository(trx);
          const existing = await repo.findById(tenantId, categoryId);
          if (existing === null) {
            throw domainError('MENU_CATEGORY_NOT_FOUND', 404);
          }

          const patch: { name?: string; sortOrder?: number } = {};
          if (req.body.name !== undefined) patch.name = req.body.name;
          if (req.body.sortOrder !== undefined) patch.sortOrder = req.body.sortOrder;

          const row = await repo.update(tenantId, categoryId, patch);
          if (row === null) {
            throw domainError('MENU_CATEGORY_NOT_FOUND', 404);
          }

          // Audit — sanitize whitelist 'menu.category.updated': category_id,
          // changed_fields, name_before/after, sort_order_before/after.
          // Kategori adı PII değil ama snapshot kuralı (§7) gereği serbest
          // metin minimal tutulur; before/after raporlama için yazılır.
          const changedFields = Object.keys(req.body as Record<string, unknown>);
          await writeAudit(trx, {
            tenantId,
            eventType: 'menu_category.updated',
            actorUserId: req.user!.userId,
            entityType: 'menu_category',
            entityId: row.id,
            rawPayload: {
              category_id: row.id,
              changed_fields: changedFields,
              name_before: existing.name,
              name_after: row.name,
              sort_order_before: existing.sort_order,
              sort_order_after: row.sort_order,
            },
          });

          return row;
        });

        res.status(200).json({ data: { category: updated } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * DELETE /menu/categories/:id — admin-only soft delete.
   *
   * ADR-002 §10.4 atomicity kontratı (TEK transaction):
   *   1. SELECT target (tenant-scoped) — yok/cross-tenant → 404
   *      MENU_CATEGORY_NOT_FOUND.
   *   2. hasActiveProducts guard (ADR-003 §8.6 Amendment 2026-04-28b
   *      Seçenek A — engelle): kategori altında aktif (`deleted_at IS NULL`)
   *      products varsa 409 MENU_CATEGORY_HAS_PRODUCTS. Cascade soft delete
   *      YOK — admin önce ürünleri başka kategoriye taşımalı veya soft delete
   *      etmeli.
   *   3. UPDATE categories SET deleted_at = now().
   *   4. INSERT audit_logs (menu.category.deleted) — AYNI transaction (§10.7).
   */
  router.delete(
    '/categories/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorId = req.user!.userId;
        const categoryId = req.params.id as string;

        await deps.db.transaction().execute(async (trx) => {
          const repo = createCategoriesRepository(trx);
          const target = await repo.findById(tenantId, categoryId);
          if (target === null) {
            throw domainError('MENU_CATEGORY_NOT_FOUND', 404);
          }

          // Seçenek A: aktif products varsa DELETE engellenir. Cascade soft
          // delete YOK — orphan products kalır + raporlama bütünlüğü bozulur.
          const hasActive = await repo.hasActiveProducts(tenantId, categoryId);
          if (hasActive) {
            throw domainError('MENU_CATEGORY_HAS_PRODUCTS', 409);
          }

          await repo.softDelete(tenantId, categoryId);

          await writeAudit(trx, {
            tenantId,
            eventType: 'menu_category.deleted',
            actorUserId: actorId,
            entityType: 'menu_category',
            entityId: categoryId,
            rawPayload: {
              category_id: categoryId,
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
