import type { AuditEventType } from '@restoran-pos/shared-types';

export const ALLOWED_KEYS: Record<AuditEventType, ReadonlyArray<string>> = {
  'auth.login': ['success', 'reason_code', 'ip_hash'],
  'auth.logout': ['session_id'],
  'auth.refresh': ['rotated'],
  // ADR-002 §12.3 / §13.4 — TTL cleanup self-audit. `table` hangi tabloyu
  // sildiğimiz (`audit_logs` | `call_logs`), batch_count toplam batch sayısı,
  // duration_ms task süresi (per-tenant log info'da, self-audit toplamı).
  'audit.purge': [
    'table',
    'deleted_count',
    'batch_count',
    'duration_ms',
    'cutoff_date',
  ],
  // ADR-017 — paket servis sipariş lifecycle. PII yok; sadece id'ler ve yapısal
  // sayılar. customer_id UUID (PII değil); telefon/ad payload'a yazılmaz.
  'order.created': [
    'order_id',
    'type',
    'customer_id',
    'total_cents',
    'item_count',
    'planned_payment_type',
  ],
  'order.takeaway_stage_changed': ['order_id', 'from_stage', 'to_stage'],
  'order.cancelled': ['order_id'],
  'order.paid': ['order_id', 'payment_type', 'amount_cents'],
  // Session 53 — müşteri ata/kaldır. UUID (PII değil); ad/telefon yazılmaz.
  'order.customer_assigned': ['order_id', 'customer_id_before', 'customer_id_after'],
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
    'icon_before',
    'icon_after',
    'color_before',
    'color_after',
  ],
  'menu_category.deleted': ['category_id', 'soft_delete'],
  // Sprint 8c PR-E4 — bulk ürün sıralama. Sadece sayım; productIds payload'a
  // yazılmaz (snapshot kuralı, §7).
  'menu_category.products_reordered': ['category_id', 'count'],
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
  // Sprint 8c PR-C — sync-tables sonucu. Sadece sayım; üretilen kodlar/silinen
  // id'ler payload'a yazılmaz (snapshot kuralı, §7).
  'area_tables.added': ['area_id', 'created'],
  'area_tables.removed': ['area_id', 'removed'],
  // Sprint 5 Görev 23 — table-area assignment (PATCH /tables/:id/area).
  // Sadece id'ler ve before/after; tablo kodu / bölge adı yazılmaz.
  'table.area_assigned': ['table_id', 'area_id_before', 'area_id_after'],
  // Sprint 6 Görev 24 + ADR-015 — tenant settings PATCH (admin only). MVP scope:
  // sadece `timezone`. `changed_fields` hangi alanların değiştiğini, before/after
  // da değer geçişini taşır. PII yok; tenant.name read-only.
  // Migration 026 ile `business_day_cutoff_hour_*` çıkarıldı.
  'tenant_settings.updated': [
    'tenant_id',
    'changed_fields',
    'timezone_before',
    'timezone_after',
    // ADR-016 §11 — Caller ID istasyon ataması ve bypass pattern listesi.
    // Pattern listesi serbest metin (regex) ama PII değil; before/after sayım için
    // count olarak yazılır (regex string'leri sanitize edilir).
    'caller_id_station_user_id_before',
    'caller_id_station_user_id_after',
    'caller_id_bypass_patterns_count_before',
    'caller_id_bypass_patterns_count_after',
  ],
  // ADR-015 Karar 10 — cutoff_hour DROP migration'ı öncesinde forensic snapshot.
  'tenant_settings.cutoff_deprecated': [
    'tenant_id',
    'business_day_cutoff_hour',
    'reason',
  ],
  // Sprint 8c PR-F1 — attribute groups & options (ADR-012). Yapısal alanlar;
  // serbest metin (name) created event'inde id ile birlikte saklanıyor (PII
  // değil, snapshot kuralı § ile uyumlu — name domain-public). updated event'i
  // sadece changes envelope'ı taşır (key list, before/after pair'leri).
  'attribute_group.created': [
    'groupId',
    'name',
    'selectionType',
    'isRequired',
    'sortOrder',
  ],
  'attribute_group.updated': ['groupId', 'changes'],
  'attribute_group.deleted': [
    'groupId',
    'optionsCascadeCount',
    'categoryLinksRemoved',
    'productLinksRemoved',
  ],
  'attribute_option.created': [
    'groupId',
    'optionId',
    'name',
    'extraPriceCents',
    'isDefault',
    'sortOrder',
  ],
  'attribute_option.updated': ['groupId', 'optionId', 'changes'],
  'attribute_option.deleted': ['groupId', 'optionId'],
  // Link event'leri sadece id'ler + sort_order; serbest metin yok.
  'category_attributes.assigned': ['categoryId', 'groupId', 'sortOrder'],
  'category_attributes.unassigned': ['categoryId', 'groupId'],
  'product_attributes.assigned': ['productId', 'groupId', 'sortOrder'],
  'product_attributes.unassigned': ['productId', 'groupId'],
  // ADR-016 §11 — müşteri lifecycle. PII (full_name, telefon, adres) DENY_LIST
  // ile bloklu; payload sadece id'ler + yapısal sayılar + changed_fields key list.
  'customer.created': ['customer_id', 'phones_count', 'addresses_count'],
  'customer.updated': ['customer_id', 'changed_fields', 'phones_count', 'addresses_count'],
  'customer.deleted': ['customer_id', 'soft_delete'],
  'customer.blacklisted': ['customer_id', 'reason_length'],
  'customer.unblacklisted': ['customer_id'],
  'customer_import.completed': ['total_rows', 'created', 'errors', 'preview_token'],
  'customer_export.completed': ['rows_count', 'format'],
  // PR-8c-3d — toplu hard delete (admin). Tek event, sadece sayım; id'ler PII
  // değil ama snapshot kuralı (§7) gereği uuid listesi audit'e yazılmaz.
  'customer.bulk_deleted': ['ids_count', 'requested_count'],
};
