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
  // ADR-002 §10 user lifecycle audit. PII (email, name) DENY_LIST üzerinden bloklu;
  // burada sadece yapısal alanlar — role değişimi, hangi alanların değiştiği (key list,
  // değer DEĞİL), self-action flag, target user id. `email`/`name` whitelist'e EKLENMEZ
  // — DENY_LIST'te kayıtlı, sanitize() throw eder.
  'user.created': ['target_user_id', 'role'],
  'user.updated': ['target_user_id', 'changed_fields', 'role_before', 'role_after'],
  'user.deleted': ['target_user_id', 'revoked_token_count', 'soft_delete'],
};
