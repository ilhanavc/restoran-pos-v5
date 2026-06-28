import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';
import { env } from './env';

/**
 * Socket.IO singleton — ADR-010 §11.3 + ADR-011 §4.
 * Direct `socket.emit` outside this module is forbidden; use `useSocketEvent`
 * for subscriptions and (future) `emitWithAck` helper for mutations.
 */
let socket: Socket | null = null;

export function connectSocket(accessToken: string): Socket {
  if (socket?.connected) return socket;
  socket = io(`${env.VITE_SOCKET_URL}/realtime`, {
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

/**
 * Declarative socket event subscription.
 * Re-binds when `event` changes; handler captured via ref to avoid stale closures.
 */
export function useSocketEvent<TPayload = unknown>(
  event: string,
  handler: (payload: TPayload) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const cb = (payload: TPayload): void => handlerRef.current(payload);
    s.on(event, cb);
    return () => {
      s.off(event, cb);
    };
  }, [event]);
}

/**
 * Canlı Socket.IO bağlantı durumu. `connect`/`disconnect` event'lerini izler;
 * ekranlar "bağlantı kesik mi" göstergesi için kullanır (ADR-010, Session 70
 * KDS bağlantı göstergesi). Başlangıç değeri mevcut `socket.connected` —
 * yoksa `true` (mount anında yanlış "kesik" alarmı vermemek için; gerçekten
 * kesikse `disconnect` event'i düzeltir).
 */
export function useConnectionStatus(): { connected: boolean } {
  const [connected, setConnected] = useState<boolean>(
    () => getSocket()?.connected ?? true,
  );
  useSocketEvent('connect', () => {
    setConnected(true);
  });
  useSocketEvent('disconnect', () => {
    setConnected(false);
  });
  return { connected };
}
