import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';
import { env } from './env';

/**
 * Socket.IO singleton — ADR-010 §11.3 + ADR-011 §4.
 * Direct `socket.emit` outside this module is forbidden; use `useSocketEvent`
 * for subscriptions and (future) `emitWithAck` helper for mutations.
 */
let socket: Socket | null = null;

/**
 * Caller ID canlı bulgu (2026-09-02) — Masalar ekranı saatlerce açık+odakta
 * ama etkileşimsiz kalınca (sipariş gelmiyor, sekme değişmiyor) soket
 * `reconnectionAttempts: Infinity`e rağmen sessizce ölü kalabiliyor: uzun
 * boşta kalan sekmelerde tarayıcı zamanlayıcıları (`setTimeout`/`setInterval`,
 * socket.io'nun kendi ping/pong'u dahil) yavaşlatılabiliyor, bağlantı
 * koptuğunda `disconnect` event'i hiç ateşlenmiyor veya çok geç ateşleniyor.
 * Sayfa yenilemek (kullanıcının önerisi) çalışırdı ama kasiyerin yarım kalmış
 * bir işlemini kaybettirme riski taşırdı. Bunun yerine: periyodik + sekme-
 * görünürlük tetiklemeli bir "sağlık kontrolü" — `socket.connected` yanlışsa
 * `connect()` çağrılır (zaten bağlıyken/denerken çağırmak zararsız, socket.io
 * no-op'tur). Backend zaten reconnect anında son 5dk'lık cevapsız aramayı
 * tekrar yayınlıyor (`pending-caller-replay.ts`) — sayfa yenilemeye gerek
 * kalmadan aynı telafiyi sağlar.
 */
const WATCHDOG_INTERVAL_MS = 2 * 60 * 1000;
let watchdogStarted = false;

function ensureConnectionWatchdog(): void {
  if (watchdogStarted) return;
  watchdogStarted = true;

  const reconnectIfStale = (): void => {
    if (socket !== null && !socket.connected) {
      socket.connect();
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectIfStale();
  });
  setInterval(reconnectIfStale, WATCHDOG_INTERVAL_MS);
}

export function connectSocket(accessToken: string): Socket {
  ensureConnectionWatchdog();
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

function getSocket(): Socket | null {
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
