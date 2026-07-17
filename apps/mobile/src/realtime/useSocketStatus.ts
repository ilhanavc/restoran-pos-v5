import { useSyncExternalStore } from 'react';

import {
  getSocketStatus,
  subscribeSocketStatus,
  type SocketStatus,
} from './socket';

/**
 * ADR-026 Amendment 2 K1 — Masalar header'ındaki kalıcı bağlantı-durumu
 * noktası için canlı socket durumu. Event-tabanlı abonelik (poll yok);
 * singleton socket'in connect/disconnect/reconnect geçişlerini yansıtır.
 */
export function useSocketStatus(): SocketStatus {
  return useSyncExternalStore(subscribeSocketStatus, getSocketStatus);
}
