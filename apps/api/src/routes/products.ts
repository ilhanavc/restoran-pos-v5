import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely, Transaction } from 'kysely';
import {
  createProductsRepository,
  createCategoriesRepository,
  createProductAttributeGroupsRepository,
  RepositoryError,
  type DB,
  type ProductRow,
  type ProductVariantRow,
} from '@restoran-pos/db';
import {
  ProductCreateRequestSchema,
  ProductUpdateRequestSchema,
  type Product,
  type ProductVariant,
  type ProductVariantWrite,
  type ProductWithVariants,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  validateBody,
  validateParams,
  idParamSchema,
} from '../middleware/validate.js';
import { writeAudit } from '../audit/writeAudit.js';
import { AuthError, AUTH_MESSAGE_KEYS, domainError } from '../errors.js';

export interface ProductsRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * ProductRow → Product API projection.
 */
function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    categoryId: row.category_id,
    name: row.name,
    priceCents: row.price_cents,
    description: row.description,
    barcode: row.barcode,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    deletedAt: row.deleted_at === null ? null : row.deleted_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** ProductVariantRow → ProductVariant API projection. */
function toVariant(row: ProductVariantRow): ProductVariant {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    name: row.name,
    priceDeltaCents: row.price_delta_cents,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    deletedAt: row.deleted_at === null ? null : row.deleted_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Insert nested variants tek transaction içinde. Çağıran transaction'a sahiptir;
 * `is_default` kuralı zod superRefine ile validate edilmiştir.
 */
async function insertVariants(
  trx: Transaction<DB>,
  tenantId: string,
  productId: string,
  variants: ProductVariantWrite[],
): Promise<ProductVariantRow[]> {
  const repo = createProductsRepository(trx);
  const out: ProductVariantRow[] = [];
  for (let i = 0; i < variants.length; i += 1) {
    const v = variants[i]!;
    const created = await repo.createVariant({
      id: v.id ?? randomUUID(),
      tenantId,
      productId,
      name: v.name,
      priceDeltaCents: v.priceDeltaCents,
      isDefault: v.isDefault === true,
      sortOrder: v.sortOrder ?? i,
    });
    out.push(created);
  }
  return out;
}

/**
 * PATCH variants declarative replace (ADR-003 §8.6 K1):
 *  - Body'de gelen variant id'leri mevcut active set ile karşılaştırılır
 *  - Mevcut + body → UPDATE
 *  - Body'de yeni (id yok veya unknown) → INSERT
 *  - Mevcut ama body'de yok → SOFT DELETE
 *  - is_default promote: default soft delete edilirse en küçük sort_order
 *    aktif variant'a is_default=true (K3)
 *
 * Counters: { added, updated, deleted } audit payload için.
 */
async function replaceVariants(
  trx: Transaction<DB>,
  tenantId: string,
  productId: string,
  incoming: ProductVariantWrite[],
): Promise<{
  rows: ProductVariantRow[];
  added: number;
  updated: number;
  deleted: number;
}> {
  const repo = createProductsRepository(trx);
  const existing = await repo.findActiveVariantsByProductId(tenantId, productId);
  const existingById = new Map<string, ProductVariantRow>();
  for (const e of existing) existingById.set(e.id, e);

  // Body'de gelen id'ler set
  const incomingIds = new Set<string>();
  for (const v of incoming) {
    if (v.id !== undefined && existingById.has(v.id)) {
      incomingIds.add(v.id);
    }
  }

  // Soft delete: existing'de var ama body'de yok
  let deletedCount = 0;
  let defaultWasDeleted = false;
  for (const e of existing) {
    if (!incomingIds.has(e.id)) {
      await repo.softDeleteVariant(tenantId, e.id);
      deletedCount += 1;
      if (e.is_default === true) defaultWasDeleted = true;
    }
  }

  // Insert + Update
  let addedCount = 0;
  let updatedCount = 0;
  for (let i = 0; i < incoming.length; i += 1) {
    const v = incoming[i]!;
    if (v.id !== undefined && existingById.has(v.id)) {
      // Update
      await repo.updateVariant(tenantId, v.id, {
        name: v.name,
        priceDeltaCents: v.priceDeltaCents,
        ...(v.isDefault !== undefined && { isDefault: v.isDefault }),
        ...(v.sortOrder !== undefined && { sortOrder: v.sortOrder }),
      });
      updatedCount += 1;
    } else {
      // Insert (id verilmiş ama existing değilse de — mismatch — yeni kabul et,
      // çünkü id farklı tenant olabilir; createVariant tenant_id'yi zorlar.)
      await repo.createVariant({
        id: v.id ?? randomUUID(),
        tenantId,
        productId,
        name: v.name,
        priceDeltaCents: v.priceDeltaCents,
        isDefault: v.isDefault === true,
        sortOrder: v.sortOrder ?? i,
      });
      addedCount += 1;
    }
  }

  // is_default promote (ADR-003 §8.6 K3): default silindiyse + body'de yeni
  // default yoksa, kalan aktif variantlardan en küçük sort_order'a is_default=true.
  // NOT: MVP'de bu blok HTTP path'inde dead code — `refineVariantsIsDefault`
  // (menu.ts) "no_default" durumunu 422 ile reddediyor. v5.1 variant-tekil
  // DELETE endpoint'i eklendiğinde aktifleşecek (defansif tut, silme).
  if (defaultWasDeleted) {
    const remaining = await repo.findActiveVariantsByProductId(tenantId, productId);
    const hasDefault = remaining.some((r) => r.is_default === true);
    if (!hasDefault && remaining.length > 0) {
      const promoteTarget = remaining[0]!; // sort_order asc, name asc
      await repo.updateVariant(tenantId, promoteTarget.id, { isDefault: true });
    }
  }

  // Final state
  const rows = await repo.findActiveVariantsByProductId(tenantId, productId);
  return { rows, added: addedCount, updated: updatedCount, deleted: deletedCount };
}

/**
 * Products + Variants CRUD — admin-only (ADR-003 §8.6 4 karar 2026-04-27 +
 * Amendment 2026-04-28).
 *
 * Endpoints:
 *  - POST   /products        201 + nested variants (TEK transaction)
 *  - GET    /products        200 list (N+1 yasak: tek SELECT IN)
 *  - PATCH  /products/:id    200 declarative replace (variants opsiyonel)
 *  - DELETE /products/:id    204 cascade soft delete (TEK transaction)
 */
export function productsRouter(deps: ProductsRouterDeps): ExpressRouter {
  const router = Router();

  /**
   * POST /products — admin nested write (ADR-003 §8.6 K1).
   * 201 ProductWithVariants. category_id geçersiz → 404 MENU_CATEGORY_NOT_FOUND.
   * Tek transaction: parent INSERT + variants INSERT + audit.
   */
  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(ProductCreateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const productId = randomUUID();

        const result = await deps.db.transaction().execute(async (trx) => {
          // Category FK önceden doğrula → 404 MENU_CATEGORY_NOT_FOUND.
          // (Direkt INSERT FK violation'a güvenmek yerine handler katmanında
          // 404 + tenant scoped lookup → cross-tenant enumeration sızdırılmaz.)
          const catRepo = createCategoriesRepository(trx);
          const category = await catRepo.findById(tenantId, req.body.categoryId);
          if (category === null) {
            throw domainError('MENU_CATEGORY_NOT_FOUND', 404);
          }

          const repo = createProductsRepository(trx);
          const productRow = await repo.create({
            id: productId,
            tenantId,
            categoryId: req.body.categoryId,
            name: req.body.name,
            priceCents: req.body.priceCents,
            ...(req.body.description !== undefined && { description: req.body.description }),
            ...(req.body.barcode !== undefined && { barcode: req.body.barcode }),
            ...(req.body.isActive !== undefined && { isActive: req.body.isActive }),
          });

          const variants = req.body.variants ?? [];
          const variantRows = await insertVariants(
            trx,
            tenantId,
            productRow.id,
            variants,
          );

          await writeAudit(trx, {
            tenantId,
            eventType: 'product.created',
            actorUserId: req.user!.userId,
            entityType: 'product',
            entityId: productRow.id,
            rawPayload: {
              product_id: productRow.id,
              category_id: productRow.category_id,
              variants_count: variantRows.length,
            },
          });

          return { productRow, variantRows };
        });

        const response: ProductWithVariants = {
          ...toProduct(result.productRow),
          variants: result.variantRows.map(toVariant),
        };
        res.status(201).json({ data: { product: response } });
        return;
      } catch (err) {
        // Repository foreign_key → MENU_CATEGORY_NOT_FOUND (yarış senaryosu).
        if (err instanceof RepositoryError && err.cause === 'foreign_key') {
          return next(domainError('MENU_CATEGORY_NOT_FOUND', 404));
        }
        return next(err);
      }
    },
  );

  /**
   * GET /products — admin list, ADR-003 §8.6 K4 N+1 yasak.
   * Tek SELECT IN: products list + variants WHERE product_id = ANY(...).
   * Tenant-scoped, deleted_at IS NULL, max 500 hard-cap.
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const repo = createProductsRepository(deps.db);
        const productRows = await repo.findMany(tenantId);

        const ids = productRows.map((p) => p.id);
        // ADR-003 §8.6 K4: N+1 query döngüsü YASAK — tek SELECT IN.
        const variantRows =
          ids.length === 0
            ? []
            : await repo.findVariantsByProductIds(tenantId, ids);

        const variantsByProduct = new Map<string, ProductVariantRow[]>();
        for (const v of variantRows) {
          const list = variantsByProduct.get(v.product_id);
          if (list === undefined) {
            variantsByProduct.set(v.product_id, [v]);
          } else {
            list.push(v);
          }
        }

        const products: ProductWithVariants[] = productRows.map((p) => ({
          ...toProduct(p),
          variants: (variantsByProduct.get(p.id) ?? []).map(toVariant),
        }));

        res.status(200).json({ data: { products } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /products/:id — admin partial update (ADR-003 §8.6 K1).
   * `variants` body'de varsa declarative replace; yoksa variants dokunulmaz.
   * `variants: []` → tüm variants soft delete.
   */
  router.patch(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    validateBody(ProductUpdateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const productId = req.params.id as string;

        const result = await deps.db.transaction().execute(async (trx) => {
          const repo = createProductsRepository(trx);
          const existing = await repo.findById(tenantId, productId);
          if (existing === null) {
            throw domainError('MENU_PRODUCT_NOT_FOUND', 404);
          }

          // Category FK doğrula (varsa) → 404 MENU_CATEGORY_NOT_FOUND.
          if (req.body.categoryId !== undefined) {
            const catRepo = createCategoriesRepository(trx);
            const category = await catRepo.findById(
              tenantId,
              req.body.categoryId,
            );
            if (category === null) {
              throw domainError('MENU_CATEGORY_NOT_FOUND', 404);
            }
          }

          // Parent partial update (en az bir scalar alan dolu mu?)
          let productRow: ProductRow = existing;
          const scalarChanges: string[] = [];
          if (
            req.body.categoryId !== undefined ||
            req.body.name !== undefined ||
            req.body.priceCents !== undefined ||
            req.body.description !== undefined ||
            req.body.barcode !== undefined ||
            req.body.isActive !== undefined
          ) {
            const updated = await repo.update(tenantId, productId, {
              ...(req.body.categoryId !== undefined && {
                categoryId: req.body.categoryId,
              }),
              ...(req.body.name !== undefined && { name: req.body.name }),
              ...(req.body.priceCents !== undefined && {
                priceCents: req.body.priceCents,
              }),
              ...(req.body.description !== undefined && {
                description: req.body.description,
              }),
              ...(req.body.barcode !== undefined && { barcode: req.body.barcode }),
              ...(req.body.isActive !== undefined && { isActive: req.body.isActive }),
            });
            if (updated === null) {
              throw domainError('MENU_PRODUCT_NOT_FOUND', 404);
            }
            productRow = updated;
            if (req.body.categoryId !== undefined) scalarChanges.push('categoryId');
            if (req.body.name !== undefined) scalarChanges.push('name');
            if (req.body.priceCents !== undefined) scalarChanges.push('priceCents');
            if (req.body.description !== undefined) scalarChanges.push('description');
            if (req.body.barcode !== undefined) scalarChanges.push('barcode');
            if (req.body.isActive !== undefined) scalarChanges.push('isActive');
          }

          // Variants declarative replace (ADR-003 §8.6 K1)
          let variantsAdded = 0;
          let variantsUpdated = 0;
          let variantsDeleted = 0;
          let finalVariants: ProductVariantRow[];
          if (req.body.variants === undefined) {
            // Body'de yok → variants dokunulmaz; sadece son durumu çek.
            finalVariants = await repo.findActiveVariantsByProductId(
              tenantId,
              productId,
            );
          } else {
            const replaceResult = await replaceVariants(
              trx,
              tenantId,
              productId,
              req.body.variants,
            );
            finalVariants = replaceResult.rows;
            variantsAdded = replaceResult.added;
            variantsUpdated = replaceResult.updated;
            variantsDeleted = replaceResult.deleted;
            scalarChanges.push('variants');
          }

          await writeAudit(trx, {
            tenantId,
            eventType: 'product.updated',
            actorUserId: req.user!.userId,
            entityType: 'product',
            entityId: productRow.id,
            rawPayload: {
              product_id: productRow.id,
              changed_fields: scalarChanges,
              variants_added: variantsAdded,
              variants_updated: variantsUpdated,
              variants_deleted: variantsDeleted,
            },
          });

          return { productRow, variantRows: finalVariants };
        });

        const response: ProductWithVariants = {
          ...toProduct(result.productRow),
          variants: result.variantRows.map(toVariant),
        };
        res.status(200).json({ data: { product: response } });
        return;
      } catch (err) {
        if (err instanceof RepositoryError && err.cause === 'foreign_key') {
          return next(domainError('MENU_CATEGORY_NOT_FOUND', 404));
        }
        return next(err);
      }
    },
  );

  /**
   * DELETE /products/:id — admin cascade soft delete (ADR-003 §8.6 K2).
   * Tek transaction: product UPDATE + variants UPDATE + audit INSERT.
   */
  router.delete(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const productId = req.params.id as string;

        await deps.db.transaction().execute(async (trx) => {
          const repo = createProductsRepository(trx);
          const existing = await repo.findById(tenantId, productId);
          if (existing === null) {
            throw domainError('MENU_PRODUCT_NOT_FOUND', 404);
          }

          // Aktif variant sayısını al (audit counter için), sonra cascade soft delete.
          const activeVariants = await repo.findActiveVariantsByProductId(
            tenantId,
            productId,
          );
          await repo.softDelete(tenantId, productId);
          await repo.softDeleteVariantsByProductId(tenantId, productId);

          // ADR-012 Karar 6 cascade: ürün soft delete olunca attribute group
          // link satırları aynı transaction'da hard DELETE.
          const pagRepo = createProductAttributeGroupsRepository(trx);
          await pagRepo.unassignByProductId(tenantId, productId);

          await writeAudit(trx, {
            tenantId,
            eventType: 'product.deleted',
            actorUserId: req.user!.userId,
            entityType: 'product',
            entityId: productId,
            rawPayload: {
              product_id: productId,
              soft_delete: true,
              variants_cascade_count: activeVariants.length,
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
