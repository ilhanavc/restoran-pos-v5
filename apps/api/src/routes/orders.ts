import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Server as IoServer } from 'socket.io';
import {
  createOrdersRepository,
  createProductAttributeGroupsRepository,
  createUsersRepository,
  RepositoryError,
  TERMINAL_ORDER_STATUSES,
  type DB,
  type OrderItemSnapshot,
} from '@restoran-pos/db';
import {
  CreateOrderRequestSchema,
  OrderAssignCustomerSchema,
  OrderMoveTableRequestSchema,
  OrderMergeRequestSchema,
  OrderCreateApiRequestSchema,
  OrderListQuerySchema,
  OrderAddItemsRequestSchema,
  OrderItemStatusUpdateSchema,
  OrderItemUpdateSchema,
  OrderUpdateSchema,
  TakeawayListQuerySchema,
  UpdateTakeawayStageInputSchema,
  OrderCreatedPayloadSchema,
  OrderStatusChangedPayloadSchema,
  OrderCancelledPayloadSchema,
  OrderCustomerAssignedPayloadSchema,
  TablesChangedPayloadSchema,
  KitchenOrderSentPayloadSchema,
  KitchenItemStatusChangedPayloadSchema,
  type OrderMoveTableRequest,
  type OrderMergeRequest,
  type TablesChangedPayload,
  type CreateTakeawayOrderInput,
  type OrderItemCreateInput,
  type TakeawayStage,
  type OrderCreatedPayload,
  type OrderStatusChangedPayload,
  type OrderCancelledPayload,
  type OrderCustomerAssignedPayload,
  type KitchenOrderSentPayload,
  type KitchenItemStatusChangedPayload,
  OrderCancelReasonSchema,
  type OrderCancelReason,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  validateBody,
  validateParams,
  validateQuery,
  idParamSchema,
  orderIdParamSchema,
  sourceOrderIdParamSchema,
} from '../middleware/validate.js';
import { domainError } from '../errors.js';
import { emitToTenant, emitToRole } from '../realtime/emit.js';
import { parseDateParam, todayStoreDateString } from '../utils/store-date.js';
import { writeAudit } from '../audit/writeAudit.js';
import {
  applyAttributeSnapshot,
  resolveItemAttributes,
} from '../domain/orders/resolveItemAttributes.js';
import { enqueueKitchenJob } from '../print/enqueue-kitchen-job.js';
import { enqueueCancelJob } from '../print/enqueue-cancel-job.js';
import { enqueueBillJob } from '../print/enqueue-bill-job.js';
import { enqueuePackingJob } from '../print/enqueue-packing-job.js';
import { logger } from '../logger.js';
import { tableLabel } from '@restoran-pos/shared-domain';

/**
 * ADR-027 Amendment 2 K7 — `POST /orders/:id/cancel` gövdesi.
 *
 * `reason` OPSİYONELdir. Her iki istemci (web + mobil) sebebi ZORUNLU tutar —
 * seçilmeden "İptal Et" pasiftir — ama API tarafında zorunlu kılmak eski
 * istemcileri ve otomatik iptal yolunu (sebepsiz, `auto:true`) kırardı.
 * Serbest metin kabul edilmez: enum dışı değer 400 döner (PII önlemi).
 */
const cancelOrderBodySchema = z.object({
  reason: OrderCancelReasonSchema.optional(),
});

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
   * `tenant:{tenantId}` room'una tipli `orders.*` event yayınlayan helper
   * (ADR-010 §11 Amendment 2026-06-28 / ADR-025 K5). Event isimleri
   * dot-notation 2-segment camelCase (`<domain>.<verbPast>`, §11.1); payload
   * `ServerToClientEvents`'e tip-bağlı + emit ÖNCESİ zod parse (§11.3).
   *
   * Direct `io.emit` apps/api'de ESLint `no-restricted-syntax` ile yasak;
   * burası ADR-010 §11.3 emit path'i (eslint config exception path).
   * deps.io undefined ise no-op (test stub uyumluluğu).
   *
   * tenant:{id} room'una role:waiter dahil tüm socket join olur (ADR-010
   * §4.2) → mobil "canlı ortak masa tahtası" ek room olmadan tüketir.
   */
  function emitTenant(
    tenantId: string,
    event: 'orders.created',
    payload: OrderCreatedPayload,
  ): void;
  function emitTenant(
    tenantId: string,
    event: 'orders.statusChanged',
    payload: OrderStatusChangedPayload,
  ): void;
  function emitTenant(
    tenantId: string,
    event: 'orders.cancelled',
    payload: OrderCancelledPayload,
  ): void;
  function emitTenant(
    tenantId: string,
    event: 'orders.customerAssigned',
    payload: OrderCustomerAssignedPayload,
  ): void;
  function emitTenant(
    tenantId: string,
    event:
      | 'orders.created'
      | 'orders.statusChanged'
      | 'orders.cancelled'
      | 'orders.customerAssigned',
    payload:
      | OrderCreatedPayload
      | OrderStatusChangedPayload
      | OrderCancelledPayload
      | OrderCustomerAssignedPayload,
  ): void {
    if (deps.io === undefined) return;
    // ADR-010 §11.3 + Amendment K5 — tek emit path. Raw `.of().to().emit()`
    // yerine `emitToTenant` helper'ına delege (parse + fire-and-forget K4);
    // eslint `no-restricted-syntax` broad selector'ı raw emit'i yasaklar.
    const io = deps.io;
    switch (event) {
      case 'orders.created':
        emitToTenant(
          { io, eventName: event, payloadSchema: OrderCreatedPayloadSchema },
          tenantId,
          payload as OrderCreatedPayload,
        );
        return;
      case 'orders.statusChanged':
        emitToTenant(
          {
            io,
            eventName: event,
            payloadSchema: OrderStatusChangedPayloadSchema,
          },
          tenantId,
          payload as OrderStatusChangedPayload,
        );
        return;
      case 'orders.cancelled':
        emitToTenant(
          { io, eventName: event, payloadSchema: OrderCancelledPayloadSchema },
          tenantId,
          payload as OrderCancelledPayload,
        );
        return;
      case 'orders.customerAssigned':
        emitToTenant(
          {
            io,
            eventName: event,
            payloadSchema: OrderCustomerAssignedPayloadSchema,
          },
          tenantId,
          payload as OrderCustomerAssignedPayload,
        );
        return;
    }
  }

  /**
   * ADR-028 (ADR-010 §11.6) — invalidate-only `tables.changed` emit. Masayı
   * Değiştir sonrası kaynak + hedef masa için tenant room'una gönderilir; web +
   * mobil tahta `['tables']` invalidate eder. `deps.io === undefined` → no-op
   * (test/io'suz akış kırılmaz). `tables.ts` içindeki eşdeğer helper'ın ikizi.
   */
  function emitTablesChanged(
    tenantId: string,
    payload: TablesChangedPayload,
  ): void {
    if (deps.io === undefined) return;
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
   * ADR-020 K6 / ADR-010 §11.3 Amendment K3 — `tenant:{id}:role:kitchen`
   * room'una tipli KDS event yayınlayan role-scoped helper. `emitToRole`
   * (`emit.ts`) delegasyonu → emit-öncesi zod safeParse + fire-and-forget K4
   * (parse/emit hatası mutfağa gitmez, sipariş-create'i 500 yapmaz). Böylece
   * 4 KDS emit-site'ı raw `.of().to().emit()` bypass yerine tek emit path'e
   * girer (eslint broad selector uyumu, K5). `deps.io === undefined` → no-op.
   */
  function emitKitchen(
    tenantId: string,
    event: 'kitchen.orderSent',
    payload: KitchenOrderSentPayload,
  ): void;
  function emitKitchen(
    tenantId: string,
    event: 'kitchen.itemStatusChanged',
    payload: KitchenItemStatusChangedPayload,
  ): void;
  function emitKitchen(
    tenantId: string,
    event: 'kitchen.orderSent' | 'kitchen.itemStatusChanged',
    payload: KitchenOrderSentPayload | KitchenItemStatusChangedPayload,
  ): void {
    if (deps.io === undefined) return;
    const io = deps.io;
    if (event === 'kitchen.orderSent') {
      emitToRole(
        { io, eventName: event, payloadSchema: KitchenOrderSentPayloadSchema },
        tenantId,
        'kitchen',
        payload as KitchenOrderSentPayload,
      );
      return;
    }
    emitToRole(
      {
        io,
        eventName: event,
        payloadSchema: KitchenItemStatusChangedPayloadSchema,
      },
      tenantId,
      'kitchen',
      payload as KitchenItemStatusChangedPayload,
    );
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

        // 3. Kalem snapshot resolve — dine_in ile ORTAK `resolveItemSnapshots`
        //    (ADR-013 §2 sunucu fiyat otoritesi; UI fiyatları YOK SAYILIR).
        //    Bu akışın kendi daraltılmış döngüsü vardı ve `variantId` +
        //    `selectedAttributes`'i sessizce düşürüyordu → paket siparişte
        //    yanlış porsiyon + tahsil edilmeyen fiyat farkı (S104 canlı
        //    tespit). Tek resolver → iki akış ayrışamaz.
        const itemsResolved = await resolveItemSnapshots(
          deps.db,
          tenantId,
          input.items,
          actorUserId,
          actorName,
        );

        // 4. Toplam (KDV v5.1; subtotal=total).
        const totalCents = itemsResolved.reduce(
          (sum, it) => sum + it.totalCents,
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
        emitTenant(tenantId, 'orders.created', {
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

          // ADR-004 Phase 3 PR-4b — print_jobs INSERT (kitchen receipt).
          // Sent UPDATE sonrası queue'ya bırakırız; emit ile aynı eventual
          // consistency penceresi. createTakeawayOrder void döner → order_no
          // için kısa SELECT.
          const orderRow = await deps.db
            .selectFrom('orders')
            .select(['order_no'])
            .where('id', '=', orderId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirstOrThrow();
          await enqueueKitchenJob(deps.db, {
            orderId,
            tenantId,
            orderNo: orderRow.order_no,
            tableCodeSnapshot: null, // takeaway → "PAKET" render
            areaNameSnapshot: null, // takeaway → bölge yok
            waiterUserId: actorUserId,
            itemIds: kitchenItems.map((k) => k.id),
          });

          emitKitchen(tenantId, 'kitchen.orderSent', {
            orderId,
            orderType: 'takeaway',
            items: kitchenItems.map((k) => ({
              id: k.id,
              productName: k.product_name,
              quantity: k.quantity,
            })),
          });
        }

        // ADR-032 Amd3 K5 — kasa paket fişi. `kitchenItems` guard'ının DIŞINDA
        // ve KOŞULSUZ: yalnız içecek içeren bir paket siparişi de paketlenir
        // ve teslim edilir; mutfak fişi olmasa da kasa fişi çıkmalıdır.
        // Mutfak enqueue'sundan SONRA çağrılır (mutfak zaman-kritiktir).
        // Best-effort: fiş üretilemezse sipariş oluşturma BAŞARISIZ OLMAZ.
        try {
          await enqueuePackingJob(deps.db, {
            orderId,
            tenantId,
            actorUserId,
          });
        } catch (err) {
          logger.error({ err, orderId }, '[packing-receipt] enqueue failed');
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
   * POST /orders/:id/print-bill — on-demand müşteri adisyonu baskısı (ADR-027 Faz A).
   *
   * Garson dahil herkes (admin/cashier/waiter, ADR-008 §7e) adisyon bastırır.
   * Order resolve (404 ORDER_NOT_FOUND), bill ESC/POS render → `print_jobs` queued
   * insert (`kind='bill'`); Print Agent generic puller basar. comp/iptal/ödeme
   * DEĞİL — yalnız baskı; `print.bill` yetkisi. Tenant-scoped.
   */
  router.post(
    '/:id/print-bill',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const orderId = req.params.id as string;
        // enqueueBillJob tek-fetch otoritesi (ADR-027 Amd1) — order + items +
        // modifiers + payments + garson'u orderId'den kendi çeker. false =
        // order bulunamadı → 404 ORDER_NOT_FOUND.
        const enqueued = await enqueueBillJob(deps.db, {
          orderId,
          tenantId,
          actorUserId,
        });
        if (!enqueued) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        res.status(202).json({ data: { enqueued: true } });
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

        emitTenant(tenantId, 'orders.statusChanged', {
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
   * POST /orders/:id/cancel — KANONİK adisyon iptali (ADR-027 Amendment 2 K9).
   *
   * Sipariş türüne göre dallanır: `dine_in` → `cancelOrderTx`,
   * `takeaway|delivery` → `cancelTakeawayOrder` (yalnız
   * `status='open' AND stage='preparing'`; diğer durumlar 409 INVALID_STATE).
   *
   * RBAC: admin + cashier + waiter (ADR-027 Amd2 K2). Eskiden admin-only idi
   * (ADR-034 B2, "parasal/operasyonel etki"); o gerekçe çürütülmedi, KAPI
   * DEĞİŞTİ — parasal koruma artık rolde değil PARA DURUMUNDA: aktif ödemesi
   * olan adisyonu `cancelOrderTx` tüm roller için reddeder
   * (`ORDER_HAS_PAYMENTS`). Sipariş TÜRÜ kısıtı yoktur (paket dahil).
   *
   * `PATCH /orders/:id`'in iptal dalı DEPRECATED. 2026-07-20 itibarıyla HİÇBİR
   * istemci onu kullanmıyor (web de bu uca geçti); yalnız API testlerinde
   * canlı, bu yüzden silinmedi. İkisi de aynı `cancelOrderTx` + aynı audit'i
   * çağırdığı için davranış ayrışmaz. PATCH garsona AÇILMAZ — o route
   * `status:'paid'` ile "Masayı Kapat"ı (para toplamadan kapatma) da yapıyor,
   * yani iptalden bağımsız bir sebeple admin/cashier'da kalmalı.
   */
  router.post(
    '/:id/cancel',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    validateParams(idParamSchema),
    validateBody(cancelOrderBodySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const orderId = req.params.id as string;
        const repo = createOrdersRepository(deps.db);
        // K7 — sebep enum'u; API'de opsiyonel (web PATCH yolu kırılmasın),
        // mobil UI'da zorunlu. Audit'e enum KODU yazılır (serbest metin yok).
        const reason =
          (req.body as { reason?: OrderCancelReason }).reason ?? null;

        const before = await repo.findOrderById(deps.db, tenantId, orderId);
        if (before === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }

        // ADR-004 Amd6 A5 — canlı kalemler cancel'dan ÖNCE toplanır (dine-in
        // PATCH yolundaki desenin aynısı; gerekçe orada).
        const liveItemIds = (
          await deps.db
            .selectFrom('order_items')
            .select(['id'])
            .where('order_id', '=', orderId)
            .where('tenant_id', '=', tenantId)
            .where('status', '!=', 'cancelled')
            .execute()
        ).map((r) => r.id);

        await deps.db.transaction().execute(async (trx) => {
          // K9 — tür dallanması. Bu YÖNLENDİRMEdir, yetkilendirme değil:
          // her iki dal da aynı rol kümesine açıktır, koruma para kapısındadır.
          if (before.order.order_type === 'dine_in') {
            await repo.cancelOrderTx(trx, tenantId, orderId);
          } else {
            const r = await repo.cancelTakeawayOrder(trx, tenantId, orderId);
            if (r.rowCount === 0) {
              throw domainError('INVALID_STATE', 409);
            }
          }
          await writeAudit(trx, {
            tenantId,
            eventType: 'order.cancelled',
            actorUserId,
            entityType: 'order',
            entityId: orderId,
            // ADR-024 Amendment 1 K2 — kanonik payload {order_id, auto}:
            // explicit (kullanıcı-tetikli) iptal → auto:false (3-yol parite;
            // auto-iptal A yolu auto:true). ADR-027 Amd2 K12: `reason` enum
            // kodu eklenir — "bu adisyon neden iptal edilmiş" sorusunun cevabı
            // (serbest metin YOK → PII riski yok; auto yolunda null).
            rawPayload: { order_id: orderId, auto: false, reason },
          });
        });

        // ADR-004 Amd6 A5/A7 — ADİSYON İPTAL fişi (PAKET etiketiyle);
        // 0-canlı-kalem → fiş yok; best-effort.
        if (liveItemIds.length > 0) {
          try {
            await enqueueCancelJob(deps.db, {
              tenantId,
              orderId,
              variant: 'order-cancel',
              itemIds: liveItemIds,
            });
          } catch {
            // best-effort — Amd6 A7; iptal başarısı fişe bağlanmaz.
          }
        }

        emitTenant(tenantId, 'orders.cancelled', { orderId });

        const after = await repo.findOrderById(deps.db, tenantId, orderId);
        if (after === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        res.status(200).json({ data: toOrderResponseDto(after) });
        return;
      } catch (err) {
        // ADR-027 Amd2 — reddin SEBEBİ istemciye taşınır. Varsayılan eşleme
        // `check` ihlallerini tek bir genel `ORDER_INVARIANT_VIOLATED`'a
        // düşürüyordu; mobilde garsona "işlem yapılamadı" demek yerine
        // "bu adisyonun ödemesi alınmış" diyebilmek için ayırt edilir.
        if (err instanceof RepositoryError && err.cause === 'check') {
          if (err.messageKey === 'ORDER_HAS_PAYMENTS') {
            return next(domainError('ORDER_HAS_PAYMENTS', 409));
          }
          if (err.messageKey === 'ORDER_CANCEL_NOT_ALLOWED') {
            return next(domainError('ORDER_CANCEL_NOT_ALLOWED', 409));
          }
        }
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
   *   - Idempotency: ADR-013 Amendment 1 (FAZ 1 / PR-3) — opsiyonel
   *     `idempotencyKey` (body veya `Idempotency-Key` header). Dolu ise retry/yarış
   *     tek sipariş döner (200 replay); yoksa legacy davranış. BLOCKER M10-A-01.
   */
  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    // ADR-013 Amd1 K8 — `Idempotency-Key` header desteği (payments.ts paritesi):
    // body'de yoksa header'dan al (iki yol da kabul; HTTP standart paritesi).
    (req: Request, _res: Response, next: NextFunction) => {
      if (req.body && req.body.idempotencyKey === undefined) {
        const headerKey = req.get('Idempotency-Key');
        if (headerKey !== undefined && headerKey.trim() !== '') {
          req.body.idempotencyKey = headerKey.trim();
        }
      }
      next();
    },
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
        //
        // ADR-009 Amendment 2026-06-30 Karar A: table_code_snapshot artık ham
        // `code` değil KANONİK etiket (`tableLabel` → "Masa {display_no}" veya
        // bölgesiz orphan'da ham code). Böylece fiş/KDS, masa board'u ile birebir
        // aynı masa numarasını gösterir (eski drift giderildi). Bunun için
        // area_id + display_no de çekilir.
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
            .select([
              'tables.code as t_code',
              'tables.area_id as area_id',
              'tables.display_no as display_no',
              'areas.name as a_name',
            ])
            .where('tables.tenant_id', '=', tenantId)
            .where('tables.id', '=', req.body.tableId)
            .executeTakeFirst();
          if (tableRow !== undefined) {
            tableCodeSnapshot = tableLabel({
              code: tableRow.t_code,
              area_id: tableRow.area_id,
              display_no: tableRow.display_no,
            });
            areaNameSnapshot = tableRow.a_name;
          }
        }

        const repo = createOrdersRepository(deps.db);
        // ADR-015 Amd5 K3 — store_date/business_date artık repo'da tx-içi
        // SQL'de hesaplanır (R7-TZ-13); route tarih GEÇİRMEZ.
        // ADR-013 Amd1 K7/K8 — createTx (idempotency guard) tek transaction'da.
        const result = await deps.db.transaction().execute((trx) =>
          repo.createTx(
            trx,
            tenantId,
            {
              id: randomUUID(),
              tableId: req.body.tableId,
              orderType: req.body.orderType,
              note: req.body.note ?? null,
              customerId: req.body.customerId ?? null,
              waiterUserId: actorUserId,
              tableCodeSnapshot,
              areaNameSnapshot,
              idempotencyKey: req.body.idempotencyKey ?? null,
            },
            snapshots,
          ),
        );

        // ADR-013 Amd1 K6 — replay ise yan-etki (KDS enqueue + emit) BASTIRILIR
        // (yoksa idempotency yarım kalır: 2. mutfak fişi yine basılır). Mevcut
        // siparişi 200 ile döndür (retry şeffaf; masa-doluluk 409 belirsizliği yok).
        if (result.replayed) {
          res.status(200).json({
            data: { order: result.order, items: result.items, replayed: true },
          });
          return;
        }

        const order = result.order;

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

          // ADR-004 Phase 3 PR-4b — print_jobs INSERT (kitchen receipt).
          // Sent UPDATE sonrası queue'ya bırakırız; emit ile aynı eventual
          // consistency penceresi. `order` (OrderRow) `repo.create()` dönüşünden
          // gelir; order_no + table_code_snapshot + waiter_user_id mevcut.
          await enqueueKitchenJob(deps.db, {
            orderId: order.id,
            tenantId,
            orderNo: order.order_no,
            tableCodeSnapshot: order.table_code_snapshot,
            areaNameSnapshot: order.area_name_snapshot,
            waiterUserId: order.waiter_user_id,
            itemIds: kitchenItemsDineIn.map((k) => k.id),
          });

          emitKitchen(tenantId, 'kitchen.orderSent', {
            orderId: order.id,
            orderType: req.body.orderType,
            items: kitchenItemsDineIn.map((k) => ({
              id: k.id,
              productName: k.product_name,
              quantity: k.quantity,
            })),
          });
        }

        // Yeni dine-in sipariş broadcast (ADR-010 §11.6) — tenant odasına;
        // masa tahtası (web + mobil) canlı invalidate eder. takeaway path'i
        // (line ~499) zaten emit ediyordu; dine-in eksikti. dine_in'in takeaway
        // stage'i yok → null. KDS koşullu, bu emit koşulsuz (her dine-in sipariş).
        emitTenant(tenantId, 'orders.created', {
          orderId: order.id,
          type: 'dine_in',
          takeawayStage: null,
          total_cents: Number(order.total_cents),
        });

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
    // ADR-013 Amd1 K8 — `Idempotency-Key` header desteği (payments.ts paritesi):
    // body'de `batchKey` yoksa header'dan al (iki yol da kabul).
    (req: Request, _res: Response, next: NextFunction) => {
      if (req.body && req.body.batchKey === undefined) {
        const headerKey = req.get('Idempotency-Key');
        if (headerKey !== undefined && headerKey.trim() !== '') {
          req.body.batchKey = headerKey.trim();
        }
      }
      next();
    },
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
        // ADR-013 Amd1 K7/K8 — addItemsTx (batch-marker idempotency guard).
        const result = await deps.db.transaction().execute((trx) =>
          repo.addItemsTx(
            trx,
            tenantId,
            orderId,
            snapshots,
            req.body.batchKey ?? null,
            actorUserId,
          ),
        );

        // ADR-013 Amd1 K6 — replay ise KDS enqueue + emit BASTIRILIR (kalem duplike
        // olmasa da 2. mutfak fişi + emit tekrarlanmasın → idempotency yarım
        // kalmasın). Güncel siparişi 200 ile döndür.
        if (result.replayed) {
          res.status(200).json({
            data: { order: result.order, items: result.items, replayed: true },
          });
          return;
        }

        // KDS hook (ADR-020 K2 + K7 "Kaydet = mutfağa otomatik"): mevcut açık
        // siparişe eklenen kitchen_print item'ları da mutfağa düşmeli. POST
        // /orders dine_in hook'unun (l.~922) add-items eşleniği — FARKI: yalnız
        // YENİ kalemler (status='new'); önceki Kaydet'te eklenenler zaten 'sent'.
        const newKitchenItems = await deps.db
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
          .where('order_items.status', '=', 'new')
          .where('categories.kitchen_print', '=', true)
          .execute();

        if (newKitchenItems.length > 0) {
          await deps.db
            .updateTable('order_items')
            .set({ status: 'sent' })
            .where(
              'id',
              'in',
              newKitchenItems.map((k) => k.id),
            )
            .where('tenant_id', '=', tenantId)
            .execute();

          await enqueueKitchenJob(deps.db, {
            orderId: result.order.id,
            tenantId,
            orderNo: result.order.order_no,
            tableCodeSnapshot: result.order.table_code_snapshot,
            areaNameSnapshot: result.order.area_name_snapshot,
            waiterUserId: result.order.waiter_user_id,
            // S103 bug: bu liste geçilmezse önceki kalemler de yeniden basılır.
            itemIds: newKitchenItems.map((k) => k.id),
          });

          emitKitchen(tenantId, 'kitchen.orderSent', {
            orderId: result.order.id,
            orderType: result.order.order_type,
            items: newKitchenItems.map((k) => ({
              id: k.id,
              productName: k.product_name,
              quantity: k.quantity,
            })),
          });
        }

        // ADR-032 Amd3 K5 (ürün sahibi revizyonu 2026-07-21) — PAKET siparişe
        // kalem eklendiğinde kasa fişi GÜNCEL HALİYLE yeniden basılır.
        //
        // ADR taslağı bunu reddediyordu ("iki farklı kâğıt dolaşır, hangisi
        // geçerli belirsizleşir"); ürün sahibi tersini seçti: kasadaki kâğıdın
        // siparişin son hâlini göstermesi, eski kopyanın çöpe atılmasından
        // daha önemli. Eski kâğıdın atılması operasyonel disipline bırakıldı.
        //
        // Yalnız paket/gel-al; masa siparişinde kasa fişi sipariş anında da
        // basılmıyor (adisyon fişi "Yazdır"/ödeme ile çıkar).
        if (result.order.order_type !== 'dine_in') {
          try {
            await enqueuePackingJob(deps.db, {
              orderId,
              tenantId,
              actorUserId,
            });
          } catch (err) {
            logger.error({ err, orderId }, '[packing-receipt] re-enqueue failed');
          }
        }

        // Kalem eklendi → sipariş total'i değişti; tenant'a yayınla ki masa
        // tahtası (₺ tutar) + açık adisyon diğer terminallerde canlı güncellensin
        // (ADR-010 §11.6). dine-in → takeaway_stage null; henüz ödenmedi → false.
        emitTenant(tenantId, 'orders.statusChanged', {
          orderId,
          takeawayStage: result.order.takeaway_stage,
          paid: false,
        });

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
        const actorUserId = req.user!.userId;
        const orderId = req.params.id as string;
        const repo = createOrdersRepository(deps.db);
        const targetStatus = req.body.status as 'cancelled' | 'paid';
        let result: Awaited<ReturnType<typeof repo.payOrder>>;
        if (targetStatus === 'paid') {
          // ADR-024 K3 — Mod B "Masayı Kapat": payOrderTx + order.paid audit
          // aynı transaction'da (ADR-002 §10.4). #193 close-validation davranışı
          // payOrderTx'te bit-identical. Mod B çoklu-ödeme olabilir → tek
          // payment_type yok; 'mixed' literal yazılır (K3 tablo notu). amount_cents
          // = kapatılan order.total_cents (parasal kanıt).
          result = await deps.db.transaction().execute(async (trx) => {
            const r = await repo.payOrderTx(trx, tenantId, orderId);
            await writeAudit(trx, {
              tenantId,
              eventType: 'order.paid',
              actorUserId,
              entityType: 'order',
              entityId: orderId,
              rawPayload: {
                order_id: orderId,
                payment_type: 'mixed',
                amount_cents: r.order.total_cents,
              },
            });
            return r;
          });
        } else {
          // ADR-004 Amd6 A5 — ADİSYON İPTAL fişi, iptal ANINDA canlı olan
          // kalemleri listeler; önceden tek tek iptal edilenler kendi İPTAL
          // fişini gördü (tekrar listelenmez). Liste cancel'dan ÖNCE toplanır
          // (cancelOrder tüm kalemleri soft-cancel eder — sonrası ayırt edemez).
          const liveItemIds = (
            await deps.db
              .selectFrom('order_items')
              .select(['id'])
              .where('order_id', '=', orderId)
              .where('tenant_id', '=', tenantId)
              .where('status', '!=', 'cancelled')
              .execute()
          ).map((r) => r.id);

          // ADR-024 Amendment 1 K1 — explicit dine-in iptali de order.cancelled
          // audit'ini YAZAR (auto-iptal A yolu ADR-014 Amd1'den beri yazıyordu;
          // bu yol yazmıyordu → "canlı siparişi kim/ne zaman iptal etti"
          // denetim boşluğu). paid-dalının payOrderTx+order.paid deseninin
          // ikizi: cancelOrderTx + writeAudit AYNI transaction'da (atomik).
          // K2 kanonik payload {order_id, auto}: explicit cancel auto:false
          // (auto-iptalin auto:true'sundan ayırt edilir).
          result = await deps.db.transaction().execute(async (trx) => {
            const r = await repo.cancelOrderTx(trx, tenantId, orderId);
            await writeAudit(trx, {
              tenantId,
              eventType: 'order.cancelled',
              actorUserId,
              entityType: 'order',
              entityId: orderId,
              rawPayload: {
                order_id: orderId,
                auto: false,
              },
            });
            return r;
          });

          // A5 guard: 0 canlı kalem → fiş YOK (boş adisyon / hepsi zaten
          // kalem-kalem iptal edilmiş). Best-effort (A7). Print/emit tx DIŞINDA
          // (ADR-024 Amd1 K3 — baskı iptali audit+cancel'ı rollback'lemez).
          if (liveItemIds.length > 0) {
            try {
              await enqueueCancelJob(deps.db, {
                tenantId,
                orderId,
                variant: 'order-cancel',
                itemIds: liveItemIds,
              });
            } catch {
              // best-effort — Amd6 A7; iptal başarısı fişe bağlanmaz.
            }
          }
        }

        // Sipariş düzeyi durum değişimi → tenant'a yayınla (ADR-010 §11.6) ki
        // masa tahtası canlı güncellensin: paid (Mod B "Masayı Kapat" — /payments
        // yolundan GEÇMEZ) → masa kapanır; cancelled → masa boşalır.
        if (targetStatus === 'paid') {
          emitTenant(tenantId, 'orders.statusChanged', {
            orderId,
            takeawayStage: result.order.takeaway_stage,
            paid: true,
          });
        } else {
          emitTenant(tenantId, 'orders.cancelled', { orderId });
        }

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
          // ADR-027 Amd2 — para kapısı bu (deprecated) iptal dalından da
          // geçebilir. Eşlenmezse generic hataya düşüyordu ve `details`
          // içinde iç sayaç ("activePayments=3") istemciye SIZIYORDU
          // (güvenlik incelemesi bulgusu). Kanonik uçla aynı kod döner.
          if (err.cause === 'check' && err.messageKey === 'ORDER_HAS_PAYMENTS') {
            return next(domainError('ORDER_HAS_PAYMENTS', 409));
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

        emitTenant(tenantId, 'orders.customerAssigned', {
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

  /**
   * PATCH /orders/:orderId/table — ADR-028 "Masayı Değiştir".
   *
   * Aktif dine_in siparişi aynı tenant içinde BAŞKA bir BOŞ masaya taşır.
   * `PATCH /orders/:orderId/customer` presedentinin ikizi (attribute-patch).
   * Tek transaction: repo `moveToTable` mutasyonu + audit `order.table_changed`
   * (ADR-002 §10.4). Commit sonrası İKİ `tables.changed {action:'updated'}` emit
   * (kaynak + hedef masa). 200 + güncellenmiş sipariş projeksiyonu.
   *
   * RBAC: admin / cashier / waiter (`orders.move`; kitchen HARİÇ — ADR-008 §7e).
   * Cross-tenant ASLA (her sorgu tenant-scoped → cross-tenant 404).
   *
   * Hatalar:
   *   - 404 ORDER_NOT_FOUND (sipariş yok / cross-tenant)
   *   - 409 ORDER_NOT_DINE_IN (takeaway/delivery)
   *   - 409 ORDER_ALREADY_CLOSED (terminal status)
   *   - 404 TABLE_NOT_FOUND (hedef yok / cross-tenant / silinmiş)
   *   - 409 TABLE_MOVE_SAME_TABLE (hedef = mevcut masa)
   *   - 409 TABLE_ALREADY_OCCUPIED (hedef dolu; app-level + unique index)
   */
  router.patch(
    '/:orderId/table',
    authenticate(deps.accessSecret),
    // ADR-028 Karar E: bu aksiyon YALNIZ rol-gate'lidir (admin/cashier/waiter);
    // garson için orders.update/orders.read'teki own-order (ABAC) sahiplik
    // kontrolü BİLİNÇLİ olarak YOKTUR — bu rollerden herhangi biri aktif bir
    // siparişi taşıyabilir (operasyonel: müşteriyi kim taşıyorsa o yapar).
    authorize(['admin', 'cashier', 'waiter']),
    validateParams(orderIdParamSchema),
    validateBody(OrderMoveTableRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const orderId = req.params.orderId as string;
        const targetTableId = (req.body as OrderMoveTableRequest).tableId;
        const repo = createOrdersRepository(deps.db);

        let fromTableId: string | null = null;
        await deps.db.transaction().execute(async (trx) => {
          const r = await repo.moveToTable(trx, tenantId, orderId, targetTableId);
          fromTableId = r.fromTableId;
          await writeAudit(trx, {
            tenantId,
            eventType: 'order.table_changed',
            actorUserId,
            entityType: 'order',
            entityId: orderId,
            rawPayload: {
              from_table_id: r.fromTableId,
              to_table_id: r.toTableId,
              from_table_code: r.fromTableCode,
              to_table_code: r.toTableCode,
            },
          });
        });

        // İki emit: kaynak + hedef masa artık farklı doluluk gösterir. Mevcut
        // `tables.changed {action:'updated'}` reuse — realtime schema değişmez
        // (ADR-028 Karar D). deps.io undefined ise no-op (emitTablesChanged).
        if (fromTableId !== null) {
          emitTablesChanged(tenantId, {
            action: 'updated',
            tableId: fromTableId,
          });
        }
        emitTablesChanged(tenantId, {
          action: 'updated',
          tableId: targetTableId,
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
            if (err.messageKey === 'TABLE_NOT_FOUND') {
              return next(domainError('TABLE_NOT_FOUND', 404));
            }
          }
          // Hedef masa SELECT↔UPDATE arasında hard-delete → FK ihlali; create
          // path'iyle (orders.ts:1053) aynı 404 mapping (moveToTable FIX-2).
          if (err.cause === 'foreign_key' && err.messageKey === 'TABLE_NOT_FOUND') {
            return next(domainError('TABLE_NOT_FOUND', 404));
          }
          if (err.cause === 'check') {
            if (err.messageKey === 'ORDER_NOT_DINE_IN') {
              return next(domainError('ORDER_NOT_DINE_IN', 409));
            }
            if (err.messageKey === 'ORDER_ALREADY_CLOSED') {
              return next(domainError('ORDER_ALREADY_CLOSED', 409));
            }
            if (err.messageKey === 'TABLE_MOVE_SAME_TABLE') {
              return next(domainError('TABLE_MOVE_SAME_TABLE', 409));
            }
          }
          if (err.cause === 'unique') {
            if (err.messageKey === 'TABLE_ALREADY_OCCUPIED') {
              return next(domainError('TABLE_ALREADY_OCCUPIED', 409));
            }
          }
        }
        return next(err);
      }
    },
  );

  /**
   * POST /orders/:sourceOrderId/merge — ADR-029 "Adisyon Birleştir".
   *
   * Kaynak dolu masanın aktif adisyonunu, body'deki `targetTableId` ile seçilen
   * BAŞKA bir DOLU masanın aktif adisyonuna aktarır: kaynak `order_items` hedef
   * siparişe re-parent edilir, hedef `total_cents` yeniden hesaplanır, kaynak
   * sipariş terminal (`merged` + `merged_into_order_id`) olur → kaynak masa
   * boşalır. `PATCH /orders/:orderId/table` (ADR-028) presedentinin ikizi.
   * Tek transaction: repo `mergeInto` mutasyonu + audit `order.merged`
   * (ADR-002 §10.4). Commit sonrası İKİ `tables.changed {action:'updated'}` emit
   * (kaynak + hedef masa). 200 + güncellenmiş HEDEF sipariş projeksiyonu.
   *
   * RBAC: admin / cashier / waiter (`orders.merge`; kitchen HARİÇ — ADR-008 §7e).
   * Cross-tenant ASLA (her sorgu tenant-scoped → cross-tenant 404).
   *
   * Hatalar:
   *   - 404 ORDER_NOT_FOUND (kaynak yok / cross-tenant)
   *   - 409 MERGE_TARGET_NOT_OCCUPIED (hedef masa boş → Masayı Değiştir kullan)
   *   - 409 MERGE_SAME_ORDER (hedef masa = kaynağın kendi masası)
   *   - 409 ORDER_NOT_DINE_IN (kaynak veya hedef takeaway/delivery)
   *   - 409 ORDER_ALREADY_CLOSED (kaynak veya hedef terminal)
   *   - 409 ORDER_HAS_PAYMENTS (kaynak veya hedefte ödeme kaydı var — K3)
   */
  router.post(
    '/:sourceOrderId/merge',
    authenticate(deps.accessSecret),
    // ADR-029 Karar F: bu aksiyon YALNIZ rol-gate'lidir (admin/cashier/waiter);
    // garson için own-order (ABAC) sahiplik kontrolü BİLİNÇLİ olarak YOKTUR
    // (orders.move aynası, ADR-008 §7e). kitchen HARİÇ.
    authorize(['admin', 'cashier', 'waiter']),
    validateParams(sourceOrderIdParamSchema),
    validateBody(OrderMergeRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const sourceOrderId = req.params.sourceOrderId as string;
        const targetTableId = (req.body as OrderMergeRequest).targetTableId;
        const repo = createOrdersRepository(deps.db);

        let sourceTableId: string | null = null;
        let mergedTargetTableId: string | null = null;
        let targetOrderId = '';
        await deps.db.transaction().execute(async (trx) => {
          const r = await repo.mergeInto(
            trx,
            tenantId,
            sourceOrderId,
            targetTableId,
          );
          sourceTableId = r.sourceTableId;
          mergedTargetTableId = r.targetTableId;
          targetOrderId = r.targetOrderId;
          await writeAudit(trx, {
            tenantId,
            eventType: 'order.merged',
            actorUserId,
            entityType: 'order',
            entityId: r.targetOrderId,
            rawPayload: {
              source_order_id: r.sourceOrderId,
              target_order_id: r.targetOrderId,
              source_table_id: r.sourceTableId,
              target_table_id: r.targetTableId,
              source_table_code: r.sourceTableCode,
              moved_item_count: r.movedItemCount,
              old_total_cents: r.oldTargetTotalCents,
              new_total_cents: r.newTargetTotalCents,
            },
          });
        });

        // İki emit: kaynak masa (boşaldı) + hedef masa (doluluk/tutar değişti).
        // Mevcut `tables.changed {action:'updated'}` reuse — realtime schema
        // değişmez (ADR-029 Karar E adım 7). deps.io undefined ise no-op.
        if (sourceTableId !== null) {
          emitTablesChanged(tenantId, {
            action: 'updated',
            tableId: sourceTableId,
          });
        }
        if (mergedTargetTableId !== null) {
          emitTablesChanged(tenantId, {
            action: 'updated',
            tableId: mergedTargetTableId,
          });
        }

        // 200 + güncellenmiş HEDEF sipariş projeksiyonu (hayatta kalan sipariş).
        const after = await repo.findOrderById(deps.db, tenantId, targetOrderId);
        if (after === null) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }
        res.status(200).json({ data: toOrderResponseDto(after) });
        return;
      } catch (err) {
        // Hata çeviri bloğu — moveToTable route'unun ikizi: repo
        // RepositoryError'ını explicit domainError(CODE, status)'a çevir; aksi
        // halde generic `check` yolu tüm kodları ORDER_INVARIANT_VIOLATED'a
        // çökertir (Risk R2, ADR-029 Karar G).
        if (err instanceof RepositoryError) {
          if (err.cause === 'not_found') {
            if (err.messageKey === 'ORDER_NOT_FOUND') {
              return next(domainError('ORDER_NOT_FOUND', 404));
            }
          }
          if (err.cause === 'check') {
            if (err.messageKey === 'MERGE_SAME_ORDER') {
              return next(domainError('MERGE_SAME_ORDER', 409));
            }
            if (err.messageKey === 'MERGE_TARGET_NOT_OCCUPIED') {
              return next(domainError('MERGE_TARGET_NOT_OCCUPIED', 409));
            }
            if (err.messageKey === 'ORDER_NOT_DINE_IN') {
              return next(domainError('ORDER_NOT_DINE_IN', 409));
            }
            if (err.messageKey === 'ORDER_ALREADY_CLOSED') {
              return next(domainError('ORDER_ALREADY_CLOSED', 409));
            }
            if (err.messageKey === 'ORDER_HAS_PAYMENTS') {
              return next(domainError('ORDER_HAS_PAYMENTS', 409));
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

        // ⚠️ S104 — KALEM-DÜZEYİ İKİ 403 KAPISI KALDIRILDI; yerine PARA KAPISI
        // kondu. ADR-027 Amendment 2'nin kalem düzeyine taşınmamış devamı:
        //
        //   (a) ABAC item-owner guard (ADR-008 Amd 2026-06-28 / ADR-025 K4) —
        //       "garson yalnız KENDİ kalemini void eder". ADR-027 Amd2 **K1**
        //       sahiplik-ABAC'ını AÇIKÇA REDDETTİ (masa devri + garson zaten
        //       başkasının masasında ödeme alıyor). Sipariş düzeyinde kaldırıldı,
        //       kalem düzeyinde UNUTULDU.
        //
        //   (b) "mutfağa gitmiş kalemi yalnız admin/cashier void eder". ADR-027
        //       Amd2 **K5** mutfağa gitmiş kalemin iptalini SERBEST bıraktı
        //       ("fişin varlık sebebi"; emniyet = görünürlük: istasyona giden
        //       iptal fişi + audit). Garson TÜM adisyonu iptal edebiliyordu ama
        //       TEK kalemi edemiyordu — büyük aksiyon açık, küçüğü kapalıydı.
        //
        // Ürün sahibi kararı (S104): mobilde "Kilitli" tamamen kalkar.
        //
        // ⚠️ PARA KAPISI BURAYA KONULMADI — denendi ve GERİ ALINDI (S104):
        // `ORDER_HAS_PAYMENTS` kalem void'ine eklenince ADR-014 Amendment 1 K3
        // kırıldı ("parçalı ödemeli siparişte son kalem iptali otomatik
        // KAPATMAZ" testi). Yani ödemesi olan adisyonda kalem iptali BELGELİ ve
        // TEST EDİLMİŞ bir akış; kapatılamaz.
        //
        // Sonuç: kalem void'i ödeme durumundan bağımsızdır (eskiden de öyleydi;
        // bu PR onu değiştirmedi). Sipariş-DÜZEYİ iptalde K3 kapısı yerinde
        // durur. Kalan risk kayda geçti: garson artık ödemesi alınmış
        // adisyondan kalem düşürebilir → tutar kayması audit'e yazılır ama
        // ENGELLENMEZ. v5.1 izleme listesi.

        const actorUserId = req.user!.userId;
        // ADR-024 K1/K3 — tek transaction: updateItemTx + writeAudit aynı tx'te
        // (ADR-002 §10.4). Gerçek değişimde (before != after) comp/void audit
        // yazılır; no-op toggle'da audit atlanır.
        const result = await deps.db.transaction().execute(async (trx) => {
          const r = await repo.updateItemTx(trx, tenantId, orderId, itemId, {
            ...(req.body.note !== undefined && { note: req.body.note }),
            ...(req.body.status !== undefined && { status: req.body.status }),
            ...(req.body.isComped !== undefined && {
              isComped: req.body.isComped,
            }),
          });

          // ADR-024 K3 — ikram (comp) toggle: yalnız is_comped gerçekten değiştiyse.
          if (
            req.body.isComped !== undefined &&
            r.itemBefore.isComped !== req.body.isComped
          ) {
            await writeAudit(trx, {
              tenantId,
              eventType: 'order_item.comped',
              actorUserId,
              entityType: 'order_item',
              entityId: itemId,
              rawPayload: {
                order_id: orderId,
                order_item_id: itemId,
                product_id: r.itemBefore.productId,
                is_comped_before: r.itemBefore.isComped,
                is_comped_after: req.body.isComped,
                amount_cents: r.itemBefore.totalCents,
              },
            });
          }

          // ADR-024 K3 — kalem void: status 'cancelled'e gerçekten geçtiyse.
          if (
            req.body.status === 'cancelled' &&
            r.itemBefore.status !== 'cancelled'
          ) {
            await writeAudit(trx, {
              tenantId,
              eventType: 'order_item.voided',
              actorUserId,
              entityType: 'order_item',
              entityId: itemId,
              rawPayload: {
                order_id: orderId,
                order_item_id: itemId,
                product_id: r.itemBefore.productId,
                status_before: r.itemBefore.status,
                amount_cents: r.itemBefore.totalCents,
              },
            });
          }

          // ADR-014 Amd1 K1 — son canlı kalem iptal edildiyse sipariş AYNI
          // tx'te otomatik iptal edilir (v3 autoCancelOrderIfNoActiveItems
          // paritesi; masa doluluğu açık-siparişten türev → masa boşalır).
          // K3 guard: void-olmamış ödeme izi varsa OTOMATİK iptal YOK (para
          // izi taşıyan adisyon sessiz kapanmaz; kasiyer ADR-033 ile çözer).
          if (
            req.body.status === 'cancelled' &&
            r.itemBefore.status !== 'cancelled' &&
            r.items.every((it) => it.status === 'cancelled')
          ) {
            const livePayment = await trx
              .selectFrom('payments')
              .select(['id'])
              .where('order_id', '=', orderId)
              .where('tenant_id', '=', tenantId)
              .where('voided_at', 'is', null)
              .limit(1)
              .executeTakeFirst();
            if (livePayment === undefined) {
              const cancelled = await repo.cancelOrderTx(
                trx,
                tenantId,
                orderId,
              );
              // K4 — auto işaretli order.cancelled audit (aynı tx).
              await writeAudit(trx, {
                tenantId,
                eventType: 'order.cancelled',
                actorUserId,
                entityType: 'order',
                entityId: orderId,
                rawPayload: {
                  order_id: orderId,
                  auto: true,
                  trigger_item_id: itemId,
                },
              });
              return {
                order: cancelled.order,
                items: cancelled.items,
                itemBefore: r.itemBefore,
                autoCancelled: true,
              };
            }
          }

          return { ...r, autoCancelled: false };
        });

        // ADR-004 Amd6 A6/A7 — kalem canlı→cancelled GEÇİŞİNDE mutfağa İPTAL
        // fişi (audit guard'ıyla aynı koşul = zaten-iptal re-PATCH ikinci fiş
        // üretmez). Best-effort: fiş üretilemezse iptal geri alınmaz (safeEmit
        // paritesi); mutfak bugünkü davranışa (sözlü) düşer.
        if (
          req.body.status === 'cancelled' &&
          result.itemBefore.status !== 'cancelled'
        ) {
          try {
            await enqueueCancelJob(deps.db, {
              tenantId,
              orderId,
              variant: 'item-cancel',
              itemIds: [itemId],
            });
          } catch {
            // best-effort — Amd6 A7; iptal başarısı fişe bağlanmaz.
          }
        }

        // Kalem güncellendi (void/comp/not) → sipariş total'i veya kalem listesi
        // değişmiş olabilir; tenant'a yayınla ki açık adisyon + masa tahtası
        // diğer terminallerde canlı güncellensin (ADR-010 §11.6). dine-in stage null.
        emitTenant(tenantId, 'orders.statusChanged', {
          orderId,
          takeawayStage: result.order.takeaway_stage,
          paid: false,
        });
        // ADR-014 Amd1 K6 — otomatik iptalde explicit iptalle AYNI event:
        // masa tahtası tüm terminallerde boşalır.
        if (result.autoCancelled) {
          emitTenant(tenantId, 'orders.cancelled', { orderId });
        }

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
   * RBAC: admin/cashier/kitchen tüm. waiter (ADR-008 Amendment 2026-06-28 /
   * ADR-025 K4): herhangi AÇIK (terminal olmayan) adisyon VEYA kendi adisyonu
   * (her status). Açık olmayan + kendi olmayan adisyon → 404 (IDOR yüzeyini
   * minimumda tut: kapalı/historical sipariş garson için yok hükmünde).
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
        if (req.user!.role === 'waiter') {
          const isOwn = result.order.waiter_user_id === req.user!.userId;
          const isOpen = !TERMINAL_ORDER_STATUSES.includes(result.order.status);
          if (!isOwn && !isOpen) {
            return next(domainError('ORDER_NOT_FOUND', 404));
          }
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
   * GET /orders — ABAC kuralı (ADR-008 §1/§2/§3 + Amendment 2026-06-28 / ADR-025 K4):
   * - admin/cashier/kitchen: tüm siparişler (tenant-scoped).
   * - waiter: tenant-geneli AÇIK (terminal olmayan) adisyonlar. Masa-devri için
   *   garson diğer garsonun açık adisyonunu görür; kapalı/ödenmiş/historical
   *   siparişler garsona görünmez (onlar rapor = admin/cashier).
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter', 'kitchen']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = OrderListQuerySchema.safeParse(req.query);
        if (!parsed.success) return next(parsed.error);

        // Default gün tenant tz'ye göre (R7-TZ-11): UTC-midnight İstanbul'da
        // 00:00-03:00 arası ÖNCEKİ günü döndürüyordu → tahta gece yarısından
        // sonra dünkü siparişleri gösteriyordu. Explicit storeDate param'ı
        // tz'den bağımsız (kullanıcı gün seçmiş).
        // Amd5 K10 — repo'ya YYYY-MM-DD STRING gider (Date bağlaması süreç-TZ
        // bağımlıydı); K9 paritesi: takvim-dışı tarih (2026-13-99) → 400.
        let storeDate: string;
        if (parsed.data.storeDate !== undefined) {
          if (Number.isNaN(parseDateParam(parsed.data.storeDate).getTime())) {
            throw domainError('VALIDATION_ERROR', 400);
          }
          storeDate = parsed.data.storeDate;
        } else {
          const tzRow = await deps.db
            .selectFrom('tenant_settings')
            .select(['timezone'])
            .where('tenant_id', '=', req.user!.tenantId)
            .executeTakeFirst();
          storeDate = todayStoreDateString(tzRow?.timezone ?? 'UTC');
        }

        const baseFilters = {
          ...(parsed.data.status !== undefined && { status: parsed.data.status }),
          ...(parsed.data.tableId !== undefined && { tableId: parsed.data.tableId }),
          ...(parsed.data.orderType !== undefined && { orderType: parsed.data.orderType }),
          storeDate,
        };
        const filters =
          req.user!.role === 'waiter'
            ? { ...baseFilters, openOnly: true }
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
        if (result.changed) {
          emitKitchen(tenantId, 'kitchen.itemStatusChanged', {
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
