import type { AuditEventType } from '@restoran-pos/shared-types';

export type { AuditEventType };

export interface AllowedPayload_auth_login {
  success: boolean;
  reason_code?: string;
  ip_hash?: string;
}
export interface AllowedPayload_auth_logout {
  session_id?: string;
}
export interface AllowedPayload_auth_refresh {
  rotated: boolean;
}
export interface AllowedPayload_audit_purge {
  table: string;
  deleted_count: number;
  batch_count: number;
  duration_ms: number;
  cutoff_date: string;
}

export type AllowedPayload<T extends AuditEventType> =
  T extends 'auth.login' ? AllowedPayload_auth_login :
  T extends 'auth.logout' ? AllowedPayload_auth_logout :
  T extends 'auth.refresh' ? AllowedPayload_auth_refresh :
  T extends 'audit.purge' ? AllowedPayload_audit_purge :
  Record<string, unknown>;
