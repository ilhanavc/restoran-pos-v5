import { io, type Socket } from 'socket.io-client';

import { API_BASE_URL } from '../config';

/**
 * Socket.IO singleton (ADR-010 §11.6 + ADR-026 Amendment 2026-06-29 PR-5d D).
 *
 * One connection to the `/realtime` namespace for the app's lifetime, authed by
 * the access token in the handshake (`auth.token`) — same contract as the web
 * client (apps/web/src/lib/socket.ts). The realtime bridge (App.tsx) subscribes
 * to `orders.*` and invalidates the tables board so a teammate's change (or this
 * waiter's own save) refreshes the live masa cards. `socket.io-client` is pure
 * JS over RN's WebSocket — no native module, Expo Go compatible.
 */
let socket: Socket | null = null;

/**
 * Connect (or, if already created, re-arm with the latest token and reconnect).
 * Reusing the instance keeps a single connection across silent token rotations.
 */
export function connectSocket(accessToken: string): Socket {
  if (socket !== null) {
    socket.auth = { token: accessToken };
    if (!socket.connected) {
      socket.connect();
    }
    return socket;
  }
  socket = io(`${API_BASE_URL}/realtime`, {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}
