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
  // ADR-014 Amd1 K4 — auto: son-canlı-kalem iptalinde otomatik sipariş iptali
  // işareti (boolean); trigger_item_id: tetikleyen kalem UUID'si. PII değil.
  // `reason`: ADR-027 Amd2 K12 — iptal sebebi ENUM kodu (customer_left |
  // wrong_table | wrong_order | test_entry | other). Serbest metin YOK →
  // PII riski yok. Otomatik iptal (auto:true) yolunda null.
  'order.cancelled': ['order_id', 'auto', 'trigger_item_id', 'reason'],
  'order.paid': ['order_id', 'payment_type', 'amount_cents'],
  // Session 53 — müşteri ata/kaldır. UUID (PII değil); ad/telefon yazılmaz.
  'order.customer_assigned': ['order_id', 'customer_id_before', 'customer_id_after'],
  // ADR-028 — masayı değiştir. UUID + kanonik masa etiketi (ör. "Masa 5");
  // müşteri/telefon/adres PII YAZILMAZ. from/to = kaynak/hedef masa.
  'order.table_changed': [
    'from_table_id',
    'to_table_id',
    'from_table_code',
    'to_table_code',
  ],
  // ADR-029 — adisyon birleştir. UUID + kaynak masa etiketi (source_table_code,
  // ör. "Masa 5") + integer sayaç/tutarlar; müşteri/telefon/adres PII YAZILMAZ.
  // source/target = kaynak (absorbe edilen) / hedef (hayatta kalan) sipariş+masa.
  'order.merged': [
    'source_order_id',
    'target_order_id',
    'source_table_id',
    'target_table_id',
    'source_table_code',
    'moved_item_count',
    'old_total_cents',
    'new_total_cents',
  ],
  // ADR-020 K3 (Sprint 12 PR-2) — KDS item status transition. PII yok; UUID +
  // enum literal (status_before/after). `product_id` forensic için (raporlama:
  // hangi ürün hazırlık aşamasında ne kadar zaman geçirdi).
  'order_item.status_changed': [
    'order_id',
    'order_item_id',
    'product_id',
    'status_before',
    'status_after',
  ],
  // ADR-024 K2 (Session 70) — ikram (comp) toggle. PII yok; UUID + boolean +
  // integer literal. `product_id` forensic için (hangi ürün ne kadar ikram
  // edildi). `amount_cents` = is_comped değiştiği item'ın total_cents'i (parasal
  // etki kanıtı). comp_reason kolonu YOK (v5.1 forward-ref) → yazılmaz.
  'order_item.comped': [
    'order_id',
    'order_item_id',
    'product_id',
    'is_comped_before',
    'is_comped_after',
    'amount_cents',
  ],
  // ADR-024 K2 — kalem void (status='cancelled'). PII yok; UUID + enum + integer.
  // `amount_cents` = iptal edilen item'ın total_cents'i.
  'order_item.voided': [
    'order_id',
    'order_item_id',
    'product_id',
    'status_before',
    'amount_cents',
  ],
  // ADR-013 Amd3 K5 — kalem detay değişimi (adet/porsiyon/birim fiyat).
  // Yalnız GERÇEKTEN değişen alanlar yazılır; before/after çiftleri parasal
  // sapmanın denetim izidir (K3 herkese açık + K4 sınırsız → tek kontrol bu).
  'order_item.updated': [
    'order_id',
    'order_item_id',
    'product_id',
    'quantity_before',
    'quantity_after',
    'unit_price_cents_before',
    'unit_price_cents_after',
    'variant_id_before',
    'variant_id_after',
    'total_cents_before',
    'total_cents_after',
  ],
  // ADR-024 K2 — payment.created whitelist DOLDURULDU (boştu → tüm payload
  // düşüyordu). PII yok; UUID + enum + integer + boolean. `operation` parasal
  // niyet (pay/pay_and_close), `order_closed` close transition gerçekleşti mi.
  'payment.created': [
    'order_id',
    'payment_id',
    'payment_type',
    'payment_scope',
    'amount_cents',
    'operation',
    'order_closed',
  ],
  // ADR-024 K4 — refund endpoint yok (ADR-014 kapsam dışı). v5.1 refund ADR'sinde
  // doldurulur. BOŞ kalır → refund yazılsa bile tüm payload düşer (yazan yol yok).
  'payment.refunded': [],
  // ADR-033 K6 — ödeme void. PII yok; UUID + enum + integer + boolean.
  // `void_reason_code` zorunlu enum (serbest metin YOK); `order_reopened` bu
  // void'in masayı yeniden açıp açmadığı (paid→open). amount_cents = void'lenen
  // ödeme tutarı (parasal reversal kanıtı).
  'payment.voided': [
    'order_id',
    'payment_id',
    'payment_type',
    'amount_cents',
    'void_reason_code',
    'order_reopened',
  ],
  // ADR-033 K6 — masa/adisyon reopen (paid→open, void'in sonucu). UUID + kanonik
  // masa etiketi (table_code, ör. "Masa 5") + enum + integer. Müşteri/telefon/
  // adres PII YAZILMAZ (order.table_changed/merged paritesi). previous_status
  // her zaman 'paid' (yalnız paid order reopen olur); payable_cents = order.total_cents.
  'order.reopened': [
    'order_id',
    'table_id',
    'table_code',
    'previous_status',
    'payable_cents',
  ],
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
  // Session 53b (ADR-003 + ADR-009 Amendment 2026-05-05) — tables artık hard
  // delete; `soft_delete` payload alanı çıkarıldı. Eski audit_logs satırları
  // payload'larını korur (sanitize geriye dönük uyumlu).
  'table.deleted': ['table_id'],
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
  // Session 85 — kategori bulk-reorder: top-level, yalnız sayım (category_id yok).
  'menu_category.reordered': ['count'],
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
  // Session 53b (ADR-003 + ADR-009 Amendment 2026-05-05) — areas artık hard
  // delete; `soft_delete` payload alanı çıkarıldı. `tables_unlinked_count`
  // Domain service Karar 5 cascade NULL sayısı KORUNUR.
  'area.deleted': ['area_id', 'tables_unlinked_count'],
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
  // ADR-021 (Sprint 14 PR-4b1) — CSV export. report_name kebab-case rapor adı,
  // query_string serialize edilmiş raw query (PII içermez — sadece range/limit/role/
  // format vb.); row_count satır sayısı (operator forensic), filename indirilen dosya
  // adı (slug + tarih, PII değil). PII deny-list (phone/email/address vb.) sanitize
  // tarafında throw eder; query_string içine düşmüş bir PII (çağrı sahibi yanlışlıkla
  // ?phone=... gönderirse) deny-list'te değil ama serialize edilmiş tek string olarak
  // tutulur — operator gözden geçirebilir. ADR-021 v2'de daha sıkı validation gerekir.
  'reports.csv_export': ['report_name', 'query_string', 'row_count', 'filename'],
  // ADR-032 Amd2 K11 — yazıcı istasyon etiketi (display_name) değişimi. PII yok:
  // display_name = equipment label ("Fırın"/"Izgara"/"Kasa"), müşteri verisi
  // değil (deny-list exact-match'e takılmaz). before/after değer + changed_fields
  // key list. Ham API anahtarı bu payload'a ASLA girmez (K11).
  'printer.updated': [
    'printer_id',
    'changed_fields',
    'display_name_before',
    'display_name_after',
  ],
  // ADR-032 Amd2 K3/K11 — istasyon atama diff'i. PII yok: station_kind enum
  // (kitchen|grill), category id'leri UUID (PII değil). added = bu istasyona
  // alınan; removed = taban istasyona (NULL) dönen. count'lar UI onay özeti için.
  'printer.categories_assigned': [
    'printer_id',
    'station_kind',
    'added_category_ids',
    'removed_category_ids',
    'added_count',
    'removed_count',
  ],
};
