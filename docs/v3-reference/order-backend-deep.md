# v3 Backend Davranış Spesifikasyonu — Sipariş Alma Akışı (Derin Keşif)

**Kapsam:** v3 (`D:\dev\restoran-pos-v3\server`) sipariş + ödeme + masa + müşteri + print + invariant + migration davranışları.

**Amaç:** v5 mini-sprint PR-3..PR-12 + API/DB tarafı için referans. Kod kopyalama YASAK; bu doküman davranış kurallarını dosya:satır referansıyla özetler.

**Statü:** Session 49+ Explore sub-agent çıktısı (2026-05-02). Stack: Express + better-sqlite3 + Zod + ESM.

---

## 1. Orders Endpoint Matrix

**Dosya:** `server/routes/orders.js`

| Method | Path | Auth | Açıklama |
|--------|------|------|----------|
| GET | `/api/orders` | staff | Filter `status`, `order_type`, `table_id`, `limit` — ORDER BY created_at DESC |
| GET | `/api/orders/:id` | staffAndKitchen | Tek sipariş; items + payments nested |
| POST | `/api/orders` | staff | Yeni sipariş, 201 |
| POST | `/api/orders/:id/items` | staff | Kaleme ekleme (Kaydet), 200 |
| PATCH | `/api/orders/:id/status` | staffAndKitchen | Durum geçişi |
| PATCH | `/api/orders/:orderId/items/:itemId` | staffAndKitchen | Kısmi item update |
| PATCH | `/api/orders/:id/customer` | staff | Müşteri değiştirme |
| GET | `/api/orders/takeaway/open` | staff | Açık paket siparişler |
| PATCH | `/api/orders/:id/takeaway/delivery` | staff | `action: out_for_delivery \| delivered` |
| POST | `/api/orders/:id/takeaway/print-label` | staff | Paket etiketi yazdır |
| GET | `/api/orders/print-health` | staff | print_jobs özet + son hatalar |
| POST | `/api/orders/print-jobs/:id/retry` | staff | Başarısız iş yeniden kuyruğa |

**Auth:** `staff = admin | cashier | waiter`, `staffAndKitchen = staff + kitchen` (`routes/orders.js:96`)

**POST /orders body (Zod):**
```
order_type: 'dine_in' | 'takeaway' (default 'dine_in')
table_id?, customer_id?, call_log_id?
items[]: { product_id, quantity, portion_id?, modifiers?, note?, selected_attributes? }
note?, guest_count?, delivery_address?, delivery_note?, courier_note?
takeaway_planned_payment_type?: 'cash' | 'card' (sadece takeaway)
```
Response 201 + order (items dahil, payments DEĞİL).

**GET /orders/:id response:** `orders.*` + `table_name`, `customer_name`, `user_name` (JOIN), `items[]` (+ `created_by_name`), `payments[]` (`routes/orders.js:327-350`)

**v5 implications:**
- Pagination yok — sadece `limit`. v5'te cursor/page-based pagination eklenmeli.
- `staff` rol grubu v5 RBAC (ADR-002 §6) ile mapping: admin/cashier/waiter.

---

## 2. Order Item Snapshot Kuralı

**Dosya:** `server/services/OrderService.js` (`createOrder` ~410-460, `addItemsToOrder` ~530-560)

**Snapshot kolonları (order_items):**
- `product_name` — anlık ad kopyası
- `unit_price` / `unit_price_cents` — hesaplanmış nihai fiyat
- `vat_rate` / `vat_rate_snapshot` — product'tan kopyalanır (migration 0003)
- `category_id_snapshot`, `category_name_snapshot` — `orderItemSnapshot()`
- `printer_target_snapshot` — `product.printer_target || category.printer_target || 'kitchen'`
- `selected_attributes` — JSON array (resolved: group_id, group_name, option_id, option_name, extra_price)
- `portion_id`, `portion_label`

**Fiyat formülü:**
```
portionBasePrice = product.price + portion.price_delta (varsa)
extraPrice       = SUM(attribute_option.extra_price) for each selected option
finalItemPrice   = portionBasePrice + extraPrice
```
Porsiyon yoksa `product.price` kullanılır. `resolveAttributes()` zorunlu grupları valide eder; `is_required=1` grup seçilmezse 400.

**vat_rate kaynağı:** product tablosundan (category değil). `vat_rate_snapshot = vat_rate` ayrı kolon (migration 0003).

**v5 implications:**
- `selected_attributes` JSON şema aynı korunmalı (PostgreSQL JSONB).
- `orderItemSnapshot()` + `resolveAttributes()` v5 service katmanında kalmalı.
- Snapshot anı = INSERT — sonraki fiyat değişikliği siparişi etkilemez (ADR-013 §2 paritesi).

---

## 3. Status Lifecycle

**Dosya:** `server/constants/orderStatus.js`

**orders.status:**
```
ORDER_STATUSES_ALL    = ['new','saved','in_kitchen','preparing','ready','served','cancelled','closed']
ORDER_STATUSES_CLOSED = ['closed','cancelled']
```
**`createOrder` default = `'saved'`** (NOT `'new'`).

**Kritik geçişler (`updateOrderStatus`, ~570):**
- `cancelled`: `admin|cashier|waiter` yapabilir; ödeme kaydı varsa **400**; closed → uygulanamaz
- `closed`: `isOrderFullyPaid` kontrolü YOK — manuel `close_order` flag veya payment'ta `close_order=true` ile
- `in_kitchen` → tüm `'new'` item'lar otomatik `'sent'`, `sent_to_kitchen_at` set edilir
- Tüm değişiklikler `db.transaction()` içinde + `recordEntityMutation` + `auditLog`

**order_items.status FSM (`assertAllowedItemStatusTransition`):**
```
new       → [sent, cancelled, comped]
sent      → [preparing, ready, served, cancelled, comped]
preparing → [ready, served, cancelled, comped]
ready     → [served, cancelled, comped]
served    → [cancelled, comped]
cancelled → []
comped    → []
```
- Closed/cancelled order üstünde item değiştirme: 400 (`~727`)
- `portion_id` değişimi yalnız `status='new'` item'larda

**Otomatik geçişler:**
- Payment `close_order=true` + `closeOrderAndTableIfPaid()` → `order.status='closed'`, `table.status='empty'`, `customer.total_orders++`
- Takeaway `delivered` action → otomatik ödeme + `status='closed'` (transaction)
- `autoCancelOrderIfNoActiveItems()` — tüm item'lar iptal → sipariş otomatik iptal

**DB constraint YOK** — geçişler app katmanında.

**v5 implications:**
- `'saved'` default kritik — v5'te aynı.
- `'new'` schema'da var ama `createOrder`'da kullanılmıyor (gelecek için saklı).
- v5'te PostgreSQL CHECK constraint eklenebilir (defansif), app katmanı asıl otorite.

---

## 4. Payments + Invariants

**Dosya:** `server/routes/payments.js`, `server/services/PaymentService.js`

**Endpoint'ler:**
- `POST /api/payments` — full payment (admin|cashier)
- `POST /api/payments/split` — split/item (admin|cashier)
- `GET /api/payments/orders/:orderId/split-state`

**`createPayment` body (Zod):**
```
order_id*, payment_type* ('cash'|'card'), amount*
tip_amount?, cash_received?, note?
idempotency_key? (max 128 char)
close_order?: boolean (default false)
print_receipt?: boolean (default false)
print_printer_id?: string
```

**Invariant'lar (`PaymentService` ~214-230):**
1. `amount > remainingTotal + 0.02` → 400 "Ödeme tutarı kalan bakiyeyi aşıyor"
2. `remainingTotal ≤ 0` → 400 "Sipariş için kalan ödeme bulunmuyor"
3. `cash` ödeme: `cashIn < cashDue - 0.02` → 400

**`close_order=true`:** `closeOrderAndTableIfPaid()` çağrılır. `SUM(payments) < grand_total - 0.02` ise close başarısız → 400 (transaction rollback). Aksi halde `order.status='closed'` + `table.status='empty'` aynı transaction.

**Partial:** `close_order=false` ise eksik ödeme kabul, sipariş açık → 201.

**Split:** `payment_allocations` tablosuna `(order_item_id, quantity, unit_price_snapshot, line_total, payer_no, payer_label)` insert.

**`activePayableItems`:** `status != 'cancelled' AND is_comped = 0` — comped kalemler ödeme dışı.

**Refund/void:** `refunds` tablosu var (migration 0002 referans), aktif endpoint görülmedi.

**v5 implications:**
- `payment_allocations` junction zorunlu (split için).
- `close_order` server-side `SUM(payments) >= grand_total - 0.02` toleransı; v5 ADR-014 §6 paritesi.
- 0.02 TL tolerans = 2 cent integer karşılığı; v5'te `payment.amount_cents >= grand_total_cents - 2` olarak yaz.

---

## 5. Idempotent Replay

**Dosya:** `server/services/PaymentService.js:194-197`, `server/routes/payments.js:79`

**Mekanizma:** Client `idempotency_key` body veya `Idempotency-Key` header. `normalizeIdempotencyKey()` her ikisini kontrol eder, 128 char'a truncate.

`findExistingPaymentByKey(businessId, order_id, idempotencyKey)` var ise:
```
{ payment, order, idempotent_replay: true }
```
Route `idempotent_replay` ise **200** (201 değil).

**Sistem-içi key'ler:** `takeaway-delivery:${order.id}` gibi deterministic.

**v5 implications:**
- v5 client her POST için **UUID v4** üretmeli (ADR-014 §4 zorunlu).
- v5 backend `Idempotency-Key` header'ı standart kabul etsin (RFC draft); body fallback geriye dönük.
- Replay'de 200 vs 201 ayrımı frontend'in işleme alması gerek.

---

## 6. İkram (Comp)

**Dosya:** `server/services/OrderService.js:717-748`

- `is_comped` field `updateOrderItem` üzerinden (`staffAndKitchen` rolü)
- `comp_reason` opsiyonel
- Closed/cancelled order → 400 (`['closed','cancelled'].includes(item.order_status)`)
- Comped item `payment_allocations`'a dahil değil (`activePayableItems` filtresi)
- `recalcOrderTotals()` comped item'ları subtotal'dan dışlar — `grand_total` otomatik düşer
- **Ayrı `comped_amount_cents` kolonu YOK** — grand_total zaten comped'siz; fark için client `SUM(is_comped × unit_price × qty)` hesaplayabilir

**v5 implications:**
- Comp toggle endpoint = `PATCH /orders/:orderId/items/:itemId { is_comped: true }`. Ayrı endpoint yok.
- v5 RBAC: admin/cashier (kitchen comp toggle yapabilmeli mi karar gerekli — v3'te `staffAndKitchen` izinli).

---

## 7. Print System

**Dosyalar:** `server/services/printJobs.js`, `server/services/printRouting.js`

**`print_jobs` kolonları:**
```
id, business_id, order_id, printer_id, job_type, payload (JSON),
status, error_message, idempotency_key,
created_at, printed_at, claimed_at, claimed_by, claimed_until, last_error_code
```

**Status:** `pending → printed | failed`; retry ile `pending`'e döner.

**Job types:** `kitchen`, `kitchen_adjustment` (iptal/azaltma), `receipt`, `takeaway_label`

**Auto-print tetikleyiciler:**
- `in_kitchen` status → `enqueueKitchenJobsForSentItems()`
- `addItemsToOrder` sonrası → `queueKitchenForNewItems()` (`AUTO_PRINT_EVENTS.KITCHEN_ORDER_ADJUSTMENT`)
- Payment `close_order=true` veya `print_receipt=true` → `enqueueReceiptJobForClosedOrder()`
- Takeaway delivered → receipt

**Routing (`resolvePrinterForKitchenLine`):**
1. `printer_routing` tablosu (category_id → printer_id)
2. `products.printer_target` veya `categories.printer_target` (`kitchen|bar`)
3. `type='kitchen'` / `type='bar'` ilk aktif yazıcı
4. Fallback: ilk aktif

**Render:** Server kuyruk; StoreBridge (Electron) `processPendingJobsSync()` ile sync çeker, ESC/POS yazdırır. Server JSON payload üretir.

**`INSERT OR IGNORE`** ile idempotent — aynı `idempotency_key` çift insert engellenir.

**v5 implications:**
- v5 Print Agent (ADR-004) bu pattern'i sürdürür.
- `printer_routing` tablosu v5'te de zorunlu (kategori-bazlı kitchen routing).
- ADR-014 §7-8 (Öde+Yazdır job, Kaydet→mutfak ticket) v3 paritesinde.

---

## 8. Tables + Transfer

**Dosya:** `server/routes/tables.js`

**Endpoint'ler:** `GET /api/tables`, `PATCH /api/tables/:id/status`, `POST /api/tables/:id/transfer`

**Transfer atomicity (~122-130):**
```
db.transaction(() => {
  UPDATE orders SET table_id = targetTableId WHERE id = source.current_order_id
  UPDATE tables SET status=source.status, current_order_id, guest_count WHERE id=targetTableId
  UPDATE tables SET status='empty', current_order_id=NULL, guest_count=0 WHERE id=source.id
})
```
Hedef `status != 'empty'` → 400. Sonrasında `emitToRoom('table:transferred')`.

**`table.status` enum:** `empty | occupied | reserved`

**"Occupied" sayılma:** `current_order_id IS NOT NULL` — sadece bu (status field'ı doğrulayıcı, otorite değil).

**Multi-table merge YOK.**

**v5 implications:**
- Transfer route inline; v5'te `TableService.transfer()` ayır (ADR-013 service-katman ayrımı).
- `current_order_id` invariant: occupied iff non-null.

---

## 9. Caller ID + Customers

**Dosyalar:** `server/routes/customers.js`, `server/routes/callerid.js`, `server/services/callerIdService.js`

**`customers` tablosu + `customer_phones` ayrı tablo (migration 0009).** `customers.id` → `orders.customer_id` (1-to-many).

**Arama:** `GET /api/customers?phone=...` veya `?search=...` (TR normalize)
- Telefon: `normalizePhoneDigits()` → `customer_phones.normalized_phone = ?` veya LIKE
- Pagination: `?page=&limit=` (max 200, default 50); phone aramada disable

**Caller ID:** `/api/callerid` ve `/api/caller-id` aynı router (alias). `call_logs` üzerinden çalışır. StoreBridge (`bridge.js:366`) hardware call'ları `processIncomingCall` ile yazar. `createOrder` body'de `call_log_id` optional FK.

**v5 implications:**
- `customer_phones` ayrı tablo — v5'te de aynı şema (PostgreSQL).
- `call_log_id` → orders optional FK korunmalı.
- `normalize_phone_digits` SQL function olarak v5 PostgreSQL'de tanımlanabilir.

---

## 10. Domain Services + Invariants

**Transaction boundaries:**
- `createOrder` → tek transaction (items + header)
- `addItemsToOrder` → tek transaction (items insert + totals update)
- `updateOrderStatus('cancelled')` → transaction (order + table + items)
- `createPayment` → transaction (payment insert + optional close)
- Table transfer → transaction (order + 2 table)

**Service-level rules:**
- `assertPeriodOpenForMutation()` — hesap dönemi kontrolü (tüm mutation)
- `assertTableCanOpenOrder()` — masa zaten occupied mu
- `assertAllowedItemStatusTransition()` — item FSM
- `isOrderFullyPaid()` → `SUM(payments) >= grand_total - 0.02`
- `autoCancelOrderIfNoActiveItems()` — son item iptal → sipariş auto-cancel

**DB constraint YOK** (SQLite CHECK yalnız `run.js` migrations baseline). Hiçbir trigger yok.

**v5 implications:**
- Tüm invariant'lar service katmanında.
- PostgreSQL'de defansif CHECK constraint eklenebilir (ör. `order_items_status_valid`) ama zorunlu değil.
- Transaction sınırları PostgreSQL'de aynı (Kysely `db.transaction().execute()`).

---

## 11. Migrations + DB Şema

**Dosya:** `server/migrations/versions/`

| Dosya | Amaç |
|-------|------|
| `0000_baseline_legacy_schema.js` | Marker; `run.js` idempotent schema asıl kaynak |
| `0001_create_entity_mutations.js` | Audit trail tablosu |
| `0002_add_cents_columns.js` | `*_cents` INTEGER (orders/order_items/payments/products) |
| `0003_snapshot_columns.js` | `pricing_policy_version`, `service_charge_*`, `order_items.vat_rate_snapshot` |
| `0004_refresh_tokens.js` | JWT refresh token |
| `0005_devices.js` | Cihaz/terminal kayıt |
| `0006_takeaway_planned_payment_type.js` | `orders.takeaway_planned_payment_type TEXT` |
| `0007_drop_legacy_customer_columns.js` | Eski customer kolon temizleme |
| `0008_customer_name_split_and_address_admin.js` | İsim ayrımı + adres |
| `0009_renormalize_customer_phones.js` | `customer_phones.normalized_phone` re-normalize |
| `0010_cleanup_soft_deleted_categories.js` | Silinen kategori temizlik |
| `0011_must_change_password.js` | Zorunlu şifre değişim flag |
| `0012_password_reset_requests.js` | Şifre sıfırlama tablosu |

**Snapshot kolonları:** `selected_attributes`, `category_name_snapshot` baseline schema'da. `vat_rate_snapshot` = 0003.

**v5 implications:**
- v5 PostgreSQL migration'larında zorunlu kolonlar:
  - `order_items.vat_rate_snapshot DECIMAL`
  - `order_items.category_id_snapshot UUID`
  - `order_items.category_name_snapshot TEXT`
  - `order_items.printer_target_snapshot TEXT`
  - `order_items.selected_attributes JSONB`
  - `order_items.created_by_name TEXT` (ADR-013 §5 actor rozeti)
  - `order_items.created_by_user_id UUID FK users(id) ON DELETE SET NULL`
- Mevcut Migration 017 (`order_item_attributes`) v3'ün `selected_attributes JSON`'una karşılık geliyor (kararı sahip ol).

---

## 12. Error Envelope + Codes

**Format:** `{ error: "mesaj" }` — tek alan, no code, no stack.

**HTTP mapping:**
- `err.isBadRequest` → 400
- `err.isNotFound` → 404
- `err.isForbidden` → 403
- `err.status === 409` → 409
- `err.status === 400` → 400
- Default → 500 `{ error: 'Sunucu hatası' }`

**Validation:** **Zod** + `validate()` middleware. express-validator/joi yok.

**v5 implications:**
- v5 error envelope (ADR-006): `{ error: { code, message, message_key } }` — geriye uyumsuz, intentional.
- Frontend i18n için `code` + `message_key` zorunlu (mevcut v5 pattern).
- Zod kullanım pattern'i v5'te de geçerli (shared-types via zod schemas).

---

## v5 Mini-Sprint Backend Aksiyon Listesi

| PR | Backend gereksinim |
|----|---------------------|
| **PR-3** (mevcut) | Backend etkileşimi YOK — saf local cart |
| **PR-4** (Kaydet) | `POST /orders` + `POST /orders/:id/items` endpoint'leri Zod schema + service katmanı; snapshot insert (vat_rate, category_name, selected_attributes); transaction |
| **PR-5** (Persisted) | `GET /orders/:id` (items + payments nested + `created_by_name`/`created_at`); `PATCH /orders/:orderId/items/:itemId` (status, qty, note, is_comped); `canVoidOrderItem` rol kontrolü |
| **PR-6** (Varyant + attribute) | Migration: `order_items.selected_attributes JSONB` (mevcut Migration 017 ile uyum kontrol); `resolveAttributes()` service fonksiyonu; `is_required` validation |
| **PR-7** (Hızlı Öde + Split) | `POST /payments` (idempotency key UUID v4); `POST /payments/split` + `payment_allocations` tablosu; `closeOrderAndTableIfPaid` ile order+table atomic close; partial payment 0.02 cent tolerans |
| **PR-8** (Müşteri) | `customer_phones` ayrı tablo + normalized_phone; `PATCH /orders/:id/customer`; takeaway customer_id zorunluluk validation |
| **PR-9** (Transfer) | `POST /tables/:id/transfer` atomic transaction (orders + 2 tables); hedef boş kontrolü; multi-merge yok |
| **PR-10** (Print) | `print_jobs` tablosu (idempotency_key, claimed_*, INSERT OR IGNORE); receipt + kitchen + adjustment + takeaway_label job types; `printer_routing` tablosu (category → printer) |
| **PR-11** (Tables dolu state) | `GET /tables` projection: `current_order_id`, `order_total_cents`, `order_started_at`, `waiter_name`, `has_ready_items` |
| **PR-12** (Paket) | `orders.order_type='takeaway'`; `delivery_address`, `delivery_note`, `courier_note`; `takeaway_planned_payment_type`; `out_for_delivery → delivered` action endpoint |

---

## Kritik v3↔v5 Uyumsuzluklar (Karar Verildi — ADR-013 §9 Amendment 2026-05-02)

| Konu | v3 | v5 (karar) |
|------|----|------------|
| Default order status | `'saved'` | ✅ **`'open'`** (Karar 9.1) — Türkçe "açık" eşleşmesi |
| comped_amount kolonu | YOK | ✅ **YOK** (Karar 9.3, v5.1 backlog) — runtime SUM yeter |
| Ödeme tolerans | 0.02 TL | ✅ **2 cent** (`>= grand_total_cents - 2`) integer |
| `staff` rol grubu | admin/cashier/waiter | ✅ ADR-002 §6 ile birebir map |
| Kitchen rol comp toggle | İzinli | ✅ **YOK** (Karar 9.2) — admin/cashier only |
| `pricing_policy_version` | v3 0003 | ✅ **YOK** (Karar 9.4, v5.1+ backlog) — indirim altyapısı ayrı ADR |
| Idempotency client | YOK | ✅ **UUID v4 ZORUNLU** (ADR-014 §4) |
| Error envelope | `{ error: string }` | ✅ `{ error: { code, message_key } }` (ADR-006) |

**Cross-ref:**
- ADR-013 (UI Mimarisi)
- ADR-014 (Ödeme Akışı)
- ADR-002 §6 (RBAC), §10 (User lifecycle hard delete)
- Migration 017 (`order_item_attributes`) v3 `selected_attributes` paritesi
- v3 dosyalar: `server/routes/orders.js`, `payments.js`, `tables.js`, `customers.js`, `callerid.js`; `server/services/OrderService.js`, `PaymentService.js`, `printJobs.js`, `printRouting.js`; `server/constants/orderStatus.js`; `server/migrations/versions/0003_snapshot_columns.js`
