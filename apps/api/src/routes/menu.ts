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
  createCategoriesRepository,
  createCategoryAttributeGroupsRepository,
  createProductsRepository,
  type DB,
} from '@restoran-pos/db';
import {
  CategoryCreateRequestSchema,
  CategoryUpdateRequestSchema,
  ProductReorderRequestSchema,
  CategoriesChangedPayloadSchema,
  type CategoriesChangedPayload,
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

export interface MenuRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
  /** Realtime server (prod). Undefined in tests → emits skipped. */
  io?: IoServer;
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

  // ADR-010 §11.6 Amendment 3 (2026-07-01) — menü admin-CRUD katalog sync.
  // Emit invalidate-only `categories.changed` to the tenant room so other
  // terminals (web sipariş ekranı + mobil menü) katalogu canlı tazelesin.
  // `deps.io === undefined` → test/no-io no-op (mevcut io'suz testler kırılmaz).
  function emitCategoriesChanged(
    tenantId: string,
    payload: CategoriesChangedPayload,
  ): void {
    if (deps.io === undefined) {
      return;
    }
    emitToTenant(
      {
        io: deps.io,
        eventName: 'categories.changed',
        payloadSchema: CategoriesChangedPayloadSchema,
      },
      tenantId,
      payload,
    );
  }

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
          ...(req.body.icon !== undefined && { icon: req.body.icon }),
          ...(req.body.color !== undefined && { color: req.body.color }),
        });
        emitCategoriesChanged(req.user!.tenantId, {
          action: 'created',
          categoryId: category.id,
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
    validateParams(idParamSchema),
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

          const patch: {
            name?: string;
            sortOrder?: number;
            icon?: string;
            color?: string;
          } = {};
          if (req.body.name !== undefined) patch.name = req.body.name;
          if (req.body.sortOrder !== undefined) patch.sortOrder = req.body.sortOrder;
          if (req.body.icon !== undefined) patch.icon = req.body.icon;
          if (req.body.color !== undefined) patch.color = req.body.color;

          const row = await repo.update(tenantId, categoryId, patch);
          if (row === null) {
            throw domainError('MENU_CATEGORY_NOT_FOUND', 404);
          }

          // Audit — sanitize whitelist 'menu.category.updated': category_id,
          // changed_fields, name_before/after, sort_order_before/after,
          // icon_before/after, color_before/after.
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
              icon_before: existing.icon,
              icon_after: row.icon,
              color_before: existing.color,
              color_after: row.color,
            },
          });

          return row;
        });

        emitCategoriesChanged(tenantId, {
          action: 'updated',
          categoryId: updated.id,
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
    validateParams(idParamSchema),
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

          // ADR-012 Karar 6 cascade: kategori soft delete olunca attribute
          // group link satırları aynı transaction'da hard DELETE.
          const cagRepo = createCategoryAttributeGroupsRepository(trx);
          await cagRepo.unassignByCategoryId(tenantId, categoryId);

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

        emitCategoriesChanged(tenantId, { action: 'deleted', categoryId });
        res.status(204).end();
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * POST /menu/categories/:id/products/reorder — admin-only bulk reorder.
   *
   * Sprint 8c PR-E4 (Migration 016 sort_order). Body: `{ productIds: string[] }`
   * — dizinin index'i yeni sort_order. Tenant + category scoped; cross-tenant
   * veya cross-category id sessizce skip (tenant guard, no enumeration).
   *
   * Tek transaction: kategori existence guard + repo.reorder + audit.
   * Kategori yoksa 404 MENU_CATEGORY_NOT_FOUND.
   */
  router.post(
    '/categories/:id/products/reorder',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    validateBody(ProductReorderRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const categoryId = req.params.id as string;
        const { productIds } = req.body as { productIds: string[] };

        await deps.db.transaction().execute(async (trx) => {
          const catRepo = createCategoriesRepository(trx);
          const category = await catRepo.findById(tenantId, categoryId);
          if (category === null) {
            throw domainError('MENU_CATEGORY_NOT_FOUND', 404);
          }

          const productsRepo = createProductsRepository(trx);
          await productsRepo.reorder(tenantId, categoryId, productIds);

          await writeAudit(trx, {
            tenantId,
            eventType: 'menu_category.products_reordered',
            actorUserId: req.user!.userId,
            entityType: 'menu_category',
            entityId: categoryId,
            rawPayload: {
              category_id: categoryId,
              count: productIds.length,
            },
          });
        });

        emitCategoriesChanged(tenantId, {
          action: 'products_reordered',
          categoryId,
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
