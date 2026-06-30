import { z } from 'zod';
import { UserRoleSchema } from './user.js';
import { type IncomingCallEvent, CallLogStatusSchema } from './call-logs.js';
import { OrderTypeSchema, TakeawayStageSchema } from './order.js';

/**
 * Realtime event isim konvansiyonu (ADR-010 §11.1).
 * 2 segment dot-notation: `<resource>.<verb>` — DB audit_logs CHECK constraint
 * pattern'iyle bire bir hizalı (`^[a-z_]+\.[a-z_]+$`).
 *
 * Phase 2 MVP: yalnız iskelet event'ler. Phase 3 KDS + Phase 4 mobil genişletir.
 */
export type RealtimeEventName =
  | 'system.hello' // handshake sonrası tek atışlık server → client greeting
  | 'system.ping' // heartbeat alternatif (ADR-010 §7 default kullanılır,
  //                                       ama explicit ping testleri için)
  | 'caller.incoming' // ADR-016 §11 — bridge → istasyona popup
  | 'caller.status_changed' // call_log status update broadcast
  // ADR-020 K6 (Sprint 12 PR-2) — KDS realtime push.
  | 'kitchen.orderSent' // POST /orders Kaydet hook → mutfak ekranı yeni sipariş
  | 'kitchen.itemStatusChanged' // PATCH /orders/:o/items/:i/status sonrası
  // ADR-010 §11 Amendment (2026-06-28) / ADR-025 K5 — orders.* canlı ortak
  // masa tahtası. tenant:{id} room → role:waiter dahil herkes tüketir (ek room
  // yok). Colon-string (`order:created` vb.) → dot-notation formalizasyonu.
  | 'orders.created' // POST /orders sonrası — yeni sipariş açıldı
  | 'orders.statusChanged' // PATCH takeaway stage / ödeme sonrası durum değişti
  | 'orders.cancelled' // POST /orders/:id/cancel sonrası
  | 'orders.customerAssigned'; // PATCH /orders/:id/customer sonrası

/**
 * Tüm realtime event payload'larının zorunlu base alanları (ADR-010 §11.2).
 * Idempotency key (event_id) + tenant scope (tenant_id) + timestamp
 * (emitted_at, RFC3339).
 */
export const RealtimeEventBaseSchema = z.object({
  event_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  emitted_at: z.string().datetime(),
});
export type RealtimeEventBase = z.infer<typeof RealtimeEventBaseSchema>;

/**
 * `RealtimeAck<T>` discriminated union (ADR-010 §6.2).
 * Client tarafı `socket.emit(event, payload, (ack) => ...)` callback'inde
 * `ack` bu yapıda gelir; server tarafı `cb({ok:true,data}) | cb({ok:false,error})`.
 */
export const RealtimeAckOkSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({ ok: z.literal(true), data: dataSchema });

export const RealtimeAckErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message_key: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type RealtimeAck<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message_key: string;
        details?: Record<string, unknown>;
      };
    };

/**
 * `system.hello` event payload — handshake sonrası tek atışlık.
 * Client connect'i başardığını + server-side rooms'u doğrulamak için.
 */
export const SystemHelloPayloadSchema = RealtimeEventBaseSchema.extend({
  user_id: z.string().uuid(),
  role: UserRoleSchema,
  rooms: z.array(z.string()), // ["tenant:<id>", "tenant:<id>:role:<role>", "user:<id>"]
});
export type SystemHelloPayload = z.infer<typeof SystemHelloPayloadSchema>;

/**
 * `system.ping` ack data payload.
 */
export const SystemPingAckDataSchema = z.object({
  pong: z.literal(true),
  server_time: z.string().datetime(),
});
export type SystemPingAckData = z.infer<typeof SystemPingAckDataSchema>;

/**
 * Server → Client event map (Socket.IO generic'lerine bağlanır).
 * Phase 3/4'te genişler.
 */
/**
 * `caller.status_changed` event payload (ADR-016 §11).
 */
export const CallerStatusChangedPayloadSchema = z.object({
  callLogId: z.string().uuid(),
  status: CallLogStatusSchema,
});
export type CallerStatusChangedPayload = z.infer<
  typeof CallerStatusChangedPayloadSchema
>;

/**
 * ADR-020 K6 (Sprint 12 PR-2) — KDS realtime payload schemas.
 *
 * `kitchen.orderSent`: POST /orders Kaydet sonrası, `kitchen_print=true`
 * kategori kalemleri varsa mutfak ekranına push. Items: yalnız KDS-relevant
 * subset (id, productName snapshot, qty). UI sipariş detayını yeniden
 * fetch'lemeden ekrana yazabilir.
 *
 * `kitchen.itemStatusChanged`: PATCH /items/:itemId/status transition sonrası.
 * KDS UI optimistic update için minimal envelope.
 */
export const KitchenOrderSentItemSchema = z.object({
  id: z.string().uuid(),
  productName: z.string(),
  qty: z.number().int().positive(),
});
export type KitchenOrderSentItem = z.infer<typeof KitchenOrderSentItemSchema>;

export const KitchenOrderSentPayloadSchema = z.object({
  orderId: z.string().uuid(),
  tableId: z.string().uuid().nullable(),
  orderType: z.enum(['dine_in', 'takeaway', 'delivery']),
  items: z.array(KitchenOrderSentItemSchema),
});
export type KitchenOrderSentPayload = z.infer<
  typeof KitchenOrderSentPayloadSchema
>;

export const KitchenItemStatusChangedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  itemId: z.string().uuid(),
  status: z.enum(['preparing', 'ready']),
});
export type KitchenItemStatusChangedPayload = z.infer<
  typeof KitchenItemStatusChangedPayloadSchema
>;

/**
 * ADR-010 §11 Amendment (2026-06-28) / ADR-025 K5 — `orders.*` realtime
 * payload schemas. Mobil garson "canlı ortak masa tahtası" bu event'leri
 * tüketir: bir garson masa açtı/kapadı → tüm istemcilere anında yansır.
 *
 * Payload'lar `apps/api/src/routes/orders.ts` mevcut emit'lerine SADIK
 * (alan adları/tipleri birebir). kitchen / caller event paterniyle hizalı:
 * domain-spesifik alanlar, base meta YOK (§11.2 base meta MVP'de yalnız
 * spec — implementasyonda kitchen/caller event'leri de taşımıyor; tutarlılık
 * için bu event'ler de taşımaz). Para birimi integer kuruş (`total_cents`).
 *
 * `orders.created`: POST /orders sonrası — yeni sipariş açıldığını broadcast.
 * `orders.statusChanged`: takeaway stage / ödeme sonrası durum güncellemesi.
 * `orders.cancelled`: iptal sonrası minimal envelope (UI refetch tetikler).
 * `orders.customerAssigned`: müşteri atama sonrası.
 */
export const OrderCreatedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  type: OrderTypeSchema,
  // null for dine_in (no takeaway stage); the enum stage only for takeaway/
  // delivery. (ADR-010 §11.6 — dine_in orders.created broadcast, PR-5d.)
  takeawayStage: TakeawayStageSchema.nullable(),
  total_cents: z.number().int().nonnegative(),
});
export type OrderCreatedPayload = z.infer<typeof OrderCreatedPayloadSchema>;

export const OrderStatusChangedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  // null for dine_in (no takeaway stage) — e.g. a dine-in table being paid/
  // closed. Enum stage only for takeaway/delivery. (ADR-010 §11.6, PR-5d.)
  takeawayStage: TakeawayStageSchema.nullable(),
  paid: z.boolean(),
});
export type OrderStatusChangedPayload = z.infer<
  typeof OrderStatusChangedPayloadSchema
>;

export const OrderCancelledPayloadSchema = z.object({
  orderId: z.string().uuid(),
});
export type OrderCancelledPayload = z.infer<
  typeof OrderCancelledPayloadSchema
>;

export const OrderCustomerAssignedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  // `null` = müşteri kaldırıldı (dine_in un-assign). OrderAssignCustomerSchema
  // ile SADIK: `customerId` nullable (takeaway null reddi route'ta).
  customerId: z.string().uuid().nullable(),
});
export type OrderCustomerAssignedPayload = z.infer<
  typeof OrderCustomerAssignedPayloadSchema
>;

export interface ServerToClientEvents {
  'system.hello': (payload: SystemHelloPayload) => void;
  'caller.incoming': (payload: IncomingCallEvent) => void;
  'caller.status_changed': (payload: CallerStatusChangedPayload) => void;
  'kitchen.orderSent': (payload: KitchenOrderSentPayload) => void;
  'kitchen.itemStatusChanged': (
    payload: KitchenItemStatusChangedPayload,
  ) => void;
  // ADR-010 §11 Amendment (2026-06-28) / ADR-025 K5 — orders.* canlı tahta.
  'orders.created': (payload: OrderCreatedPayload) => void;
  'orders.statusChanged': (payload: OrderStatusChangedPayload) => void;
  'orders.cancelled': (payload: OrderCancelledPayload) => void;
  'orders.customerAssigned': (
    payload: OrderCustomerAssignedPayload,
  ) => void;
  // Phase 3'te genişleyecek: 'tables.statusChanged', 'payments.recorded', vs.
}


/**
 * Client → Server event map. MVP'de yalnız ping.
 * Phase 4'te garson client'tan event geldikçe genişler.
 */
export interface ClientToServerEvents {
  'system.ping': (
    cb: (ack: RealtimeAck<SystemPingAckData>) => void,
  ) => void;
}
