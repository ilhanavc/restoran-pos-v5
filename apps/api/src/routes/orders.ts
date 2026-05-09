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
  createOrdersRepository,
  createProductAttributeGroupsRepository,
  createUsersRepository,
  RepositoryError,
  type DB,
  type OrderItemSnapshot,
} from '@restoran-pos/db';
import {
  CreateOrderRequestSchema,
  OrderAssignCustomerSchema,
  OrderCreateApiRequestSchema,
  OrderListQuerySchema,
  OrderAddItemsRequestSchema,
  OrderItemStatusUpdateSchema,
  OrderItemUpdateSchema,
  OrderUpdateSchema,
  TakeawayListQuerySchema,
  UpdateTakeawayStageInputSchema,
  type CreateTakeawayOrderInput,
  type OrderItemCreateInput,
  type TakeawayStage,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  validateBody,
  validateParams,
  validateQuery,
  idParamSchema,
} from '../middleware/validate.js';
import { domainError } from '../errors.js';
import { parseDateParam, todayStoreDate } from '../utils/store-date.js';
import { writeAudit } from '../audit/writeAudit.js';
import {
  applyAttributeSnapshot,
  resolveItemAttributes,
} from '../domain/orders/resolveItemAttributes.js';

export interface OrdersRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
  /**
   * ADR-017 — Socket.IO server. Optional: test'lerde stub'lanır, prod
   * `index.ts` createRealtimeServer().io geçer. `undefined` ise emit no-op.
   */
  io?: IoServer;
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

  // PR-6 §11 — variant batch fetch (yalnız variantId set olanlar).
  const variantIds = inputs
    .map((i) => i.variantId)
    .filter((v): v is string => v !== undefined);
  const variantById = new Map<
    string,
    { id: string; product_id: string; name: string; price_delta_cents: number }
  >();
  if (variantIds.length > 0) {
    const variantRows = await db
      .selectFrom('product_variants')
      .select(['id', 'product_id', 'name', 'price_delta_cents'])
      .where('tenant_id', '=', tenantId)
      .where('deleted_at', 'is', null)
      .where('id', 'in', [...new Set(variantIds)])
      .execute();
    for (const v of variantRows) variantById.set(v.id, v);
  }

  const baseSnapshots: OrderItemSnapshot[] = inputs.map((input) => {
    const p = byId.get(input.productId);
    if (p === undefined) {
      throw domainError('PRODUCT_NOT_FOUND', 404);
    }
    if (!p.is_active) {
      throw domainError('PRODUCT_INACTIVE', 400);
    }

    // §11 — variant lookup + ownership check
    let variantDelta = 0;
    let variantSnapshot: {
      variantIdSnapshot: string;
      variantNameSnapshot: string;
      variantPriceDeltaCentsSnapshot: number;
    } | null = null;
    if (input.variantId !== undefined) {
      const v = variantById.get(input.variantId);
      if (v === undefined || v.product_id !== input.productId) {
        throw domainError('VARIANT_NOT_FOUND', 400);
      }
      variantDelta = v.price_delta_cents;
      variantSnapshot = {
        variantIdSnapshot: v.id,
        variantNameSnapshot: v.name,
        variantPriceDeltaCentsSnapshot: v.price_delta_cents,
      };
    }

    const unitPriceCents = p.price_cents + variantDelta;
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
      ...(variantSnapshot ?? {}),
    };
  });

  // PR-6 (ADR-013 §10): selectedAttributes resolve. is_required/single
  // validasyon DB'den effective groups ile yapılır; extra_price_cents
  // unit_price_cents'e yapışır (applyAttributeSnapshot).
  const productAttrRepo = createProductAttributeGroupsRepository(db);
  const enriched: OrderItemSnapshot[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const base = baseSnapshots[i]!;
    const resolved = await resolveItemAttributes(
      db,
      productAttrRepo,
      tenantId,
      input.productId,
      input.selectedAttributes ?? [],
    );
    enriched.push(applyAttributeSnapshot(base, resolved));
  }
  return enriched;
}

export function ordersRouter(deps: OrdersRouterDeps): ExpressRouter {
  const router = Router();

  // ============================================================
  // ADR-017 — Paket servis (takeaway) endpoint'leri (Session C).
  //
  // POST /orders gövdesinde `type: 'takeaway'` ise bu handler devralır;
  // değilse `next('route')` ile sonraki handler'a (dine_in legacy)
  // düşer. Kapsam: yalnız takeaway dalı; dine_in Phase 3'te discriminated
  // union'a alınacak.
  // ============================================================

  /**
   * `tenant:{tenantId}` room'una event yayınlayan minimal helper.
   * Direct `io.emit` apps/api'de ESLint `no-restricted-syntax` ile yasak;
   * burası ADR-010 §11.3 emit path'i (eslint config exception path).
   * deps.io undefined ise no-op (test stub uyumluluğu).
   */
  function emitTenant(
    tenantId: string,
    event:
      | 'order:created'
      | 'order:status_changed'
      | 'order:cancelled'
      | 'order:customer_assigned',
    payload: Record<string, unknown>,
  ): void {
    if (deps.io === undefined) return;
    deps.io
      .of('/realtime')
      .to(`tenant:${tenantId}`)
      .emit(event, payload);
  }

  /**
   * Müşteri adres satırını "addressLine, neighborhood, district" şeklinde
   * tek satıra serialize eder; null/boş alanları atlar. Snapshot text;
   * audit/UI için hazır görüntü.
   */
  function formatAddressSnapshot(addr: {
    address_line: string;
    neighborhood: string | null;
    district: string | null;
  }): string {
    const parts: string[] = [addr.address_line];
    if (addr.neighborhood !== null && addr.neighborhood.trim() !== '')
      parts.push(addr.neighborhood);
    if (addr.district !== null && addr.district.trim() !== '')
      parts.push(addr.district);
    return parts.join(', ');
  }

  /**
   * findOrderById çıktısını OrderResponseSchema'ya uygun camelCase DTO'ya
   * dönüştürür. KDV breakdown henüz yok (orders.total_cents tek otorite);
   * subtotal=total, tax=0 (v5.1+ tax engine).
   */
  function toOrderResponseDto(
    detail: NonNullable<
      Awaited<
        ReturnType<ReturnType<typeof createOrdersRepository>['findOrderById']>
      >
    >,
  ): Record<string, unknown> {
    const { order, items, customer } = detail;
    const primaryPhone =
      customer?.phones[0]?.normalized_phone ?? null;
    return {
      id: order.id,
      tenantId: order.tenant_id,
      type: order.order_type,
      status: order.status,
      tableId: order.table_id,
      orderNo: order.order_no,
      waiterUserId: order.waiter_user_id,
      takeawayStage: order.takeaway_stage,
      customerId: order.customer_id,
      customerName: customer?.full_name ?? null,
      customerPhone: primaryPhone,
      deliveryAddressSnapshot: order.delivery_address_snapshot,
      deliveryNote: order.delivery_note,
      plannedPaymentType: order.planned_payment_type,
      items: items.map((it) => ({
        id: it.id,
        productId: it.product_id,
        productName: it.product_name,
        quantity: it.quantity,
        unitPriceCents: it.unit_price_cents,
        lineTotalCents: it.total_cents,
        notes: it.note,
        createdByUserId: it.created_by_user_id,
        createdByName: it.created_by_name,
      })),
      subtotalCents: order.total_cents,
      taxCents: 0,
      totalCents: order.total_cents,
      createdAt: order.created_at.toISOString(),
      updatedAt: order.updated_at.toISOString(),
    };
  }

  /**
   * POST /orders — discriminated union dispatch (ADR-017 §3).
   * `type === 'takeaway'` → bu handler; aksi → `next('route')` legacy
   * dine_in handler'ına düşer.
   *
   * Akış:
   *   1. Müşteri exists + tenant match (yoksa 404 CUSTOMER_NOT_FOUND)
   *   2. customerAddressId verilirse adres satırı oku → snapshot text
   *   3. items[].productId batch resolve — DB unitPrice otoriter
   *   4. subtotal/total hesabı (kuruş, integer)
   *   5. Tek transaction: createTakeawayOrder + audit
   *   6. Socket emit + 201 OrderResponse
   */
  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    async (req: Request, res: Response, next: NextFunction) => {
      // Sadece takeaway dalını burada işle; dine_in legacy handler'a düşsün.
      if (req.body?.type !== 'takeaway') {
        return next('route');
      }
      const parsed = CreateOrderRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(parsed.error);
      }
      const input = parsed.data as CreateTakeawayOrderInput;

      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;

        // Actor name lookup (ADR-013 §5 actor rozeti) — JWT'de username yok,
        // DB'den `users.username` çek. dine_in pattern (orders.ts:660-668).
        const usersRepo = createUsersRepository(deps.db);
        const actor = await usersRepo.findById(tenantId, actorUserId);
        if (actor === null) {
          return next(domainError('USER_NOT_FOUND', 401));
        }
        const actorName = actor.username;

        // 1. Müşteri exists + tenant match.
        const customer = await deps.db
          .selectFrom('customers')
          .select(['id', 'full_name'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', input.customerId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (customer === undefined) {
          return next(domainError('CUSTOMER_NOT_FOUND', 404));
        }

        // 2. Adres snapshot (opsiyonel).
        let deliveryAddressSnapshot: string | null = null;
        if (input.customerAddressId !== undefined) {
          const addr = await deps.db
            .selectFrom('customer_addresses')
            .select(['address_line', 'neighborhood', 'district'])
            .where('tenant_id', '=', tenantId)
            .where('customer_id', '=', input.customerId)
            .where('id', '=', input.customerAddressId)
            .where('is_deleted', '=', false)
            .executeTakeFirst();
          if (addr === undefined) {
            return next(domainError('CUSTOMER_ADDRESS_NOT_FOUND', 404));
          }
          deliveryAddressSnapshot = formatAddressSnapshot(addr);
        }

        // 3. Ürün batch resolve — UI fiyatları YOK SAYILIR (ADR-013 §2).
        const productIds = [...new Set(input.items.map((i) => i.productId))];
        const products = await deps.db
          .selectFrom('products')
          .select(['id', 'name', 'price_cents', 'is_active'])
          .where('tenant_id', '=', tenantId)
          .where('deleted_at', 'is', null)
          .where('id', 'in', productIds)
          .execute();
        const productById = new Map(products.map((p) => [p.id, p]));

        const itemsResolved: Array<{
          productId: string;
          productNameSnapshot: string;
          quantity: number;
          unitPriceCents: number;
          notes: string | null;
          createdByUserId: string;
          createdByName: string;
        }> = [];
        for (const it of input.items) {
          const p = productById.get(it.productId);
          if (p === undefined) {
            return next(domainError('PRODUCT_NOT_FOUND', 404));
          }
          if (!p.is_active) {
            return next(domainError('PRODUCT_INACTIVE', 400));
          }
          itemsResolved.push({
            productId: p.id,
            productNameSnapshot: p.name,
            quantity: it.quantity,
            unitPriceCents: p.price_cents,
            notes: it.note ?? null,
            createdByUserId: actorUserId,
            createdByName: actorName,
          });
        }

        // 4. Toplam (KDV v5.1; subtotal=total).
        const totalCents = itemsResolved.reduce(
          (sum, it) => sum + it.unitPriceCents * it.quantity,
          0,
        );

        const orderId = randomUUID();
        const repo = createOrdersRepository(deps.db);

        // 5. Tek transaction: order + items insert + audit.
        await deps.db.transaction().execute(async (trx) => {
          await repo.createTakeawayOrder(trx, {
            id: orderId,
            tenantId,
            // ADR-008 §4.1: actor (admin/cashier/waiter) user_id'i geç → repo
            // INSERT'e yazar; ABAC waiter scope filter'ı bunu kullanır.
            waiterUserId: actorUserId,
            customerId: input.customerId,
            customerAddressId: input.customerAddressId ?? null,
            deliveryAddressSnapshot,
            deliveryNote: input.deliveryNote ?? null,
            plannedPaymentType: input.plannedPaymentType as 'cash' | 'card',
            items: itemsResolved,
            subtotalCents: totalCents,
            taxCents: 0,
            totalCents,
          });
          await writeAudit(trx, {
            tenantId,
            eventType: 'order.created',
            actorUserId,
            entityType: 'order',
            entityId: orderId,
            rawPayload: {
              order_id: orderId,
              type: 'takeaway',
              customer_id: input.customerId,
              total_cents: totalCents,
              item_count: itemsResolved.length,
              planned_payment_type: input.plannedPaymentType,
            },
          });
        });

        // 6. Socket emit + 201 detail.
        emitTenant(tenantId, 'order:created', {
          orderId,
          type: 'takeaway',
          takeawayStage: 'preparing',
          total_cents: totalCents,
        });

        // 6.1 KDS hook (ADR-020 K2 + K12): kitchen_print=true kategori
        // altındaki item'ları status='sent' set + kitchen.orderSent emit.
        // Transaction commit sonrası ayrı UPDATE — atomicity zayıf ama
        // defansif (eventual consistency; fail durumunda PATCH ile recovery).
        const kitchenItems = await deps.db
          .selectFrom('order_items')
          .innerJoin('products', (join) =>
            join
              .onRef('products.id', '=', 'order_items.product_id')
              .onRef('products.tenant_id', '=', 'order_items.tenant_id'),
          )
          .innerJoin('categories', (join) =>
            join
              .onRef('categories.id', '=', 'products.category_id')
              .onRef('categories.tenant_id', '=', 'products.tenant_id'),
          )
          .select([
            'order_items.id as id',
            'order_items.product_name as product_name',
            'order_items.quantity as quantity',
          ])
          .where('order_items.order_id', '=', orderId)
          .where('order_items.tenant_id', '=', tenantId)
          .where('categories.kitchen_print', '=', true)
          .execute();

        if (kitchenItems.length > 0) {
          await deps.db
            .updateTable('order_items')
            .set({ status: 'sent' })
            .where(
              'id',
              'in',
              kitchenItems.map((k) => k.id),
            )
            .where('tenant_id', '=', tenantId)
            .execute();

          if (deps.io !== undefined) {
            deps.io
              .of('/realtime')
              .to(`tenant:${tenantId}:role:kitchen`)
              .emit('kitchen.orderSent', {
                orderId,
                orderType: 'takeaway',
                items: kitchenItems.map((k) => ({
                  id: k.id,
                  productName: k.product_name,
                  quantity: k.quantity,
                })),
              });
          }
        }

        const detail = await repo.findOrderById(deps.db, tenantId, orderId);
        if (detail === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        res.status(201).json({ data: toOrderResponseDto(detail) });
        return;
      } catch (err) {
        if (err instanceof RepositoryError) {
          if (err.cause === 'foreign_key' && err.messageKey === 'CUSTOMER_NOT_FOUND') {
            return next(domainError('CUSTOMER_NOT_FOUND', 404));
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
   * GET /orders?type=takeaway&status=open — açık paket servis kuyruğu.
   * Sprint kapsamı: yalnız takeaway. type=takeaway filtresi yoksa
   * legacy handler'a düşer (next('route')).
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    // ADR-008 §1: GET /orders 4 rol için izinli (kitchen dahil). Takeaway
    // specific filter route handler içinde — kitchen `?type=takeaway` çağrısı
    // yapmazsa `next('route')` ile legacy handler'a düşer (200 OK).
    // Eğer authorize burada kitchen'i 403 atarsa Express zincirde sonraki
    // legacy handler'a hiç düşmez — kullanım hatası.
    authorize(['admin', 'cashier', 'waiter', 'kitchen']),
    validateQuery(TakeawayListQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      // Eski davranış: type filtresi yoksa legacy handler.
      if (req.query['type'] !== 'takeaway') {
        return next('route');
      }
      try {
        const tenantId = req.user!.tenantId;
        const repo = createOrdersRepository(deps.db);
        const rows = await repo.listOpenTakeawayOrders(deps.db, tenantId);
        res.status(200).json({
          data: rows.map((r) => ({
            id: r.id,
            orderNo: r.order_no,
            customerId: r.customer_id,
            customerName: r.customer_name,
            totalCents: r.total_cents,
            takeawayStage: r.takeaway_stage,
            plannedPaymentType: r.planned_payment_type,
            createdAt: r.created_at.toISOString(),
          })),
          total: rows.length,
        });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /orders/:id/takeaway-stage — stage transition.
   *
   * Allowed:
   *   preparing → out_for_delivery
   *   out_for_delivery → delivered (delivered = paid + payments insert tx-içi)
   *
   * 400 NOT_TAKEAWAY: takeaway_stage NULL (dine_in/delivery sipariş).
   * 409 INVALID_TRANSITION: kural dışı geçiş veya yarış (rowCount=0).
   */
  router.patch(
    '/:id/takeaway-stage',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    validateParams(idParamSchema),
    validateBody(UpdateTakeawayStageInputSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const orderId = req.params.id as string;
        const targetStage = req.body.stage as 'out_for_delivery' | 'delivered';
        const repo = createOrdersRepository(deps.db);

        const detailBefore = await repo.findOrderById(deps.db, tenantId, orderId);
        if (detailBefore === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        const currentStage = detailBefore.order.takeaway_stage;
        if (currentStage === null) {
          return next(domainError('NOT_TAKEAWAY', 400));
        }

        // Allowed transitions table.
        const validFrom: Record<typeof targetStage, TakeawayStage> = {
          out_for_delivery: 'preparing',
          delivered: 'out_for_delivery',
        };
        if (currentStage !== validFrom[targetStage]) {
          return next(domainError('INVALID_TRANSITION', 409));
        }

        const result = await deps.db.transaction().execute(async (trx) => {
          const r = await repo.updateTakeawayStage(
            trx,
            tenantId,
            orderId,
            currentStage,
            targetStage,
          );
          if (r.rowCount === 0) {
            // Yarış durumu: stage başkası tarafından değişti.
            throw domainError('INVALID_TRANSITION', 409);
          }
          await writeAudit(trx, {
            tenantId,
            eventType: 'order.takeaway_stage_changed',
            actorUserId,
            entityType: 'order',
            entityId: orderId,
            rawPayload: {
              order_id: orderId,
              from_stage: currentStage,
              to_stage: targetStage,
            },
          });
          if (r.paid === true) {
            await writeAudit(trx, {
              tenantId,
              eventType: 'order.paid',
              actorUserId,
              entityType: 'order',
              entityId: orderId,
              rawPayload: {
                order_id: orderId,
                payment_type:
                  detailBefore.order.planned_payment_type ?? 'cash',
                amount_cents: detailBefore.order.total_cents,
              },
            });
          }
          return r;
        });

        emitTenant(tenantId, 'order:status_changed', {
          orderId,
          takeawayStage: targetStage,
          paid: result.paid === true,
        });

        const detailAfter = await repo.findOrderById(deps.db, tenantId, orderId);
        if (detailAfter === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        res.status(200).json({ data: toOrderResponseDto(detailAfter) });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * POST /orders/:id/cancel — yalnız `status='open' AND stage='preparing'`.
   * Diğer durumlar 409 INVALID_STATE.
   * RBAC: admin only (parasal/operasyonel etki).
   */
  router.post(
    '/:id/cancel',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const orderId = req.params.id as string;
        const repo = createOrdersRepository(deps.db);

        const before = await repo.findOrderById(deps.db, tenantId, orderId);
        if (before === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }

        await deps.db.transaction().execute(async (trx) => {
          const r = await repo.cancelTakeawayOrder(trx, tenantId, orderId);
          if (r.rowCount === 0) {
            throw domainError('INVALID_STATE', 409);
          }
          await writeAudit(trx, {
            tenantId,
            eventType: 'order.cancelled',
            actorUserId,
            entityType: 'order',
            entityId: orderId,
            rawPayload: { order_id: orderId },
          });
        });

        emitTenant(tenantId, 'order:cancelled', { orderId });

        const after = await repo.findOrderById(deps.db, tenantId, orderId);
        if (after === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        res.status(200).json({ data: toOrderResponseDto(after) });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

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

        // Session 53b — ADR-003 + ADR-009 Amendment 2026-05-05.
        // tables hard delete pattern'inde rapor invariant'ı için INSERT öncesi
        // table.code + area.name snapshot çek (Migration 030 kolonları).
        // tableId null ise (takeaway/delivery) snapshot da null kalır.
        let tableCodeSnapshot: string | null = null;
        let areaNameSnapshot: string | null = null;
        if (req.body.tableId !== null && req.body.tableId !== undefined) {
          const tableRow = await deps.db
            .selectFrom('tables')
            .leftJoin('areas', (join) =>
              join
                .onRef('areas.id', '=', 'tables.area_id')
                .onRef('areas.tenant_id', '=', 'tables.tenant_id'),
            )
            .select(['tables.code as t_code', 'areas.name as a_name'])
            .where('tables.tenant_id', '=', tenantId)
            .where('tables.id', '=', req.body.tableId)
            .executeTakeFirst();
          if (tableRow !== undefined) {
            tableCodeSnapshot = tableRow.t_code;
            areaNameSnapshot = tableRow.a_name;
          }
        }

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
            tableCodeSnapshot,
            areaNameSnapshot,
          },
          snapshots,
        );

        // KDS hook (ADR-020 K2 + K12): kitchen_print=true kategori altındaki
        // item'ları status='sent' set + kitchen.orderSent emit. Takeaway POST
        // (l. 455-507) ile aynı pattern, dine_in dalı için eşleniği. Eventual
        // consistency: transaction sonrası ayrı UPDATE; fail durumunda PATCH
        // ile recovery edilir.
        const kitchenItemsDineIn = await deps.db
          .selectFrom('order_items')
          .innerJoin('products', (join) =>
            join
              .onRef('products.id', '=', 'order_items.product_id')
              .onRef('products.tenant_id', '=', 'order_items.tenant_id'),
          )
          .innerJoin('categories', (join) =>
            join
              .onRef('categories.id', '=', 'products.category_id')
              .onRef('categories.tenant_id', '=', 'products.tenant_id'),
          )
          .select([
            'order_items.id as id',
            'order_items.product_name as product_name',
            'order_items.quantity as quantity',
          ])
          .where('order_items.order_id', '=', order.id)
          .where('order_items.tenant_id', '=', tenantId)
          .where('categories.kitchen_print', '=', true)
          .execute();

        if (kitchenItemsDineIn.length > 0) {
          await deps.db
            .updateTable('order_items')
            .set({ status: 'sent' })
            .where(
              'id',
              'in',
              kitchenItemsDineIn.map((k) => k.id),
            )
            .where('tenant_id', '=', tenantId)
            .execute();

          if (deps.io !== undefined) {
            deps.io
              .of('/realtime')
              .to(`tenant:${tenantId}:role:kitchen`)
              .emit('kitchen.orderSent', {
                orderId: order.id,
                orderType: req.body.orderType,
                items: kitchenItemsDineIn.map((k) => ({
                  id: k.id,
                  productName: k.product_name,
                  quantity: k.quantity,
                })),
              });
          }
        }

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
  /**
   * PATCH /orders/:id — sipariş düzeyi güncelleme.
   *
   * ADR-014 §9.6 + §10.4 status transitions:
   *   - 'cancelled' → cancelOrder (sipariş iptali + masa boşalt)
   *   - 'paid' → payOrder (Mod B "Masayı Kapat" — zaten ödenmiş close)
   *
   * RBAC: admin/cashier (waiter+kitchen 403).
   *
   * Hatalar:
   *   - 404 ORDER_NOT_FOUND
   *   - 409 ORDER_CANCEL_NOT_ALLOWED (terminal status, cancel)
   *   - 409 ORDER_INVARIANT_VIOLATED (terminal status, paid)
   *   - 400 PAYMENT_INSUFFICIENT_FOR_CLOSE (paid amount < order total)
   */
  router.patch(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    validateParams(idParamSchema),
    validateBody(OrderUpdateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const orderId = req.params.id as string;
        const repo = createOrdersRepository(deps.db);
        const targetStatus = req.body.status as 'cancelled' | 'paid';
        const result =
          targetStatus === 'paid'
            ? await repo.payOrder(tenantId, orderId)
            : await repo.cancelOrder(tenantId, orderId);
        res.status(200).json({
          data: { order: result.order, items: result.items },
        });
        return;
      } catch (err) {
        if (err instanceof RepositoryError) {
          if (err.cause === 'not_found') {
            return next(domainError('ORDER_NOT_FOUND', 404));
          }
          if (err.cause === 'check' && err.messageKey === 'ORDER_CANCEL_NOT_ALLOWED') {
            return next(domainError('ORDER_CANCEL_NOT_ALLOWED', 409));
          }
          if (err.cause === 'check' && err.messageKey === 'ORDER_INVARIANT_VIOLATED') {
            return next(domainError('ORDER_INVARIANT_VIOLATED', 409));
          }
          if (err.cause === 'check' && err.messageKey === 'PAYMENT_INSUFFICIENT_FOR_CLOSE') {
            return next(domainError('PAYMENT_INSUFFICIENT_FOR_CLOSE', 400));
          }
        }
        return next(err);
      }
    },
  );

  /**
   * PATCH /orders/:id/customer — Session 53 (v3 paritesi).
   *
   * Persisted siparişe müşteri ata / kaldır. `order_type` DEĞİŞMEZ;
   * yalnız `customer_id` UPDATE edilir (Migration 028 CHECK takeaway →
   * customer_id NOT NULL invariantını korur).
   *
   * RBAC: admin / cashier / waiter (sipariş alma sırasında waiter da müşteri
   * atayabilir; ADR-016 §11 customers.read 4 rolde mevcut).
   *
   * Hatalar:
   *   - 404 ORDER_NOT_FOUND
   *   - 409 ORDER_INVARIANT_VIOLATED (terminal status)
   *   - 400 TAKEAWAY_CUSTOMER_REQUIRED (takeaway + customerId=null)
   *   - 404 CUSTOMER_NOT_FOUND
   *   - 409 CUSTOMER_BLACKLISTED
   */
  router.patch(
    '/:id/customer',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    validateParams(idParamSchema),
    validateBody(OrderAssignCustomerSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const orderId = req.params.id as string;
        const customerId = (req.body as { customerId: string | null }).customerId;
        const repo = createOrdersRepository(deps.db);

        // Erken takeaway null reddi (DB CHECK defansından önce).
        // Repo defansive olarak da fırlatır; UI'a hızlı 400 dönmek için handler.
        const before = await repo.findOrderById(deps.db, tenantId, orderId);
        if (before === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        if (before.order.order_type === 'takeaway' && customerId === null) {
          return next(domainError('TAKEAWAY_CUSTOMER_REQUIRED', 400));
        }

        let customerIdBefore: string | null = null;
        await deps.db.transaction().execute(async (trx) => {
          const r = await repo.assignCustomer(
            trx,
            tenantId,
            orderId,
            customerId,
          );
          customerIdBefore = r.customerIdBefore;
          // No-op: aynı müşteri zaten atanmış — audit yazma.
          if (customerIdBefore === customerId) return;
          await writeAudit(trx, {
            tenantId,
            eventType: 'order.customer_assigned',
            actorUserId,
            entityType: 'order',
            entityId: orderId,
            rawPayload: {
              order_id: orderId,
              customer_id_before: customerIdBefore,
              customer_id_after: customerId,
            },
          });
        });

        emitTenant(tenantId, 'order:customer_assigned', {
          orderId,
          customerId,
        });

        const after = await repo.findOrderById(deps.db, tenantId, orderId);
        if (after === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        res.status(200).json({ data: toOrderResponseDto(after) });
        return;
      } catch (err) {
        if (err instanceof RepositoryError) {
          if (err.cause === 'not_found') {
            if (err.messageKey === 'ORDER_NOT_FOUND') {
              return next(domainError('ORDER_NOT_FOUND', 404));
            }
            if (err.messageKey === 'CUSTOMER_NOT_FOUND') {
              return next(domainError('CUSTOMER_NOT_FOUND', 404));
            }
          }
          if (err.cause === 'check') {
            if (err.messageKey === 'ORDER_INVARIANT_VIOLATED') {
              return next(domainError('ORDER_INVARIANT_VIOLATED', 409));
            }
            if (err.messageKey === 'TAKEAWAY_CUSTOMER_REQUIRED') {
              return next(domainError('TAKEAWAY_CUSTOMER_REQUIRED', 400));
            }
            if (err.messageKey === 'CUSTOMER_BLACKLISTED') {
              return next(domainError('CUSTOMER_BLACKLISTED', 409));
            }
          }
        }
        return next(err);
      }
    },
  );

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

  /**
   * PATCH /orders/:orderId/items/:itemId/status — Sprint 12 PR-2c (ADR-020 K3 + K12).
   *
   * KDS state transition (item-level): `sent → preparing → ready`.
   * - Idempotent: aynı status → 200 no-op (audit yazılmaz, emit edilmez)
   * - Invalid transition (örn. new→preparing direkt; served|cancelled terminal):
   *   422 ORDER_ITEM_INVALID_STATUS_TRANSITION
   * - ABAC: `kitchen` + `admin` (ADR-020 K7 + permissions.ts kds.itemStatusUpdate)
   * - Audit: `event_type='order_item.status_changed'`, payload status_before/after
   * - Realtime: `kitchen.itemStatusChanged` → `tenant:N:role:kitchen` room
   *   (ADR-010 §4.2)
   */
  router.patch(
    '/:orderId/items/:itemId/status',
    authenticate(deps.accessSecret),
    authorize(['admin', 'kitchen']),
    validateBody(OrderItemStatusUpdateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { orderId, itemId } = req.params as {
          orderId: string;
          itemId: string;
        };
        const newStatus = (req.body as { status: 'preparing' | 'ready' }).status;
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;

        const result = await deps.db.transaction().execute(async (trx) => {
          const item = await trx
            .selectFrom('order_items')
            .select(['id', 'order_id', 'tenant_id', 'product_id', 'status'])
            .where('id', '=', itemId)
            .where('order_id', '=', orderId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();
          if (item === undefined) {
            throw domainError('ORDER_NOT_FOUND', 404);
          }

          // Idempotent: aynı status → no-op (200 başarılı, audit/emit yok)
          if (item.status === newStatus) {
            return {
              before: item.status,
              after: newStatus,
              changed: false,
            };
          }

          // ADR-020 K3 state machine
          const validTransitions: Record<string, readonly string[]> = {
            sent: ['preparing', 'ready'],
            preparing: ['ready'],
          };
          if (!validTransitions[item.status]?.includes(newStatus)) {
            throw domainError('ORDER_ITEM_INVALID_STATUS_TRANSITION', 422);
          }

          await trx
            .updateTable('order_items')
            .set({ status: newStatus })
            .where('id', '=', itemId)
            .execute();

          await writeAudit(trx, {
            tenantId,
            eventType: 'order_item.status_changed',
            actorUserId,
            entityType: 'order_item',
            entityId: itemId,
            rawPayload: {
              order_id: orderId,
              order_item_id: itemId,
              product_id: item.product_id,
              status_before: item.status,
              status_after: newStatus,
            },
          });

          return {
            before: item.status,
            after: newStatus,
            changed: true,
          };
        });

        // Realtime emit (transaction sonrası — atomicity korunur)
        if (result.changed && deps.io !== undefined) {
          deps.io
            .of('/realtime')
            .to(`tenant:${tenantId}:role:kitchen`)
            .emit('kitchen.itemStatusChanged', {
              orderId,
              itemId,
              status: result.after,
            });
        }

        res.status(200).json({
          data: { item: { id: itemId, status: result.after } },
        });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
