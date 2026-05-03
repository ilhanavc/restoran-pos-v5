import { z } from 'zod';
import { CustomerResponseSchema } from './customers.js';

/**
 * Caller ID çağrı log şemaları — ADR-016 §11 (Karar 11.6 + Amendment 1).
 *
 * Akış:
 *   1. .NET bridge → POST /caller/incoming (BridgeIncomingCallSchema)
 *   2. Backend normalize + müşteri lookup + bypass kontrol
 *   3. Eşleşirse `IncomingCallEvent` Socket.IO ile istasyona broadcast
 *   4. İstasyon UI: dismiss / yeni sipariş aç → call_logs.status update
 */

export const CallLogStatusSchema = z.enum([
  'ringing',       // bridge yeni gönderdi, henüz aksiyon yok
  'dismissed',     // istasyon popup'ı kapattı (sipariş açmadı)
  'opened_order',  // sipariş açıldı (opened_order_id set)
  'completed',     // sipariş ödendi/kapandı (geriye dönük güncelleme)
]);
export type CallLogStatus = z.infer<typeof CallLogStatusSchema>;

export const CallLogSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  rawPhone: z.string().nullable(),
  normalizedPhone: z.string().nullable(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),     // join (denormalize edilmedi, listede gösterim için)
  isBlacklisted: z.boolean().nullable(),   // join — null = customer yok
  status: CallLogStatusSchema,
  openedOrderId: z.string().uuid().nullable(),
  stationUserId: z.string().uuid().nullable(),
  receivedAt: z.string().datetime(),
});
export type CallLog = z.infer<typeof CallLogSchema>;

export const CallLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  since: z.string().datetime().optional(),
});
export type CallLogQuery = z.infer<typeof CallLogQuerySchema>;

export const CallLogResponseSchema = z.object({
  calls: z.array(CallLogSchema),
});
export type CallLogResponse = z.infer<typeof CallLogResponseSchema>;

/**
 * .NET bridge → backend POST gövdesi. `lineNumber` modem hat indeksi
 * (Cyfrowys C812A: 1-2, C814A: 1-4) — opsiyonel, log'a yazılmaz, gelecekte
 * raporlama için saklanabilir.
 */
export const BridgeIncomingCallSchema = z.object({
  rawPhone: z.string().min(1).max(30),
  lineNumber: z.number().int().min(1).max(8).optional(),
  receivedAt: z.string().datetime(),
});
export type BridgeIncomingCall = z.infer<typeof BridgeIncomingCallSchema>;

/**
 * Backend yanıtı. Bypass pattern eşleşirse `accepted=false` + reason; bridge
 * sessizce devam eder (kullanıcıya popup gösterilmez).
 */
export const BridgeIncomingCallResponseSchema = z.object({
  accepted: z.boolean(),
  reason: z.enum(['ok', 'masked_bypass', 'duplicate', 'invalid']).optional(),
  callLogId: z.string().uuid().nullable().optional(),
});
export type BridgeIncomingCallResponse = z.infer<typeof BridgeIncomingCallResponseSchema>;

/**
 * Socket.IO `caller_id.incoming` event payload — sadece atanmış istasyona
 * gönderilir (ADR-016 §11 Karar 11.3).
 */
export const IncomingCallEventSchema = z.object({
  callLogId: z.string().uuid(),
  rawPhone: z.string(),
  normalizedPhone: z.string(),
  customer: CustomerResponseSchema.pick({
    id: true,
    fullName: true,
    isBlacklisted: true,
    totalOrders: true,
    addresses: true,
  }).nullable(),
  receivedAt: z.string().datetime(),
});
export type IncomingCallEvent = z.infer<typeof IncomingCallEventSchema>;
