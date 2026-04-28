import type { RealtimeAck } from '@restoran-pos/shared-types';

/**
 * Handshake reject payload yapısı (ADR-010 §6.1).
 *
 * Socket.IO `next(new Error())` üzerinden gönderilir; client `connect_error`
 * event'iyle alır. ADR-006 §2 envelope'ıyla uyumlu (`code` + `message_key`).
 */
export interface ConnectErrorPayload {
  code: string;
  message_key: string;
}

export class RealtimeConnectError extends Error {
  public readonly data: ConnectErrorPayload;
  constructor(code: string, message_key: string) {
    super(message_key);
    this.name = 'RealtimeConnectError';
    this.data = { code, message_key };
  }
}

export const REALTIME_ERROR_CODES = {
  AUTH_TOKEN_MISSING: 'error.realtime.auth.tokenMissing',
  AUTH_TOKEN_INVALID: 'error.realtime.auth.tokenInvalid',
  AUTH_TENANT_MISMATCH: 'error.realtime.auth.tenantMismatch',
  AUTH_FORBIDDEN: 'error.realtime.auth.forbidden',
  CONN_LIMIT_USER: 'error.realtime.connection.userLimit',
  CONN_LIMIT_TENANT: 'error.realtime.connection.tenantLimit',
} as const;

export type { RealtimeAck };
