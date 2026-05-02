import { z } from 'zod';
import { MoneyCentsSchema } from './money.js';

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
  /** Actor rozeti — ADR-013 §5; PR-4 Migration 019 ile eklendi.
   *  FK ON DELETE SET NULL (ADR-002 §10.10 hard delete) sonrası user_id
   *  NULL olabilir; createdByName text snapshot forensic kanıt korur. */
  createdByUserId: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

/**
 * POST /orders body içindeki nested item input — PR-4 (ADR-013 §1+§2).
 *
 * Kapsam (PR-4): productId + quantity + note. Varyant (variantId) ve
 * attribute opsiyonları PR-6'da `OrderItemCreateInputSchemaV2` olarak
 * eklenir; o aşamada attribute_groups + product_variants relations
 * server-side resolve edilir, snapshot fiyatı yeniden hesaplanır.
 */
export const OrderItemCreateInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(99),
  note: z.string().max(280).optional(),
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
