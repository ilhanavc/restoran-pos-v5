import { z } from 'zod';

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  actorUserId: z.string().uuid().nullable(),
  eventType: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const AuditEventTypeSchema = z.enum([
  'auth.login', 'auth.logout', 'auth.refresh',
  'order.created', 'order.cancelled', 'order.paid',
  // ADR-017 — paket servis stage transition (preparing → out_for_delivery → delivered).
  'order.takeaway_stage_changed',
  // Session 53 — PATCH /orders/:id/customer (persisted siparişe müşteri ata/kaldır).
  // dine_in opsiyonel; takeaway için unassign yasak (Migration 028 CHECK constraint).
  // PII yazmıyoruz: payload yalnız order_id + customer_id_before + customer_id_after.
  'order.customer_assigned',
  // ADR-028 — PATCH /orders/:orderId/table (aktif dine_in siparişi boş masaya
  // taşı). 2-segment naming (DB CHECK `^[a-z_]+\.[a-z_]+$`). Payload PII-safe:
  // from/to table UUID'leri + kanonik etiketler (from/to_table_code, ör.
  // "Masa 5"); müşteri/telefon/adres YAZILMAZ.
  'order.table_changed',
  // ADR-029 — POST /orders/:sourceOrderId/merge (Adisyon Birleştir; dolu masanın
  // adisyonunu başka DOLU masaya aktar). 2-segment naming (DB CHECK
  // `^[a-z_]+\.[a-z_]+$`). Payload PII-safe: source/target order + table UUID'leri
  // + kaynak masa etiketi (source_table_code snapshot) + taşınan kalem sayısı +
  // eski/yeni total_cents; müşteri/telefon/adres YAZILMAZ.
  'order.merged',
  // ADR-035 S11 — POST /orders/:orderId/items/:itemId/move (tek kalemi başka
  // masanın adisyonuna taşı). 2-segment naming (DB CHECK `^[a-z_]+\.[a-z_]+$`)
  // → migration YOK. Kaynak adisyon boşalıp `merged` olsa bile AYRI bir
  // `order.merged` YAZILMAZ: tek olay + payload'daki `source_closed` bayrağı
  // (iki olay aynı işlemi iki kez saydırırdı). Payload PII-safe: UUID'ler +
  // kanonik masa etiketleri + adet/tutar; müşteri/telefon/adres YAZILMAZ.
  'order_item.moved',
  // ADR-013 Amendment 5 K6 — POST /orders/:id/items (add-items) batch'inde en
  // az bir kalem birim-fiyat override taşıyorsa yazılır (K4 sınırsız yetkinin
  // tek kontrolü audit). Override YOKSA bu event YAZILMAZ (add-items bugüne
  // kadar hiç audit üretmiyordu — davranış korunur, cerrahi). 2-segment
  // naming (`order_item.*` — `order_item.status_changed`/`.comped` precedent'i).
  'order_item.created',
  // ADR-020 K3 (Sprint 12 PR-2) — KDS item status transition. 2-segment naming
  // (DB CHECK `^[a-z_]+\.[a-z_]+$`): namespace `order_item`, verb `status_changed`.
  // Payload yalnız id'ler + before/after status (sanitize whitelist).
  'order_item.status_changed',
  // ADR-024 K2 (Session 70) — ikram (comp) toggle + kalem void audit. ADR-003
  // §10.5/§12.6 MVP zorunluluğu kapatılır. Item-level naming (`order_item.*`)
  // `order_item.status_changed` precedent'i + 2-segment DB CHECK ile uyumlu.
  // Payload PII-safe: UUID + integer + boolean/enum literal (comp_reason kolonu
  // YOK, v5.1). amount_cents = ikram/iptal edilen item.total_cents (parasal kanıt).
  'order_item.comped', 'order_item.voided',
  // ADR-013 Amendment 3 K5 — kalem detay ekranı (adet · porsiyon · SATIR-İÇİ
  // BİRİM FİYAT) değişimi. Bu audit ZORUNLUDUR: Amd3 K3 fiyat değiştirmeyi
  // garson dahil herkese açtı ve K4 üst sınır koymadı; kabul gerekçesi
  // "tek kontrol audit'tir" idi. Payload PII-safe (UUID + integer):
  // before/after çiftleri parasal sapmanın tek izidir.
  'order_item.updated',
  // ADR-033 K6 — ödeme void + masa/adisyon reopen. 2-segment naming (DB CHECK
  // `^[a-z_]+\.[a-z_]+$`). `payment.voided` her void'de; `order.reopened` yalnız
  // paid→open auto-reopen gerçekleşince. Payload PII-safe (UUID + enum + integer);
  // `payment.refunded` v5.1 cross-day refund'a REZERVE — DOKUNULMAZ (ADR-024 K4).
  'payment.created', 'payment.refunded', 'payment.voided',
  'order.reopened',
  'user.created', 'user.updated', 'user.deleted',
  // ADR-003 §8.6 product lifecycle (Görev 18)
  'product.created', 'product.updated', 'product.deleted',
  // Sprint 4 Görev 19 — table lifecycle (admin CRUD)
  'table.created', 'table.updated', 'table.deleted',
  // Sprint 5 Görev 23 — table-area assignment (PATCH /tables/:id/area).
  // Ayrı event type: bölge ataması update'inden ayrıştırılır (raporlama:
  // hangi masa hangi bölgeye ne zaman atandı log'lanır).
  'table.area_assigned',
  // Sprint 4 Görev 20 — menu category lifecycle (admin PATCH/DELETE).
  // Underscore (`menu_category`) — DB CHECK `^[a-z_]+\.[a-z_]+$` 2 segment
  // (entity.action) gerektiriyor; 3-part `menu.category.*` constraint'i ihlal
  // ederdi (000_init.sql L361).
  'menu_category.updated', 'menu_category.deleted', 'menu_category.products_reordered',
  // Session 85 — kategori bulk-reorder (ADR-010 §11.6 amendment). 2-segment
  // (entity.action) DB CHECK'i karşılar; ürün-reorder audit paritesi.
  'menu_category.reordered',
  // Sprint 5 Görev 23 — area lifecycle (admin CRUD, ADR-009 Karar 4).
  // DELETE `tables_unlinked_count` cascade NULL sayısını yazar (ADR-009 Domain
  // service Karar 5).
  'area.created', 'area.updated', 'area.deleted',
  // Sprint 8c PR-C — POST /areas/:id/sync-tables (ADR-009 Amendment 2026-04-30).
  // 2-segment naming gerek (DB CHECK `^[a-z_]+\.[a-z_]+$`); `area_tables` namespace
  // altında added/removed event'leri sync sonucunu yazar.
  'area_tables.added', 'area_tables.removed',
  // Sprint 6 Görev 24 + ADR-015 — tenant settings PATCH (admin only). MVP scope:
  // sadece `timezone`. `changed_fields` payload'a hangi alanların değiştiği
  // yazılır; before/after değerler de yazılır (sayısal/string, PII değil).
  // Migration 026 cutoff_hour DROP ile birlikte cutoff_hour_* alanları çıkarıldı.
  'tenant_settings.updated',
  // ADR-015 Karar 10 — Migration 026 forensic snapshot.
  'tenant_settings.cutoff_deprecated',
  // ADR-016 §11 (Caller ID) — müşteri yönetimi lifecycle (PR-8b'de yazıcı, burada whitelist hazır).
  'customer.created', 'customer.updated', 'customer.deleted',
  'customer.blacklisted', 'customer.unblacklisted',
  // PR-8c-3 — Excel toplu içe/dışa aktarma. DB CHECK `^[a-z_]+\.[a-z_]+$`
  // gereği 2 segment; namespace `customer_import` / `customer_export`.
  'customer_import.completed',
  'customer_export.completed',
  // PR-8c-3d — toplu hard delete (admin only). Tek log entry, ids sayımı.
  'customer.bulk_deleted',
  // ADR-038 + ADR-039 S1=(c) — `GET /customers/:id/orders` OKUMA denetimi.
  // Bu uç `waiter` dahil herkese herhangi bir müşterinin sipariş geçmişini
  // (harcama tutarları dahil) açar; KVKK m.12 hesap verebilirliği "kim, ne
  // zaman, KİMİN geçmişine baktı" izini zorunlu kılar. Okuma ucu olduğu için
  // istisnaen mutasyonsuz audit yazar.
  // Ad `customer.history.viewed` DEĞİL: `audit_logs.event_type` DB CHECK'i
  // `^[a-z_]+\.[a-z_]+$` (2 segment) — 3 segment INSERT'te patlardı.
  // `customer.bulk_deleted` emsali (entity `customer`, alt-çizgili fiil).
  // Payload PII-safe: yalnız UUID + sayım + boolean.
  'customer.history_viewed',
  // ADR-039 (security-review MAJOR) — müşteri İLETİŞİM BİLGİSİ mutasyonları.
  //
  // Bu uçlar bugüne kadar HİÇ denetlenmiyordu: bir telefon ya da adres
  // eklenip silindiğinde `audit_logs`'ta tek satır oluşmuyordu. Açık ADR-039
  // öncesinde de vardı, ama o zaman yalnız admin+cashier erişebiliyordu;
  // S1=(c) ile erişen rol kümesi `waiter`'ı da kapsayınca etki alanı büyüdü
  // ve KVKK m.12 hesap verebilirliği ("bu numarayı kim sildi?") karşılıksız
  // kaldı. `customer.updated`'a sıkıştırılmadı: ekleme ile SİLME aynı olay
  // tipinde toplanırsa denetim izinde ikisi ayırt edilemez.
  //
  // Adlandırma `customer.bulk_deleted`/`customer.history_viewed` emsali:
  // entity `customer`, alt-çizgili fiil → DB CHECK `^[a-z_]+\.[a-z_]+$`
  // (2 segment) sağlanır, MIGRATION GEREKMEZ.
  //
  // Payload PII-safe: yalnız UUID + boolean + sayım. Numaranın/adresin
  // KENDİSİ asla yazılmaz (DENY_LIST `phone`/`address`/`raw_phone` zaten
  // yakalar); "hangi kayıt" sorusunun cevabı `phone_id`/`address_id`'dir.
  'customer.phone_added',
  'customer.phone_removed',
  'customer.address_added',
  'customer.address_updated',
  'customer.address_removed',
  // Sprint 8c PR-F1 — attribute groups & options lifecycle (ADR-012).
  // 2-segment naming (DB CHECK `^[a-z_]+\.[a-z_]+$`).
  'attribute_group.created',
  'attribute_group.updated',
  'attribute_group.deleted',
  'attribute_option.created',
  'attribute_option.updated',
  'attribute_option.deleted',
  // Category ↔ Group ve Product ↔ Group link event'leri (link tablosu hard
  // delete; assigned/unassigned ayrı event'ler raporlama için).
  'category_attributes.assigned',
  'category_attributes.unassigned',
  'product_attributes.assigned',
  'product_attributes.unassigned',
  // ADR-021 (Sprint 14 PR-4b1) — CSV export. PII'siz KPI rapor download'ları
  // forensic için audit'e yazılır. Payload: report_name + query_string + row_count
  // + filename (PII deny-list'e takılmaz). 2-segment naming (DB CHECK).
  'reports.csv_export',
  'audit.purge',
  // ADR-032 Amd2 K11 — yazıcı yönetim ekranı denetim izi. 2-segment naming
  // (DB CHECK `^[a-z_]+\.[a-z_]+$`). PII yok: display_name = istasyon etiketi
  // (equipment label, müşteri verisi değil); category id'leri UUID (PII değil).
  //   printer.updated            → istasyon etiketi (display_name) değişimi.
  //   printer.categories_assigned → istasyon atama diff'i (eski→yeni istasyon
  //                                  + taşınan kategori UUID'leri).
  'printer.updated',
  'printer.categories_assigned',
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * ADR-037 — Denetim Günlüğü okuma sözleşmesi (GET /audit-logs).
 * Salt-okuma; yazma yolu (writeAudit + ALLOWED_KEYS) DEĞİŞMEZ (K10).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * ADR-037 K2/K3 — liste sorgusu.
 *
 * **Cursor formatı (opak):** `base64url("<createdAt ISO 8601>|<uuid>")`.
 * İstemci ASLA ayrıştırmaz; sunucu çözemezse 400 `INVALID_CURSOR` döner
 * (sessizce başa sarma yok — kullanıcı yanlış sayfayı okuduğunu fark etmeli).
 *
 * `entityType` + `entityId` **birlikte** zorunludur: `tenant_entity_idx`
 * index'inin leading kolonu `entity_type`'tır, yalnız `entityId` ile sorgu
 * index'i süremez (K3).
 *
 * `?format=csv` yolunda `cursor`/`limit` **yok sayılır** (K11.3) — şema
 * değişmez, tek doğrulama noktası korunur (K11.2 filtre pariteliği).
 */
const AuditLogListQueryObject = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  eventType: z
    .union([AuditEventTypeSchema, z.array(AuditEventTypeSchema)])
    .optional(),
  entityType: z
    .string()
    .regex(/^[a-z_]+$/)
    .max(32)
    .optional(),
  entityId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Şemanın tanıdığı query anahtarları — **tek kaynak**.
 *
 * Güvenlik amaçlı allow-list'lerin (ör. `audit_logs.payload.query_string`'e
 * yalnız bilinen parametrelerin yazılması) elle ikinci bir liste tutmasını
 * önler: alan eklendiğinde burası kendiliğinden güncellenir.
 * `.refine()` sonrası şemanın iç yapısına erişmek zod sürümüne bağımlı
 * olduğundan anahtarlar refine'dan ÖNCE, obje şemasından türetilir.
 */
export const AUDIT_LOG_QUERY_KEYS: readonly string[] = Object.keys(
  AuditLogListQueryObject.shape,
);

export const AuditLogListQuerySchema = AuditLogListQueryObject.refine(
  (q) => !(q.entityId && !q.entityType),
  { message: 'ENTITY_TYPE_REQUIRED' },
).refine((q) => !(q.from && q.to) || q.from <= q.to, {
  message: 'INVALID_DATE_RANGE',
});
export type AuditLogListQuery = z.infer<typeof AuditLogListQuerySchema>;

/**
 * ADR-037 K6 — eylemi yapan kişi.
 *
 * `displayName` `users` JOIN'inden gelir. Kullanıcı hard-delete edilmişse
 * `audit_logs.actor` JSONB snapshot'ında ad **yoktur** (writeAudit yalnız
 * `user_agent` yazar) → `null` döner ve UI `audit.actor.unknown` basar.
 * Personel adı/rolü PII deny-list kapsamında değildir; denetimin asıl amacıdır.
 */
export const AuditLogActorSchema = z.object({
  userId: z.string().uuid().nullable(),
  displayName: z.string().nullable(),
  role: z.string().nullable(),
});
export type AuditLogActor = z.infer<typeof AuditLogActorSchema>;

/**
 * ADR-037 K1/K6 — liste satırı; `payload` **tam** taşınır (ayrı detay
 * endpoint'i YOK).
 *
 * `eventType` bilinçli olarak `z.string()`, `AuditEventTypeSchema` DEĞİL:
 * enum ileride bir değeri kaldırırsa geçmiş kayıt okunamaz hale gelmemelidir.
 * Denetim günlüğü geriye dönük her zaman okunabilir kalır.
 */
export const AuditLogListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  eventType: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().uuid().nullable(),
  actor: AuditLogActorSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type AuditLogListItem = z.infer<typeof AuditLogListItemSchema>;

/** ADR-037 K6 — `{ data: { ... } }` düz zarf (customers deseni). */
export const AuditLogListResponseSchema = z.object({
  data: z.object({
    logs: z.array(AuditLogListItemSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
});
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;

/** Endpoint'in `data` gövdesi (route + CSV handler ortak dönüş tipi). */
export interface AuditLogListPage {
  logs: AuditLogListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}
