import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Server, Socket } from 'socket.io';
import {
  type ClientToServerEvents,
  type ServerToClientEvents,
  SystemHelloPayloadSchema,
  type UserRole,
} from '@restoran-pos/shared-types';
import { emitToSocket } from './emit.js';
import { REALTIME_ERROR_CODES, RealtimeConnectError } from './errors.js';

declare module 'socket.io' {
  interface SocketData {
    user: {
      userId: string;
      tenantId: string;
      role: UserRole;
    };
  }
}

export interface ConnectionCounters {
  perUser: Map<string, number>;
  perTenant: Map<string, number>;
}

export interface HandshakeDeps {
  accessSecret: string;
  perUserLimit: number;
  perTenantLimit: number;
  counters: ConnectionCounters;
}

interface JwtPayloadShape {
  sub: string;
  tenantId: string;
  role: UserRole;
  exp: number;
  iat: number;
}

const VALID_ROLES: readonly UserRole[] = [
  'admin',
  'cashier',
  'waiter',
  'kitchen',
];

/**
 * Socket.IO namespace handshake middleware (ADR-010 §3.1 + §3.3 + §9).
 *
 * 1. Token zorunlu (`socket.handshake.auth.token`).
 * 2. JWT verify (access secret) + tenant/role claim doğrulama.
 * 3. Connection limit check (per-user + per-tenant). ADR-010 §9.
 *
 * Tüm reject path'leri `RealtimeConnectError` ile `connect_error` event'ine
 * map edilir. Mesajlar i18n-key — Türkçe metin yok.
 */
export function createHandshakeMiddleware(deps: HandshakeDeps) {
  return (
    socket: Socket<ClientToServerEvents, ServerToClientEvents>,
    next: (err?: Error) => void,
  ): void => {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    const token = auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      next(
        new RealtimeConnectError(
          'AUTH_TOKEN_MISSING',
          REALTIME_ERROR_CODES.AUTH_TOKEN_MISSING,
        ),
      );
      return;
    }

    let payload: JwtPayloadShape;
    try {
      const verified = jwt.verify(token, deps.accessSecret);
      payload = verified as JwtPayloadShape;
    } catch {
      next(
        new RealtimeConnectError(
          'AUTH_TOKEN_INVALID',
          REALTIME_ERROR_CODES.AUTH_TOKEN_INVALID,
        ),
      );
      return;
    }

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      !VALID_ROLES.includes(payload.role)
    ) {
      next(
        new RealtimeConnectError(
          'AUTH_TOKEN_INVALID',
          REALTIME_ERROR_CODES.AUTH_TOKEN_INVALID,
        ),
      );
      return;
    }

    // ATOMIC check + increment (security review A2 — TOCTOU race fix).
    // Node single-thread event loop'ta middleware sync; check ve increment
    // arasında microtask/IO yok → concurrent handshake'ler sıralı işlenir,
    // race yok. attachConnectionHandlers'da increment YAPILMAZ; yalnız
    // disconnect handler decrement eder.
    const userCount = deps.counters.perUser.get(payload.sub) ?? 0;
    if (userCount >= deps.perUserLimit) {
      next(
        new RealtimeConnectError(
          'CONN_LIMIT_USER',
          REALTIME_ERROR_CODES.CONN_LIMIT_USER,
        ),
      );
      return;
    }

    const tenantCount = deps.counters.perTenant.get(payload.tenantId) ?? 0;
    if (tenantCount >= deps.perTenantLimit) {
      next(
        new RealtimeConnectError(
          'CONN_LIMIT_TENANT',
          REALTIME_ERROR_CODES.CONN_LIMIT_TENANT,
        ),
      );
      return;
    }

    deps.counters.perUser.set(payload.sub, userCount + 1);
    deps.counters.perTenant.set(payload.tenantId, tenantCount + 1);

    socket.data.user = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
    };
    next();
  };
}

/**
 * ADR-016 §11 — caller-station room auto-join lookup.
 * `attachConnectionHandlers` opsiyonel olarak alır; null dönerse join atlanır.
 * DB-agnostic kalmak için fonksiyon pointer (realtime katmanı db import etmez).
 */
export type CallerStationLookup = (
  tenantId: string,
) => Promise<string | null>;

export interface AttachConnectionHandlersDeps {
  callerStationLookup?: CallerStationLookup;
}

/**
 * Connection-level handler (ADR-010 §4.2 + §8 + §11).
 *
 * - Connection counters increment (handshake limit kontrolü için).
 * - 3 oda join: `tenant:{id}`, `tenant:{id}:role:{role}`, `user:{id}`.
 * - ADR-016 §11 — eğer user.id === settings.caller_id_station_user_id ise
 *   ek olarak `tenant:{id}:caller-station:{userId}` room'a join.
 * - `system.hello` event emit (handshake sonrası tek atışlık greeting).
 * - `system.ping` ack pattern (explicit ack test'leri için).
 * - `disconnect` counter decrement.
 */
export function attachConnectionHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  counters: ConnectionCounters,
  deps: AttachConnectionHandlersDeps = {},
): void {
  io.of('/realtime').on('connection', (socket) => {
    const { userId, tenantId, role } = socket.data.user;

    // Counter increment middleware'de atomik yapıldı (security A2 fix);
    // burada YAPILMAZ. Yalnız disconnect handler decrement eder.

    const rooms = [
      `tenant:${tenantId}`,
      `tenant:${tenantId}:role:${role}`,
      `user:${userId}`,
    ];
    void socket.join(rooms);

    // ADR-016 §11 — caller-station room. Lookup başarısızlığı bağlantıyı
    // bozmamalı (caller-id opsiyonel feature); hata logger'a gider, socket
    // çalışmaya devam eder.
    if (deps.callerStationLookup !== undefined) {
      const lookup = deps.callerStationLookup;
      void lookup(tenantId)
        .then((stationUserId) => {
          if (stationUserId !== null && stationUserId === userId) {
            void socket.join(
              `tenant:${tenantId}:caller-station:${userId}`,
            );
          }
        })
        .catch(() => {
          // Sessizce yut — handshake hello zaten emit edildi; caller-id
          // popup gelmez ama diğer realtime feature'lar etkilenmez.
        });
    }

    // emitToSocket helper üzerinden zod parse zorunlu (security A1 fix).
    // Direct `socket.emit` ESLint kuralıyla yasak; tüm publish helper'dan.
    emitToSocket(socket, SystemHelloPayloadSchema, 'system.hello', {
      event_id: randomUUID(),
      tenant_id: tenantId,
      emitted_at: new Date().toISOString(),
      user_id: userId,
      role,
      rooms,
    });

    socket.on('system.ping', (cb) => {
      cb({
        ok: true,
        data: { pong: true, server_time: new Date().toISOString() },
      });
    });

    socket.on('disconnect', () => {
      counters.perUser.set(
        userId,
        Math.max(0, (counters.perUser.get(userId) ?? 1) - 1),
      );
      counters.perTenant.set(
        tenantId,
        Math.max(0, (counters.perTenant.get(tenantId) ?? 1) - 1),
      );
    });
  });
}
