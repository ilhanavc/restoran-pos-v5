import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@restoran-pos/shared-types';
import {
  attachConnectionHandlers,
  createHandshakeMiddleware,
  type CallerStationLookup,
  type PendingCallReplay,
  type ConnectionCounters,
} from './handshake.js';

export interface RealtimeServerDeps {
  httpServer: HttpServer;
  accessSecret: string;
  webOrigin: string;
  /** ADR-010 §9 default 5. */
  perUserLimit?: number;
  /** ADR-010 §9 default 50. */
  perTenantLimit?: number;
  /**
   * ADR-016 §11 — caller-station room auto-join lookup.
   * `tenantId` → `caller_id_station_user_id` (null = atanmamış).
   */
  callerStationLookup?: CallerStationLookup;
  /**
   * ADR-016 §11 (S104) — istasyon yeniden bağlanınca son cevapsız çağrının
   * telafi emit'i (fire-and-forget emit kaybı için). null = telafi yok.
   */
  pendingCallReplay?: PendingCallReplay;
}

export interface RealtimeServer {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  counters: ConnectionCounters;
  shutdown: () => Promise<void>;
}

/**
 * Realtime Socket.IO server bootstrap (ADR-010 §2 + §7 + §10).
 *
 * - WebSocket + polling fallback (Socket.IO default, §2)
 * - Default heartbeat 25s/20s (§7)
 * - CORS: `webOrigin` (REST tarafı ile aynı, §10)
 * - `/realtime` namespace + JWT auth handshake middleware (§4.1 + §3)
 * - 3 oda join + `system.hello` greeting (§4.2 + §11)
 */
export function createRealtimeServer(
  deps: RealtimeServerDeps,
): RealtimeServer {
  const counters: ConnectionCounters = {
    perUser: new Map(),
    perTenant: new Map(),
  };

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    deps.httpServer,
    {
      cors: {
        origin: deps.webOrigin,
        credentials: true,
      },
    },
  );

  const middleware = createHandshakeMiddleware({
    accessSecret: deps.accessSecret,
    perUserLimit: deps.perUserLimit ?? 5,
    perTenantLimit: deps.perTenantLimit ?? 50,
    counters,
  });

  io.of('/realtime').use(middleware);
  attachConnectionHandlers(io, counters, {
    ...(deps.callerStationLookup !== undefined
      ? { callerStationLookup: deps.callerStationLookup }
      : {}),
    ...(deps.pendingCallReplay !== undefined
      ? { pendingCallReplay: deps.pendingCallReplay }
      : {}),
  });

  return {
    io,
    counters,
    shutdown: async () => {
      await io.close();
    },
  };
}
