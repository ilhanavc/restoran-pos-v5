import { z } from 'zod';
import { MoneyCentsSchema } from './money.js';
import { PaymentTypeSchema } from './payment.js';

export const OrderStatusSchema = z.enum([
  'open', 'sent_to_kitchen', 'partially_served',
  'served', 'billed', 'paid', 'cancelled', 'void',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderTypeSchema = z.enum(['dine_in', 'takeaway', 'delivery']);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export const OrderItemSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  productName: z.string(),
  categoryNameSnapshot: z.string(),
  unitPriceCents: MoneyCentsSchema,
  quantity: z.number().int().positive(),
  totalCents: MoneyCentsSchema,
  isComped: z.boolean(),
  note: z.string().nullable(),
  /** ADR-013 §11 (Migration 021) — porsiyon snapshot. */
  variantIdSnapshot: z.string().uuid().nullable(),
  variantNameSnapshot: z.string().nullable(),
  variantPriceDeltaCentsSnapshot: z.number().int().nullable(),
  /** Actor rozeti — ADR-013 §5; PR-4 Migration 019 ile eklendi.
   *  FK ON DELETE SET NULL (ADR-002 §10.10 hard delete) sonrası user_id
   *  NULL olabilir; createdByName text snapshot forensic kanıt korur. */
  createdByUserId: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

/**
 * Seçilen özellik — PR-6 (ADR-013 §10 Karar 10.5). Frontend yalnız
 * (groupId, optionId) gönderir; sunucu DB'den extra_price_cents +
 * group/option name snapshot'larını resolve eder.
 */
export const SelectedAttributeInputSchema = z.object({
  groupId: z.string().uuid(),
  optionId: z.string().uuid(),
});
export type SelectedAttributeInput = z.infer<typeof SelectedAttributeInputSchema>;

/**
 * POST /orders body içindeki nested item input — PR-4 + PR-6 (ADR-013 §1+§2+§10).
 *
 * Kapsam (PR-4): productId + quantity + note.
 * Kapsam (PR-6): selectedAttributes opsiyonel; sunucu `is_required` validate
 * eder, `selection_type='single'` grupta >1 seçim 400, extra_price_cents
 * snapshot'la unit_price_cents'e eklenir.
 *
 * Porsiyon (variantId) v5.1 backlog (kapsam dışı).
 */
export const OrderItemCreateInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(99),
  note: z.string().max(280).optional(),
  selectedAttributes: z.array(SelectedAttributeInputSchema).max(20).optional(),
  /** ADR-013 §11 — porsiyon (product_variants.id). Backend variant'a göre
   *  price_delta_cents'i unit_price_cents'e ekler ve snapshot'lar. */
  variantId: z.string().uuid().optional(),
});
export type OrderItemCreateInput = z.infer<typeof OrderItemCreateInputSchema>;

export const OrderRowSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tableId: z.string().uuid().nullable(),
  orderType: OrderTypeSchema,
  status: OrderStatusSchema,
  storeDate: z.string(),
  orderNo: z.number().int().positive(),
  waiterUserId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  totalCents: MoneyCentsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrderRow = z.infer<typeof OrderRowSchema>;

export const OrderCreateRequestSchema = z.object({
  tenantId: z.string().uuid(),
  tableId: z.string().uuid().nullable(),
  orderType: OrderTypeSchema,
  waiterUserId: z.string().uuid().nullable(),
  note: z.string().optional(),
});
export type OrderCreateRequest = z.infer<typeof OrderCreateRequestSchema>;

/**
 * POST /orders body — atomik order + items insert (ADR-013 §1+§2 Karar 9.1).
 *
 * `items[]` opsiyonel: boş array veya undefined → header-only sipariş
 * (PR-3 öncesi davranış geriye uyumluluk). Doluysa server tek transaction'da
 * order + order_items insert eder; snapshot (productName, unitPriceCents,
 * categoryNameSnapshot, totalCents) server-side hesaplanır (UI değerleri
 * gönderebilir ama otorite sunucu).
 */
export const OrderCreateApiRequestSchema = z.object({
  tableId: z.string().uuid().nullable(),
  orderType: OrderTypeSchema,
  note: z.string().max(500).optional(),
  customerId: z.string().uuid().optional(),
  items: z.array(OrderItemCreateInputSchema).max(99).optional(),
}).refine(
  (data) => data.orderType !== 'dine_in' || data.tableId !== null,
  { message: 'order.tableRequiredForDineIn', path: ['tableId'] }
);
export type OrderCreateApiRequest = z.infer<typeof OrderCreateApiRequestSchema>;

/**
 * POST /orders/:id/items body — mevcut siparişe kalem ekleme (ADR-013 §1).
 * En az 1 item zorunlu; closed/cancelled siparişlere ekleme handler'da reddedilir.
 */
export const OrderAddItemsRequestSchema = z.object({
  items: z.array(OrderItemCreateInputSchema).min(1).max(99),
});
export type OrderAddItemsRequest = z.infer<typeof OrderAddItemsRequestSchema>;

/**
 * PATCH /orders/:orderId/items/:itemId body — persisted kalem partial update.
 *
 * PR-5 kapsamı (ADR-013 §6, §9.2 + v3 `canVoidOrderItem` paritesi):
 *   - `note` partial update (her rol)
 *   - `status` partial update — yalnız `'cancelled'` (void) izinli MVP'de;
 *     diğer FSM geçişleri Phase 3 KDS scope (sent → preparing → ready → served)
 *   - `is_comped` (ikram toggle) — admin/cashier yetkisi (ADR-013 §9.2)
 *
 * Boş body yasak — en az bir alan dolu olmalı.
 *
 * Yetki (handler'da uygulanır, schema role-agnostic):
 *   - `is_comped: true` → admin/cashier only (kitchen + waiter 403 AUTH_FORBIDDEN)
 *   - `status: 'cancelled'` + item.status='new' → her rol void edebilir
 *   - `status: 'cancelled'` + item.status !== 'new' → admin/cashier only
 */
/**
 * PATCH /orders/:id body — sipariş düzeyinde güncelleme.
 * MVP (ADR-014 §9.6 + §10.4):
 *   - 'cancelled' → 3-nokta menü "Siparişi İptal Et"
 *   - 'paid' → QuickPaymentModal Mod B "Masayı Kapat" (zaten ödenmiş sipariş close)
 *
 * Backend transitions (handler authoritative):
 *   - 'paid' → SUM(payments.amount_cents) >= orders.total_cents zorunlu;
 *     eksikse 400 PAYMENT_INSUFFICIENT_FOR_CLOSE
 *   - Her ikisi de terminal status (paid|cancelled|void) reddi
 *   - RBAC: admin/cashier
 */
export const OrderUpdateSchema = z.object({
  status: z.enum(['cancelled', 'paid']),
});
export type OrderUpdate = z.infer<typeof OrderUpdateSchema>;

/**
 * PATCH /orders/:id/customer body — persisted siparişe müşteri ata/kaldır.
 *
 * Session 53 (v3 paritesi). Genel kural:
 *   - dine_in: customerId nullable (atanabilir, kaldırılabilir)
 *   - takeaway: customerId NOT NULL — Migration 028 CHECK constraint
 *     (`orders_takeaway_customer_when_takeaway`) null'a inmesini engeller;
 *     handler 400 TAKEAWAY_CUSTOMER_REQUIRED ile erken reddeder.
 *   - delivery: nullable (delivery snapshot ayrı domain).
 *
 * order_type bu endpoint'te DEĞİŞMEZ. Sadece customer_id UPDATE edilir.
 *
 * RBAC: admin / cashier / waiter (sipariş alma sırasında waiter da müşteri
 * atayabilir; ADR-016 customers.read 4 rolde mevcut).
 */
export const OrderAssignCustomerSchema = z.object({
  customerId: z.string().uuid().nullable(),
});
export type OrderAssignCustomer = z.infer<typeof OrderAssignCustomerSchema>;

export const OrderItemUpdateSchema = z
  .object({
    note: z.string().max(280).nullable().optional(),
    status: z.enum(['cancelled']).optional(),
    isComped: z.boolean().optional(),
  })
  .refine(
    (v) => v.note !== undefined || v.status !== undefined || v.isComped !== undefined,
    { message: 'patch:empty_body' },
  );
export type OrderItemUpdate = z.infer<typeof OrderItemUpdateSchema>;

export const OrderListQuerySchema = z.object({
  status: OrderStatusSchema.optional(),
  tableId: z.string().uuid().optional(),
  storeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  orderType: OrderTypeSchema.optional(),
});
export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;

// =====================================================================
// ADR-017 — Paket servis (takeaway) akışı
// =====================================================================

/** ADR-017 §2 — takeaway sipariş üç aşaması.
 *  preparing → out_for_delivery → delivered (terminal). */
export const TakeawayStageSchema = z.enum([
  'preparing',
  'out_for_delivery',
  'delivered',
]);
export type TakeawayStage = z.infer<typeof TakeawayStageSchema>;

/** ADR-017 takeaway için planlanan ödeme tipi.
 *  payment_type DB enum'unu re-use eder (cash/card/transfer); UI MVP'de
 *  cash/card sunar. Ek kısıt route katmanında uygulanır. */
export const PlannedPaymentTypeSchema = PaymentTypeSchema;
export type PlannedPaymentType = z.infer<typeof PlannedPaymentTypeSchema>;

/** ADR-017 §3 — takeaway sipariş oluşturma input'u (POST /orders).
 *  - customerId zorunlu (DB CHECK constraint orders_takeaway_customer_when_takeaway)
 *  - customerAddressId opsiyonel (paketçi gel-al senaryosu için yok); route
 *    handler verilirse müşteri adresinden snapshot çıkarır.
 *  - deliveryNote opsiyonel (ADR §3 — adres yokken bile zorunlu DEĞİL). */
export const CreateTakeawayOrderInputSchema = z.object({
  type: z.literal('takeaway'),
  customerId: z.string().uuid(),
  customerAddressId: z.string().uuid().optional(),
  deliveryNote: z.string().max(500).optional(),
  plannedPaymentType: PlannedPaymentTypeSchema,
  items: OrderItemCreateInputSchema.array().min(1).max(99),
});
export type CreateTakeawayOrderInput = z.infer<
  typeof CreateTakeawayOrderInputSchema
>;

/** Discriminated union — Phase 3'te dine_in variant eklenir. */
export const CreateOrderRequestSchema = z.discriminatedUnion('type', [
  CreateTakeawayOrderInputSchema,
]);
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

/** PATCH /orders/:id/takeaway-stage — sadece ileri geçişler.
 *  preparing → out_for_delivery, out_for_delivery → delivered.
 *  Geri dönüş + 'preparing' set yasak (route handler enforce eder). */
export const UpdateTakeawayStageInputSchema = z.object({
  stage: z.enum(['out_for_delivery', 'delivered']),
});
export type UpdateTakeawayStageInput = z.infer<
  typeof UpdateTakeawayStageInputSchema
>;

/** Takeaway listeleme query — açık paket servis kuyruğu için. */
export const TakeawayListQuerySchema = z.object({
  type: z.enum(['takeaway']).optional(),
  status: z.enum(['open', 'paid', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TakeawayListQuery = z.infer<typeof TakeawayListQuerySchema>;

/** ADR-017 §4 — order detail response item shape (read model). */
export const OrderItemResponseSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  productName: z.string(),
  quantity: z.number().int(),
  unitPriceCents: MoneyCentsSchema,
  lineTotalCents: MoneyCentsSchema,
  notes: z.string().nullable(),
  /** Actor rozeti (ADR-013 §5) — AdisyonPanel "İLHAN · 16:46" chip için.
   *  FK ON DELETE SET NULL sonrası user_id NULL olabilir; createdByName
   *  text snapshot forensic kanıt korur. */
  createdByUserId: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
});
export type OrderItemResponse = z.infer<typeof OrderItemResponseSchema>;

/** ADR-017 §4 — order detail response (takeaway + dine_in birleşik shape). */
export const OrderResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  type: OrderTypeSchema,
  status: OrderStatusSchema,
  takeawayStage: TakeawayStageSchema.nullable(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  deliveryAddressSnapshot: z.string().nullable(),
  deliveryNote: z.string().nullable(),
  plannedPaymentType: PlannedPaymentTypeSchema.nullable(),
  items: OrderItemResponseSchema.array(),
  subtotalCents: MoneyCentsSchema,
  taxCents: MoneyCentsSchema,
  totalCents: MoneyCentsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrderResponse = z.infer<typeof OrderResponseSchema>;
