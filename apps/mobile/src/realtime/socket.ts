import { io, type Socket } from 'socket.io-client';

import { SOCKET_BASE_URL } from '../config';

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
 * ADR-026 Amendment 2 K1 — socket durum aboneliği (Masalar header göstergesi).
 * Event-tabanlı, poll yok: 'connect' → connected · 'disconnect' → disconnected
 * · manager 'reconnect_attempt' / connect çağrısı → connecting. UI tarafı
 * `useSocketStatus` (useSyncExternalStore) ile okur.
 */
export type SocketStatus = 'connected' | 'connecting' | 'disconnected';

let socketStatus: SocketStatus = 'disconnected';
const statusListeners = new Set<() => void>();

function setSocketStatus(next: SocketStatus): void {
  if (socketStatus === next) return;
  socketStatus = next;
  statusListeners.forEach((listener) => listener());
}

export function getSocketStatus(): SocketStatus {
  return socketStatus;
}

export function subscribeSocketStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/**
 * Connect (or, if already created, re-arm with the latest token and reconnect).
 * Reusing the instance keeps a single connection across silent token rotations.
 */
export function connectSocket(accessToken: string): Socket {
  if (socket !== null) {
    socket.auth = { token: accessToken };
    if (!socket.connected) {
      setSocketStatus('connecting');
      socket.connect();
    }
    return socket;
  }
  setSocketStatus('connecting');
  socket = io(`${SOCKET_BASE_URL}/realtime`, {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
  });
  socket.on('connect', () => setSocketStatus('connected'));
  socket.on('disconnect', () => setSocketStatus('disconnected'));
  socket.io.on('reconnect_attempt', () => setSocketStatus('connecting'));
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  setSocketStatus('disconnected');
}
