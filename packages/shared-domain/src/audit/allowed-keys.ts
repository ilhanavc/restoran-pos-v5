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
  // ADR-003 §8.6 product lifecycle (Görev 18). Yapısal alanlar; ürün/varyant
  // adı PII değildir ama snapshot kuralı (§7) gereği serbest metni event payload'a
  // YAZMIYORUZ — sadece id'ler + counters + sanitized field key list.
  'product.created': ['product_id', 'category_id', 'variants_count'],
  'product.updated': ['product_id', 'changed_fields', 'variants_added', 'variants_updated', 'variants_deleted'],
  'product.deleted': ['product_id', 'soft_delete', 'variants_cascade_count'],
  // Sprint 4 Görev 19 — table lifecycle audit. Yapısal alanlar; masa kodu (`code`)
  // PII değil ama snapshot kuralı (§7) gereği serbest metni payload'a yazmıyoruz.
  // Sadece id'ler, değiştirilen alan key listesi ve before/after sayısal değerler.
  'table.created': ['table_id', 'code', 'capacity'],
  'table.updated': ['table_id', 'changed_fields', 'code_before', 'code_after', 'capacity_before', 'capacity_after'],
  'table.deleted': ['table_id', 'soft_delete'],
  // Sprint 4 Görev 20 — menu category lifecycle audit. Yapısal alanlar; kategori
  // adı PII değil ama snapshot kuralı (§7) gereği serbest metni payload'a
  // yazmıyoruz. Sadece id'ler, değiştirilen alan key listesi ve before/after
  // sayısal/string değerler.
  'menu_category.updated': [
    'category_id',
    'changed_fields',
    'name_before',
    'name_after',
    'sort_order_before',
    'sort_order_after',
  ],
  'menu_category.deleted': ['category_id', 'soft_delete'],
  // Sprint 5 Görev 23 — area lifecycle (ADR-009). Yapısal alanlar; bölge adı
  // PII değil ama snapshot kuralı (§7) gereği serbest metni payload'a yazmıyoruz.
  // DELETE: `tables_unlinked_count` Domain service Karar 5 cascade NULL sayısı.
  'area.created': ['area_id', 'name', 'sort_order'],
  'area.updated': [
    'area_id',
    'changed_fields',
    'name_before',
    'name_after',
    'sort_order_before',
    'sort_order_after',
  ],
  'area.deleted': ['area_id', 'soft_delete', 'tables_unlinked_count'],
  // Sprint 5 Görev 23 — table-area assignment (PATCH /tables/:id/area).
  // Sadece id'ler ve before/after; tablo kodu / bölge adı yazılmaz.
  'table.area_assigned': ['table_id', 'area_id_before', 'area_id_after'],
  // Sprint 6 Görev 24 — tenant settings PATCH (ADR-002 §6 amendment).
  // Yapısal alanlar; before/after numeric/string. Kapsam kilidi: yalnız
  // `timezone` + `business_day_cutoff_hour`. v5.1 alanları (fiş header vs.)
  // bu whitelist'e eklenmez (ayrı ADR + ayrı event type).
  'settings.updated': [
    'changed_fields',
    'timezone_before',
    'timezone_after',
    'business_day_cutoff_hour_before',
    'business_day_cutoff_hour_after',
  ],
};
