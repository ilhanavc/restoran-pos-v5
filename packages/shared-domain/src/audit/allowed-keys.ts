import type { AuditEventType } from '@restoran-pos/shared-types';

export const ALLOWED_KEYS: Record<AuditEventType, ReadonlyArray<string>> = {
  'auth.login': ['success', 'reason_code', 'ip_hash'],
  'auth.logout': ['session_id'],
  'auth.refresh': ['rotated'],
  'audit.purge': ['task', 'deleted_count', 'cutoff_date'],
  // domain event'leri — Sprint 1'de eklenecek, şimdilik boş whitelist (tüm keys drop)
  'order.created': [],
  'order.cancelled': [],
  'order.paid': [],
  'payment.created': [],
  'payment.refunded': [],
  'user.created': [],
  'user.updated': [],
  'user.deleted': [],
};
