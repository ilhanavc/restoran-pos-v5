import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import {
  createOrdersRepository,
  createUsersRepository,
  RepositoryError,
  type DB,
  type OrderItemSnapshot,
} from '@restoran-pos/db';
import {
  OrderCreateApiRequestSchema,
  OrderListQuerySchema,
  OrderAddItemsRequestSchema,
  OrderItemUpdateSchema,
  type OrderItemCreateInput,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  validateBody,
  validateParams,
  idParamSchema,
} from '../middleware/validate.js';
import { domainError } from '../errors.js';
import { parseDateParam, todayStoreDate } from '../utils/store-date.js';

export interface OrdersRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * Order item snapshot resolver — handler katmanı (ADR-013 §2 server-side
 * fiyat otoritesi). Products + categories tablolarından batch fetch ile
 * N+1 sorgusu engellenir; UI değerleri YOK SAYILIR.
 *
 * PR-4 kapsamı (sade):
 *   - product_id, quantity, note → product.name + category.name +
 *     unit_price_cents = product.price_cents
 *   - Variant + attribute extra_price PR-6'da `OrderItemCreateInputSchemaV2`
 *     ile eklenir; o aşamada formül `product.price + variant.delta + Σ extra_price`.
 *
 * Hatalar:
 *   - PRODUCT_NOT_FOUND (404): bilinmeyen product_id
 *   - PRODUCT_INACTIVE (400): admin pasif yapmış ürün
 */
async function resolveItemSnapshots(
  db: Kysely<DB>,
  tenantId: string,
  inputs: ReadonlyArray<OrderItemCreateInput>,
  actorUserId: string,
  actorName: string,
): Promise<OrderItemSnapshot[]> {
  if (inputs.length === 0) return [];

  const uniqueProductIds = [...new Set(inputs.map((i) => i.productId))];

  const rows = await db
    .selectFrom('products')
    .innerJoin('categories', (join) =>
      join
        .onRef('categories.id', '=', 'products.category_id')
        .onRef('categories.tenant_id', '=', 'products.tenant_id'),
    )
    .select([
      'products.id as product_id',
      'products.name as product_name',
      'products.price_cents as price_cents',
      'products.is_active as is_active',
      'categories.name as category_name',
    ])
    .where('products.tenant_id', '=', tenantId)
    .where('products.deleted_at', 'is', null)
    .where('products.id', 'in', uniqueProductIds)
    .execute();

  const byId = new Map(rows.map((r) => [r.product_id, r]));

  return inputs.map((input) => {
    const p = byId.get(input.productId);
    if (p === undefined) {
      throw domainError('PRODUCT_NOT_FOUND', 404);
    }
    if (!p.is_active) {
      throw domainError('PRODUCT_INACTIVE', 400);
    }

    const unitPriceCents = p.price_cents;
    const totalCents = unitPriceCents * input.quantity;

    return {
      id: randomUUID(),
      productId: input.productId,
      productName: p.product_name,
      categoryNameSnapshot: p.category_name,
      unitPriceCents,
      quantity: input.quantity,
      totalCents,
      note: input.note ?? null,
      createdByUserId: actorUserId,
      createdByName: actorName,
    };
  });
}

export function ordersRouter(deps: OrdersRouterDeps): ExpressRouter {
  const router = Router();

  /**
   * POST /orders — yeni sipariş + opsiyonel items[] atomik insert.
   * ADR-013 §1 (saf local cart) + §2 (snapshot server-side) + §9.1 (status='open').
   *
   * Kapsam (PR-4):
   *   - items[] varsa snapshot resolve + atomik insert (tek transaction)
   *   - 201 + nested order { items[] } response
   *   - Idempotency key YOK (v5.1 forward-ref)
   */
  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    validateBody(OrderCreateApiRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;

        // Actor name lookup (ADR-013 §5 actor rozeti) — JWT'de username yok,
        // DB'den `users.username` çek.
        const usersRepo = createUsersRepository(deps.db);
        const actor = await usersRepo.findById(tenantId, actorUserId);
        if (actor === null) {
          throw domainError('USER_NOT_FOUND', 401);
        }

        const inputItems: ReadonlyArray<OrderItemCreateInput> = req.body.items ?? [];
        const snapshots = await resolveItemSnapshots(
          deps.db,
          tenantId,
          inputItems,
          actorUserId,
          actor.username,
        );

        const repo = createOrdersRepository(deps.db);
        const order = await repo.create(
          tenantId,
          {
            id: randomUUID(),
            tableId: req.body.tableId,
            orderType: req.body.orderType,
            note: req.body.note ?? null,
            customerId: req.body.customerId ?? null,
            storeDate: todayStoreDate(),
            waiterUserId: actorUserId,
          },
          snapshots,
        );

        // Items nested response için yeniden çek (canonical hali için).
        const withItems = await repo.findByIdWithItems(tenantId, order.id);
        res.status(201).json({
          data: { order: withItems!.order, items: withItems!.items },
        });
        return;
      } catch (err) {
        if (err instanceof RepositoryError) {
          if (err.cause === 'unique' && err.messageKey === 'TABLE_ALREADY_OCCUPIED') {
            return next(domainError('TABLE_ALREADY_OCCUPIED', 409));
          }
          if (err.cause === 'foreign_key' && err.messageKey === 'TABLE_NOT_FOUND') {
            return next(domainError('TABLE_NOT_FOUND', 404));
          }
          if (err.cause === 'foreign_key' && err.messageKey === 'CUSTOMER_NOT_FOUND') {
            return next(domainError('CUSTOMER_NOT_FOUND', 404));
          }
          if (err.cause === 'check' && err.messageKey === 'ORDER_INVARIANT_VIOLATED') {
            return next(domainError('ORDER_INVARIANT_VIOLATED', 409));
          }
        }
        return next(err);
      }
    },
  );

  /**
   * POST /orders/:id/items — mevcut siparişe kalem ekleme (Kaydet sonraki kez).
   * Closed/cancelled order → 409 ORDER_INVARIANT_VIOLATED.
   */
  router.post(
    '/:id/items',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    validateParams(idParamSchema),
    validateBody(OrderAddItemsRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const orderId = req.params.id as string;

        const usersRepo = createUsersRepository(deps.db);
        const actor = await usersRepo.findById(tenantId, actorUserId);
        if (actor === null) {
          throw domainError('USER_NOT_FOUND', 401);
        }

        const snapshots = await resolveItemSnapshots(
          deps.db,
          tenantId,
          req.body.items,
          actorUserId,
          actor.username,
        );

        const repo = createOrdersRepository(deps.db);
        const result = await repo.addItems(tenantId, orderId, snapshots);

        res.status(200).json({
          data: { order: result.order, items: result.items },
        });
        return;
      } catch (err) {
        if (err instanceof RepositoryError) {
          if (err.cause === 'not_found') {
            return next(domainError('ORDER_NOT_FOUND', 404));
          }
          if (err.cause === 'check') {
            return next(domainError('ORDER_INVARIANT_VIOLATED', 409));
          }
        }
        return next(err);
      }
    },
  );

  /**
   * PATCH /orders/:orderId/items/:itemId — persisted kalem partial update
   * (ADR-013 §6 + §9.2 + v3 `canVoidOrderItem` paritesi).
   *
   * RBAC kuralları:
   *   - `note` partial: tüm staff (admin/cashier/waiter)
   *   - `status='cancelled'` (void):
   *       item.status='new' → tüm staff
   *       item.status !== 'new' → admin/cashier only (mutfağa gönderilmiş kalem)
   *   - `is_comped` toggle: admin/cashier only (ADR-013 §9.2; kitchen + waiter 403)
   *
   * 404: ORDER_NOT_FOUND / ORDER_ITEM_NOT_FOUND
   * 409: ORDER_INVARIANT_VIOLATED (closed/cancelled order)
   * 403: AUTH_FORBIDDEN (yetkisiz comp/void)
   */
  router.patch(
    '/:orderId/items/:itemId',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    validateBody(OrderItemUpdateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const orderId = req.params.orderId as string;
        const itemId = req.params.itemId as string;
        const role = req.user!.role;
        const repo = createOrdersRepository(deps.db);

        // Mevcut item'ı pre-fetch — yetki kararları için status gerekiyor.
        const current = await repo.findByIdWithItems(tenantId, orderId);
        if (current === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        const targetItem = current.items.find((it) => it.id === itemId);
        if (targetItem === undefined) {
          return next(domainError('ORDER_ITEM_NOT_FOUND', 404));
        }

        // RBAC §9.2: comp toggle yalnız admin/cashier.
        if (req.body.isComped !== undefined && role !== 'admin' && role !== 'cashier') {
          return next(domainError('AUTH_FORBIDDEN', 403));
        }

        // RBAC §6: void (status='cancelled') yetkisi.
        // status='new' kalemi → her staff void edebilir.
        // status !== 'new' (mutfağa gönderilmiş) → yalnız admin/cashier.
        if (
          req.body.status === 'cancelled' &&
          targetItem.status !== 'new' &&
          role !== 'admin' &&
          role !== 'cashier'
        ) {
          return next(domainError('AUTH_FORBIDDEN', 403));
        }

        const result = await repo.updateItem(tenantId, orderId, itemId, {
          ...(req.body.note !== undefined && { note: req.body.note }),
          ...(req.body.status !== undefined && { status: req.body.status }),
          ...(req.body.isComped !== undefined && { isComped: req.body.isComped }),
        });

        res.status(200).json({
          data: { order: result.order, items: result.items },
        });
        return;
      } catch (err) {
        if (err instanceof RepositoryError) {
          if (err.cause === 'not_found') {
            const code =
              err.messageKey === 'ORDER_NOT_FOUND'
                ? 'ORDER_NOT_FOUND'
                : 'ORDER_ITEM_NOT_FOUND';
            return next(domainError(code, 404));
          }
          if (err.cause === 'check') {
            return next(domainError('ORDER_INVARIANT_VIOLATED', 409));
          }
        }
        return next(err);
      }
    },
  );

  /**
   * GET /orders/:id — tek sipariş + items nested.
   * RBAC: admin/cashier/kitchen tüm; waiter yalnız `waiter_user_id === self`
   * (ADR-008 §1 kuralı GET listesindeki gibi).
   */
  router.get(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter', 'kitchen']),
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const orderId = req.params.id as string;
        const repo = createOrdersRepository(deps.db);

        const result = await repo.findByIdWithItems(tenantId, orderId);
        if (result === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        if (
          req.user!.role === 'waiter' &&
          result.order.waiter_user_id !== req.user!.userId
        ) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }

        res.status(200).json({
          data: { order: result.order, items: result.items },
        });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * GET /orders — ABAC kuralı (ADR-008 §1/§2/§3):
   * - admin/cashier/kitchen: tüm siparişler (tenant-scoped).
   * - waiter: sadece kendi `waiter_user_id`'si eşleşen satırlar.
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter', 'kitchen']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = OrderListQuerySchema.safeParse(req.query);
        if (!parsed.success) return next(parsed.error);

        const storeDate =
          parsed.data.storeDate !== undefined
            ? parseDateParam(parsed.data.storeDate)
            : todayStoreDate();

        const baseFilters = {
          ...(parsed.data.status !== undefined && { status: parsed.data.status }),
          ...(parsed.data.tableId !== undefined && { tableId: parsed.data.tableId }),
          ...(parsed.data.orderType !== undefined && { orderType: parsed.data.orderType }),
          storeDate,
        };
        const filters =
          req.user!.role === 'waiter'
            ? { ...baseFilters, waiterUserId: req.user!.userId }
            : baseFilters;

        const repo = createOrdersRepository(deps.db);
        const orders = await repo.findMany(req.user!.tenantId, filters);
        res.status(200).json({ data: { orders } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
