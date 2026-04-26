# v3'ten Öğrenilen Davranış Kuralları (Domain Rules)

> Bu dosya v3 röportajlarından (Modül 1-15) süzülen **davranışsal/invariant** kuralları içerir. Kod değil, domain kararları. v5 `packages/shared-domain` modülüne referans. Sinyaller için bkz. `.claude/memory/scratchpad.md`.

## Para Birimi

- **Tüm para değerleri `*_cents` integer (minor unit/kuruş)** (Sinyal #21). Float yasak.
- v3'te çift saklama vardı (`grand_total` float + `grand_total_cents` int) — v5'te sadece cents.
- Raporlarda `COALESCE(x.amount_cents, ROUND(x.amount * 100))` pattern'i v5'te **yasak**.
- Döviz kuru / çoklu para birimi destek yok (pilot TRY tek).

## Snapshot Semantiği (Değişmezlik İnvaryantı)

v3'te sipariş oluşturulurken kritik alanlar **snapshot'lanır** — menü güncellemesi / müşteri adı değişikliği eski kayıtları etkilemez. v5'te korunacak:

| Snapshot Alan | Kaynak Tablo | Hedef Tablo | Gerekçe |
|---|---|---|---|
| `product_name` | `products.name` | `order_items.product_name` | Rapor `GROUP BY product_name` (Sinyal #6) |
| `unit_price_cents` | `portions.price_cents` | `order_items.unit_price_cents` | Menü fiyat değişimi eski siparişi etkilemez |
| `category_id_snapshot` + `category_name_snapshot` | `categories` | `order_items.*` | Kategori rename eski raporu etkilemez (Sinyal #35, v3'te zaten var) |
| `customer_name_snapshot` | `customers.full_name` | `orders.*` | Müşteri anonimize/rename eski siparişi korur |
| `address_snapshot` | `customer_addresses` | `orders.*` + `call_logs.*` | Paket sipariş anındaki adres |
| `table_name_snapshot` | `tables.name` | KDS kartı, fişler | Masa adı değişimi aktif siparişi bozmaz |

**Uygulama:** `shared-domain/Order` entity'sinde `createOrderItem(product, portion)` → snapshot alanlarını donduran fabrika.

## Sipariş İnvaryantları

- **Tek masa = tek aktif sipariş** (Sinyal #11). Ek sipariş = aynı adisyona yeni kalem, yeni order record değil.
  - DB seviyesi: `orders` tablosunda `UNIQUE(business_id, table_id) WHERE status='open'` partial index.
  - Paket (takeaway) bu invarianta tabi değil — masaya bağlanmaz.
- **`order_type` enum = `{dine_in, takeaway}`** (Sinyal #12). Paket ayrı akış, masaya bağlanmaz.
- **Masa birleştirme MVP'de** (Sinyal #10): `orders.table_ids[]` değil, `order_tables` junction tablosu. Sonradan ayrılabilir.
- **Masa sorumlu garson modeli MVP'de** (Sinyal #9): v3'te yoktu, v5'te `orders.assigned_waiter_id` veya `tables.active_waiter_id` (ADR ile karar).
- **`order_no` günlük reset** (Sinyal #23): DB sequence değil, `store_date(created_at)` üzerinden transactional `MAX+1` pattern. Race condition için explicit lock (`SELECT … FOR UPDATE`) gerekir.
- **Sipariş iptal vs refund ayrımı** (Sinyal #31): Ödeme öncesi iptal = `orders.status='cancelled'`. Ödeme sonrası = ayrı `refunds` satırı + admin onay + neden + audit. MVP'de kısmi refund yok — tam iptal (`refunds.amount_cents = payments toplamı`).

## Ödeme

- **`payment_type ∈ {cash, card, transfer}`** (Sinyal #29). v3'teki `mixed` ve `other` enum değerleri **deprecate**. Karışık ödeme = iki ayrı `payments` satırı (her biri tek tip).
- **`payment_scope ∈ {full, item, partial}`** (v3 paritesi, korunur).
- **Kalem bazlı parçalı ödeme UI** (Modül 10 kararı): Checkbox → "Seçilenleri öde" akışı.
- **Para üstü alanı** `tendered_cents` zorunlu (nakit ödemede).
- **Idempotency server-side zorunlu** + UI optimistic lock (çift tıklama koruması). v3 UNIQUE constraint var, UI taraflı kontrol eklenir.
- **İskonto MVP dışı → v5.1** (Sinyal #30). v3'te DB alan var ama route/UI yoktu, fiilen kullanılmıyordu. Pilot sadeliği için ertelendi; `payments.discount_amount` alanı korunur (MVP'de always 0).

## İkram (Comp)

- **Kalem bazlı**: `order_items.is_comped` boolean + `comp_reason` text (v3 paritesi).
- Admin onayı gerekli (MVP'de kasiyer limit yok; iskonto kuralları gibi v5.1'e).
- Audit log zorunlu (Sinyal #39 finansal event kapsamında).
- Ödeme hesabında ikram kalem toplam dışında tutulur.

## Müşteri & PII (KVKK)

- **Müşteri silme yok → anonimize modeli** (Sinyal #15). KVKK talebi: `full_name='Anonim'`, telefon/adres silinir, `customer_id` + siparişler + `customer_name_snapshot` dokunulmaz. Rapor bütünlüğü korunur.
- **Telefon normalizasyonu + UNIQUE** (Sinyal #14): `customer_phones.normalized_phone` için `UNIQUE(tenant_id, normalized_phone)` partial index. v3'te normalize var ama unique yoktu → Caller ID eşleşmesi belirsizdi.
- **Telefon format**: TR-specific; E.164 veya ulusal, tek kolon.
- **Müşteri sipariş geçmişi MVP'ye terfi** (Sinyal #16): `GET /customers/:id/orders`.
- **Excel import/export MVP'ye terfi** (Sinyal #17): Pilot geçişinde mevcut müşteri tabanı taşınır.

## Caller ID

- **Print Agent = yazıcı + Caller ID forwarder (tek servis)** (Sinyal #18). Ayrı servis yok.
- **Socket.IO push, polling değil** (Sinyal #19). v3'te 2-3 sn gecikme vardı → v5'te realtime.
- **`call_logs` 30 gün retention + cron** (Sinyal #20). Legacy `incoming_calls` tablosu kaldırılır.
- **Call anında snapshot**: `customer_name_snapshot` + `address_snapshot` doldurulur; müşteri sonradan değişse bile call_log bozulmaz.

## Yazıcı

- **`ESC @ + ESC t 13` preamble her baskı öncesi zorunlu** (Sinyal #28). CP857 codepage select; yazıcı PC437 default'unda kalırsa Türkçe karakter bozuk.
- **UTF-8 → CP857 tek encoder katmanı** (v3 encodePC857 byte tablosu domain referansı, kod değil).
- **4 job tipi**: `receipt` (adisyon), `kitchen` (mutfak), `kitchen_adjustment` (iptal/azaltma), `label` (paket etiket).
- **Kitchen adjustment fişi**: ayrı fiş, kırmızı "İPTAL"/"AZALTILDI" başlık, before/after snapshot (Sinyal #22).
- **Yazıcı sayısı runtime değişken** (Sinyal #27). Hardcode yasak; `printers` tablosu admin CRUD.
- **Routing kategori bazlı tek mekanizma** (Sinyal #8). Ürün override v5.1'e.
- **Timeout 20 sn + 2 auto retry (5+15 sn), sonra kasa toast + ses** (Sinyal #26). Kasiyer anında uyarılır.
- **Idempotency_key UNIQUE** print job'da — çift basım sıfır.

## Günlük Kapanış (Modül 11)

- **İsim: "günlük kapanış"** — yazarkasa Z raporu **değil** (yasal, fiziksel, kullanıcı yazarkasadan manuel alır, POS kapsamı dışı — Sinyal #32).
- **Otomatik cron**: İşletme kapanış saati (Ayarlar) + 2 saat. Bilgisayar gece kapatıldığı için manuel güvenilmez.
- **Hibrit storage** (Sinyal #33): Canlı gün SUM; kapandıktan sonra `period_closes` DB satırı (totals JSON, `closed_at`, `closed_by`).
- **Açık sipariş uyarısı**: Kapanış öncesi hala `open`/`preparing` sipariş varsa cron engellenir, admin müdahale bekler.
- **Post-kapanış düzeltme**: Admin parola + neden + audit; günlük özet revize edilir.

## Audit Log

- **Kritik + finansal event'ler loglanır** (Sinyal #39): order create/cancel, payment, refund, daily_close, admin_override, auth, user mgmt, table_transfer, category update/delete.
- **Yüksek hacim event'ler filtrelenir**: `print_jobs_enqueued`, `print_job_printed` loglanmaz (gürültü).
- **PII sanitizer zorunlu** (Sinyal #39): Telefon son 4 maske, isim/adres yok, sadece `customer_id` FK. v3 `incoming_call` raw telefon düzeltilir.
- **Retention 2 yıl + cron** (Sinyal #39). `call_logs` cron ile birleşik job, farklı TTL.
- **Actor**: `user_id` + `user_agent` (Sinyal #40). **IP yok** (KVKK). Session_id yok (forensic v5.1'de).

## Rezervasyon (v5.1)

- **Seat akışı pattern** (Sinyal #37): `POST /reservations/:id/seat` → order oluştur + `seated_order_id` FK bağla. Rezervasyon tüketildiğinde masa/sipariş açılır.
- v5.1'de `customer_id` FK terfi (telefon normalize ile otomatik bağla).
- v5.1'de saat çakışması (±90 dk tampon), `party_size ≤ table.capacity` soft uyarı.

## Yedek vs Veri Saklama Ayrımı

**Bu ayrım kullanıcı eğitiminde karıştırılmamalı** (Sinyal #41):

- **Canlı DB süresiz saklar**: orders, customers, payments, order_items silinmez (MVP'de silme endpoint'i yok). "3 yıl önceki siparişi görmek" raporlar üzerinden canlı DB'den yapılır.
- **Yedek 30 gün**: Yalnız felaket kurtarma. 30 günden eski silinir çünkü canlı DB zaten güncel (Sinyal #42).
- **Audit log 2 yıl**: Denetim zinciri; eski audit event'leri silinir (Sinyal #39).

## Silme Politikası (Hibrit)

- **Referans varsa soft-delete, yoksa hard-delete** (Sinyal #7, v3 `products.js` pattern).
- Sipariş geçmişi olan ürün silinmez (soft), hiç satılmamış ürün + görseli temizlenebilir (hard).
- `shared-domain` `canHardDelete(entity)` fonksiyonu.

## Masa

- **Hedef masa sayısı mekaniği** (Sinyal #13): Boş masa düşürme soft-delete, dolu engelleme. v3 paritesi korunur.
- **Masa adı düzenlenebilir** (admin UI).
- **Salon bölgeleri** (Modül 4): İç/Dış, bahçe vs. — runtime yapılandırılabilir.

## Kapsam Kararları (MVP Kesin)

| Özellik | v5.0 MVP | v5.1 | v5.2+ | Non-goal |
|---|---|---|---|---|
| İskonto | — | ✅ (sinyal #30) | | |
| Kısmi refund | — | ✅ (sinyal #31) | | |
| Stok | — | — | ✅ (sinyal #38) | |
| Rezervasyon | — | ✅ | | |
| Audit UI | — | ✅ | | |
| Yedek UI | — | ✅ | | |
| Yazarkasa Z | | | | ✅ (sinyal #32) |
| e-Fatura | | | | ✅ |
| QR menü | | | | ✅ |
| Sadakat | | | | ✅ |
| Offline mod | | | ✅ | |
| Çoklu şube | | | ✅ | |
