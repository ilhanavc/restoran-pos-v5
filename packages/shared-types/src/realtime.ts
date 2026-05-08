import { z } from 'zod';
import { UserRoleSchema } from './user.js';
import { type IncomingCallEvent, CallLogStatusSchema } from './call-logs.js';

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
  | 'kitchen.itemStatusChanged'; // PATCH /orders/:o/items/:i/status sonrası

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

export interface ServerToClientEvents {
  'system.hello': (payload: SystemHelloPayload) => void;
  'caller.incoming': (payload: IncomingCallEvent) => void;
  'caller.status_changed': (payload: CallerStatusChangedPayload) => void;
  'kitchen.orderSent': (payload: KitchenOrderSentPayload) => void;
  'kitchen.itemStatusChanged': (
    payload: KitchenItemStatusChangedPayload,
  ) => void;
  // Phase 3'te genişleyecek: 'orders.created', 'tables.statusChanged', vs.
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
