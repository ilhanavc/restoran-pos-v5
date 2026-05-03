// ADR-010 §11.3: Bu dosya tek emit path. Direct `io.of(ns).emit` kullanımı
// yalnız burada izinli (eslint.config.js `ignores` listesi); diğer apps/api
// dosyalarında `no-restricted-syntax` kuralı kapatır.
import type { Server } from 'socket.io';
import type { z } from 'zod';
import {
  type CallLogStatus,
  type IncomingCallEvent,
  IncomingCallEventSchema,
  CallerStatusChangedPayloadSchema,
  type UserRole,
} from '@restoran-pos/shared-types';

/**
 * Tek emit path wrapper (ADR-010 §11.3).
 *
 * Direct `io.emit` / `io.of(ns).emit` apps/api genelinde ESLint
 * `no-restricted-syntax` kuralıyla yasaklı. Tüm publish bu helper'lar
 * üzerinden geçer:
 *   - Payload zod schema parse — server bug erken yakalanır
 *   - Tenant izolasyonu room ismi enforcement (cross-tenant leak yok)
 *   - Event ismi tip güvencesi (literal union)
 */
export interface EmitDeps<EventName extends string, Payload> {
  io: Server;
  eventName: EventName;
  payloadSchema: z.ZodType<Payload>;
}

function emitToRoom<EventName extends string, Payload>(
  deps: EmitDeps<EventName, Payload>,
  room: string,
  payload: Payload,
): void {
  const parsed = deps.payloadSchema.parse(payload);
  deps.io.of('/realtime').to(room).emit(deps.eventName, parsed);
}

export function emitToTenant<EventName extends string, Payload>(
  deps: EmitDeps<EventName, Payload>,
  tenantId: string,
  payload: Payload,
): void {
  emitToRoom(deps, `tenant:${tenantId}`, payload);
}

export function emitToRole<EventName extends string, Payload>(
  deps: EmitDeps<EventName, Payload>,
  tenantId: string,
  role: UserRole,
  payload: Payload,
): void {
  emitToRoom(deps, `tenant:${tenantId}:role:${role}`, payload);
}

export function emitToUser<EventName extends string, Payload>(
  deps: EmitDeps<EventName, Payload>,
  userId: string,
  payload: Payload,
): void {
  emitToRoom(deps, `user:${userId}`, payload);
}

/**
 * Tek socket-scoped emit helper. Connection event'i sırasında YENİ bağlanan
 * socket'e (örn. `system.hello` greeting) gönderim için. Multi-cihaz/multi-room
 * fan-out gerektirmediğinden room helper'ları yerine tekil socket targeting.
 *
 * ESLint `no-restricted-syntax` kuralı `socket.emit` çağrısını yasakladığından,
 * tüm `socket.emit` kullanımları bu helper üzerinden geçer (zod parse zorunlu).
 */
/**
 * ADR-016 §11 — caller-station room'una `caller.incoming` broadcast.
 * Sadece atanmış istasyon kullanıcısı bu room'a join olur (handshake.ts).
 */
export function emitIncomingCall(
  io: Server,
  tenantId: string,
  stationUserId: string,
  payload: IncomingCallEvent,
): void {
  const parsed = IncomingCallEventSchema.parse(payload);
  io
    .of('/realtime')
    .to(`tenant:${tenantId}:caller-station:${stationUserId}`)
    .emit('caller.incoming', parsed);
}

/**
 * ADR-016 §11 — call_log status değişimi broadcast.
 */
export function emitCallStatusChanged(
  io: Server,
  tenantId: string,
  stationUserId: string,
  callLogId: string,
  status: CallLogStatus,
): void {
  const parsed = CallerStatusChangedPayloadSchema.parse({ callLogId, status });
  io
    .of('/realtime')
    .to(`tenant:${tenantId}:caller-station:${stationUserId}`)
    .emit('caller.status_changed', parsed);
}

export function emitToSocket<EventName extends string, Payload>(
  socket: { emit: (event: EventName, payload: Payload) => boolean },
  schema: z.ZodType<Payload>,
  eventName: EventName,
  payload: Payload,
): void {
  const parsed = schema.parse(payload);
  socket.emit(eventName, parsed);
}
