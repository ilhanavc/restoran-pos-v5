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
import { logger } from '../logger.js';

/**
 * ADR-010 §11.3 Amendment K4 — emit fire-and-forget.
 *
 * Realtime emit'ler istek yolunda (`res.json` ÖNCESİNDE) tetiklenir; bir
 * yayın hatasının sipariş-create gibi bir mutation'ı 500'e düşürmesi veri
 * bütünlüğü/UX defect'idir (Blok 8 dersi, öncelik #2/#3). Bu yüzden:
 *   - payload `safeParse` edilir; başarısızsa structured `warn`-log + DROP
 *     (drift'i K7 CI testi yakalar → prod resilient / CI strict);
 *   - gerçek gönderim `try/catch` ile sarılır (Socket.IO `.emit()` de throw
 *     edebilir) → hiçbir emit-hatası istek yoluna sızmaz.
 *
 * Log PII taşımaz: yalnız event adı + zod issue metadata (path/code/message),
 * ham payload değeri DEĞİL.
 */
function safeEmit<Payload>(
  eventName: string,
  schema: z.ZodType<Payload>,
  payload: Payload,
  send: (parsed: Payload) => void,
): void {
  const result = schema.safeParse(payload);
  if (!result.success) {
    logger.warn(
      {
        event: eventName,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      },
      'realtime emit payload validation failed — dropped',
    );
    return;
  }
  try {
    send(result.data);
  } catch (err) {
    logger.warn({ event: eventName, err }, 'realtime emit failed — dropped');
  }
}

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
  safeEmit(deps.eventName, deps.payloadSchema, payload, (parsed) => {
    deps.io.of('/realtime').to(room).emit(deps.eventName, parsed);
  });
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
  safeEmit('caller.incoming', IncomingCallEventSchema, payload, (parsed) => {
    io
      .of('/realtime')
      .to(`tenant:${tenantId}:caller-station:${stationUserId}`)
      .emit('caller.incoming', parsed);
  });
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
  safeEmit(
    'caller.status_changed',
    CallerStatusChangedPayloadSchema,
    { callLogId, status },
    (parsed) => {
      io
        .of('/realtime')
        .to(`tenant:${tenantId}:caller-station:${stationUserId}`)
        .emit('caller.status_changed', parsed);
    },
  );
}

export function emitToSocket<EventName extends string, Payload>(
  socket: { emit: (event: EventName, payload: Payload) => boolean },
  schema: z.ZodType<Payload>,
  eventName: EventName,
  payload: Payload,
): void {
  safeEmit(eventName, schema, payload, (parsed) => {
    socket.emit(eventName, parsed);
  });
}
