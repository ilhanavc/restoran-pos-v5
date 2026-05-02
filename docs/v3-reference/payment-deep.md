# v3 Ödeme Tarafı — Davranış Raporu (PR-7b öncesi)

> **Kaynak:** `D:\dev\restoran-pos-v3\` READ-ONLY. v3'ten kod taşınmaz; bu doküman v5 PR-7b'nin **davranış paritesi** referansıdır. Kararlar ADR-014'ün §1–8'ini günceller veya doğrular.

## Etiket sözlüğü

- **Kodda tespit:** v3 dosyasında satır numarasıyla teyitli
- **Kullanıcı gözlemi:** ekran görüntüsü + sözlü teyitten
- **Doğrulanmamış:** sub-agent raporda belirsiz, PR-7b sırasında doğrulanmalı

---

## 1. Backend (server/routes + services)

### 1.1 Endpoint seti

**Kullanıcı gözlemi + Kodda tespit:**

- **`POST /api/payments`** — tek payment (Hızlı Öde + Detaylı Öde "Kaydet" butonu). Body: `order_id`, `payment_type` ('cash' | 'card'), `amount`, `tip_amount?`, `cash_received?`, `note?`, `idempotency_key?`, `close_order` (bool), `print_receipt` (bool), `print_printer_id?`.
- **`POST /api/payments/split`** — N payer single-shot insert (Ayrı Ayrı Öde "Bu kişiden ödemeyi al" tetikleyicisi).
- **`GET /api/payments/summary`** — gün sonu / dashboard raporu.

**RBAC:** Üçü de `authorize('admin', 'cashier')`. Garson (waiter) ve mutfak (kitchen) **ödeme yapamaz**.

### 1.2 Tablolar

**`payments`** (SQLite):
- `id`, `business_id`, `order_id`, `payment_type` ('cash'|'card'), `amount` REAL, `tip_amount` REAL nullable, `created_at`, `created_by_user_id`, `idempotency_key` UNIQUE per order.

**`payment_items`** junction:
- `payment_id`, `order_item_id`, `quantity` REAL, `line_total` REAL.
- v3 kalem-bazlı bölünmüş ödemede her kalemin **kaç adedinin** o payment'a denk geldiğini taşır (`quantity` partial pay için fraksiyonel olabilir — **doğrulanmamış**).

> **v5 farkı (uyarı):** v5 `payment_items` junction tablosu sadece `(payment_id, order_item_id, tenant_id)` taşıyor — `quantity` veya `line_total` YOK. Kalem ya tamamı bir payment'a bağlı ya hiç. v3 partial-quantity desteği MVP dışı bırakıldı (ADR-003 §10.1.b).

### 1.3 Idempotency mekanizması

- UI modal açılışında `uuid v4` üretir → POST body veya `Idempotency-Key` header.
- Sunucu `findExistingPaymentByKey(businessId, orderId, key)` ile lookup; bulduysa cache response 200 döner (yeni satır INSERT etmez).
- Modal kapatılıp tekrar açılırsa **yeni key**.
- Network retry / double-click → idempotent replay.

### 1.4 Atomicity

`createPayment` SQLite transaction:
1. SELECT order (yoksa 404)
2. Idempotency key duplicate check
3. BEGIN
4. INSERT payments (+ scope='item' ise INSERT payment_items)
5. `close_order=true` → UPDATE orders SET `status='closed'`, `closed_at=now()`
6. INSERT audit_logs
7. COMMIT
8. Socket.IO `order:updated` emit

**Karar (v5 paritesi):**
- Partial payment (kısmi ödeme) → `close_order=false` zorunlu, masa AÇIK kalır.
- Full + close_order=true tek seferde geçer.
- Bu davranış v5 PR-7a `closeOrder` parametresi ile zaten karşılanıyor.

### 1.5 Print routing

- POST /payments `print_receipt=true` ise → `print_jobs` INSERT, Print Agent (Windows hizmeti) pickup edip ESC-POS basar.
- Mutfak ticket'i ÖDEME ile değil **Kaydet (POST /orders/:id/items)** ile tetiklenir (kategori `kitchen_print=true` ise).

### 1.6 Hata kodları

- `404 NOT_FOUND` — sipariş yok
- `409 CONFLICT` — idempotent replay (mevcut payment döner) **veya** order zaten kapalı
- `400` — validation
- `500` — sistem

---

## 2. Hızlı Öde (QuickPaymentModal)

**Dosya:** `client/src/components/payments/QuickPaymentModal.jsx` (~/components yolu sub-agent'tan, doğrulanmamış)

### 2.1 Layout (ekran görüntüsü 1)

- **Başlık + alt başlık:** "Hızlı Öde" + "Tek hamlede ödeme al"
- **Büyük tutar bloğu:** "ÖDENECEK TOPLAM" alt label + **₺xxx,xx** (40-50px font, mor accent yok — siyah)
- **İŞLEM TİPİ SEÇİMİ** (small-caps label) + 2x2 radio grid:
  1. **Öde** (default, mor seçili stil) — "Masa açık kalır"
  2. **Öde & Kapat** — "Ödemeyi al ve masayı boşalt"
  3. **Öde & Yazdır** — "Fiş gönder, masa açık kalsın"
  4. **Öde, Yazdır ve Kapat** — "Fiş ve masa kapanışı"
- **2 büyük buton (yan yana):** 💵 Nakit | 💳 Kredi Kartı
  - Tıklanınca seçili işlem tipi + payment_type ile **POST /payments** atılır
  - Buton içi spinner; başarı toast + onComplete

### 2.2 State machine

| operation        | close_order | print_receipt |
|------------------|-------------|---------------|
| Öde              | false       | false         |
| Öde & Kapat      | true        | false         |
| Öde & Yazdır     | false       | true          |
| Öde+Yazdır+Kapat | true        | true          |

`amount` = `order.total_cents` (her zaman tam tutar; partial Hızlı Öde YOK — kısmi ödeme Detaylı Öde'den).

### 2.3 ESC + idempotency

- ESC → modal kapatma (`onClose`)
- idempotencyKey modal açılışında üretilir, modal kapatılana kadar SAME key (network retry idempotent)
- Modal **kapanıp tekrar açılırsa yeni key**.

---

## 3. Detaylı Ödeme (SplitPaymentModal — split-amount akışı)

**Dosya:** `client/src/components/payments/SplitPaymentModal.jsx` (doğrulanmamış path)

### 3.1 Layout (ekran görüntüsü 2 + 3)

- **Header:** "DETAYLI ÖDEME" small-caps + **Masa 2** büyük + "Garson: İlhan Avcı" chip + "1 kalem" chip
- **Sol panel — Kalemler:**
  - Başlık: "Kalemler" + "Ödenmemiş hesap kontrolü" alt yazı + sağda **"Ayrı ayrı öde"** outline buton
  - Her kalem: `qty×` prefix + ad + porsiyon alt + sağda fiyat
  - Comp (ikram) kalemler strikethrough, **ödeme tutarına eklenmez**, "İkram" rozeti
  - Alt info: "Ayrı ödeme gerektiğinde kalemleri kişilere paylaştırın. Normal ödeme için sağdaki ödeme alanını kullanın."
- **Sağ üst kart trio:**
  - **SİPARİŞ TOPLAMI** (default siyah)
  - **ÖDENEN** (gri ya da yeşil)
  - **KALAN** (turuncu/sarı vurgulu kart, içinde **₺xxx,xx** büyük font)
- **İŞLEM AKSİYONU** (small-caps) — 2x2 grid:
  - **Kaydet** (mor, primary, daha geniş — actionın default'u)
  - **Öde ve Kapat** (outline, ✓ ikon)
  - **Öde ve Yazdır** (outline, 🖨 ikon)
  - **Öde, Yazdır ve Kapat** (outline, 🖨 ikon)
- **ÖDEME TİPİ** (small-caps) — 2 buton: Nakit (mor seçili) | Kredi Kartı (outline)
- **Footer:**
  - Sol: **"Ödeme Ekranını Kapat"** outline buton (modal close)
  - Sağ: **"✓ Kaydet"** büyük mor buton (full-width sub-area) — primary action

### 3.2 Davranış kuralları

- "Kaydet" → `close_order=false`, `print_receipt=false` → POST /payments → ödeme insert, masa açık kalır, modal AÇIK kalır (başka kalem ödenebilir).
- "Öde ve Kapat" → `close_order=true`, `print_receipt=false` → POST /payments → masa boşaltılır, modal kapanır.
- "Öde ve Yazdır" → `close_order=false`, `print_receipt=true`.
- "Öde, Yazdır ve Kapat" → ikisi de `true`.
- ÖDEME TİPİ seçimi (Nakit/Kart) İŞLEM AKSİYONU butonu tıklanmadan ÖNCE yapılır; her butonun tıklamasında payment_type body'e gider.
- "Ayrı ayrı öde" outline buton → SplitByPersonModal aç (bölüm 4).
- **Kalan tutar 0'a düştüğünde otomatik kapanır mı?** → **Doğrulanmamış**. PR-7b'de "0 → auto-close" davranışını ekran 2/3'ün state machine'inden netleştirmek gerek; varsayılan tahmin: full payment + close_order=true → kapanır; partial bitince modal AÇIK ama "Öde ve Kapat" buton enabled olur.

### 3.3 Bahşiş (tip)

- Detaylı Öde modal'ında **bahşiş alanı YOK** (ekran görüntüsünde gözükmüyor).
- Bahşiş yalnız "Ayrı Ayrı Öde" alt-modal'ında, kişi-bazında.

---

## 4. Ayrı Ayrı Öde (SplitByPersonModal — split-by-payer akışı)

**Dosya:** SplitPaymentModal içinde ayrı sub-component (path doğrulanmamış)

### 4.1 Layout (ekran görüntüsü 4)

- **Header:** "Ayrı Ayrı Öde" + "M2 · Ürünleri kişilere paylaştırın" alt
- **Üst sayaç bar (4 kart):**
  - SİPARİŞ TOPLAMI / ÖDENEN / KALAN (sarı vurgu) / **DAĞITIMDA** (mor vurgu)
- **Sol panel — KALAN ÜRÜNLER:**
  - Üst: "KALAN ÜRÜNLER" small-caps + sağda "KİŞİ 1 İÇİN EKLE" small-caps
  - Her satır: qty + ad + sağda fiyat + **`+` mor buton** (active payer'a ekle)
  - Alt detay: "Kalan 1" + ₺xxx,xx (henüz dağıtılmamış qty)
- **Sağ panel — Active payer + actions:**
  - Üst sıra: "↺ Geri Al" outline | "↻ Bölmeyi Sıfırla" outline | "👤+ Kişi Ekle" mor (primary)
  - Active payer card (border mor):
    - Üst: "Kişi 1" başlık + sağda **₺0,00** (running total)
    - "Soldan ürün ekleyin" placeholder veya allocated items list
    - **Nakit** (mor seçili) | **Kredi Kartı** outline
    - **Bahşiş** label + 0,00 input
    - **"✓ Bu kişiden ödemeyi al"** yeşil full-width buton

### 4.2 Davranış

- "Kişi Ekle" → `addPayer()` → state'e yeni payer (label "Kişi N"), active olur, sağda kart açılır.
- Sol kalem `+` butonu → active payer'ın `items[order_item_id]++`. Stok azalır → "DAĞITIMDA" sayacı artar; "KALAN" azalır.
- "Geri Al" → son ekleme undo (single-step, **doğrulanmamış**).
- "Bölmeyi Sıfırla" → tüm payerlar reset, kalem'ler "KALAN ÜRÜNLER" listesine geri döner.
- "Bu kişiden ödemeyi al" → POST /payments scope='item' (veya /payments/split) → payment_items junction INSERT, kalemler "ÖDENEN" sayacına eklenir.
- Tüm payment_items dağıtıldığında "KALAN" = ₺0,00 → ekran kapanabilir veya "Öde ve Kapat" enabled olur.

### 4.3 Kalem bölme algoritması

- **Tam pay (default):** Bir kalemin tüm `quantity`'si bir payer'a gider.
- **Parçalı pay:** v3'te `payment_items.quantity REAL` desteği var (1 kalem 2 quantity → 1'i Kişi 1'e, 1'i Kişi 2'ye). **v5'te bu YOK** — bir order_item ya tamamı bir payment'a ya hiç (UNIQUE constraint).
- v5 kapsam kararı: **MVP'de partial-quantity item splitting YOK**. Kullanıcı pratiği: 4 çay siparişi varsa zaten 4 ayrı `order_items` satırı olarak girilir, böylece her biri ayrı ayrı bölünebilir.

### 4.4 Bahşiş

- Per-payer `tip_amount` number input.
- POST /payments body'de `tip_amount` → `payments.tip_amount` kolonuna yazılır.
- Receipt'te ayrı satır olarak görünür.
- **v5 karar gerek:** ADR-014 amendment ile `payments.tip_cents INTEGER NULL` kolonu ekle → v5.1 backlog mu MVP mi? **Doğrulanmamış**, kullanıcı kararı bekliyor.

### 4.5 "DAĞITIMDA" sayacı

- "Bu kişiden ödemeyi al" basılmamış, ama active payer'lara dağıtılmış kalemlerin **draft total**'ı.
- ÖDENEN ≠ DAĞITIMDA: ÖDENEN = persisted payments toplamı, DAĞITIMDA = current draft.

---

## 5. Dolu Masa Kart 3-nokta Menüsü (TableActionsModal)

**Dosya:** `client/src/components/tables/TablesScreen.jsx` veya `TableCard` içi

### 5.1 Conditional render

- Yalnız **dolu** masa kartında 3-nokta (MoreVertical icon) gözükür.
- Koşul: `table.active_order_id !== null && order.status NOT IN ('closed', 'cancelled', 'void')`.
- Boş kartta YOK (kullanıcı sadece "yeni sipariş aç" akışına gider).

### 5.2 Layout (ekran görüntüsü 5)

Modal başlığı: **"Masa Adı: Masa 2"** + alt "Sipariş veya masa ile ilgili hızlı işlemler"

- **Üst (full-width primary):** **💳 Öde** (mor outline kart, geniş) — split ödeme route'una gider
- **Orta sıra (3 kart):**
  - **💳 Hızlı Öde** (outline kart) — QuickPaymentModal aç
  - **⇄ Masayı Taşı** (outline kart) — Transfer modal aç (PR-11)
  - **🖨 Yazdır** (outline kart) — manuel receipt print
- **Alt (full-width):** **↶ İptal** (kırmızı outline) — **bu menüyü kapatır**, sipariş İPTAL DEĞİL

### 5.3 Yönlendirme

- "Öde" → `navigate('/tables/:tableId/order/payment')` veya inline modal (v3'te modal-içi-modal, **doğrulanmamış**)
- "Hızlı Öde" → local state QuickPaymentModal trigger
- "Masayı Taşı" → TransferModal aç
- "Yazdır" → manuel print yazıcı seçim modal'ı

---

## 6. v5 Karar Önerileri (PR-7b öncesi ADR-014 amendment)

**Onaylanması gereken kararlar:**

### Karar 9.1 — Ekran ismi
- v3 modal başlığı "DETAYLI ÖDEME" (small-caps üstte) + "Masa N" (büyük başlık).
- v5 ADR-013 §7'de route `/tables/:tableId/order/payment`. Modal mı route mu?
- **Öneri:** Tam route ekran (full-screen page), ADR-013 §7 paritesi.

### Karar 9.2 — Kalan = 0 davranışı
- "Kaydet" butonu basılınca partial → modal AÇIK kalır
- Tüm kalemler ödenince **otomatik "Öde ve Kapat" enabled** + sticky mor banner "Ödeme tamamlandı, masayı kapatın"
- Auto-close YOK (kullanıcı kontrolü kalsın)

### Karar 9.3 — Bahşiş MVP mi?
- Pide/lokanta tarzı küçük restoranlarda bahşiş **nakit elden** gelir, sisteme girilmez.
- **Öneri:** Bahşiş v5.1 backlog. Migration eklemeyiz, payments.tip_cents YOK.

### Karar 9.4 — Partial-quantity kalem bölme
- v3 `payment_items.quantity REAL` ile 1 kalemin yarısı bir payer'a, yarısı diğerine.
- v5 `payment_items` junction sadece full-link (UNIQUE order_item_id).
- **Öneri:** MVP'de kalan. Pratik: aynı ürün 2 adet sipariş edildiyse zaten 2 ayrı `order_items` satırı; ikiye bölmek istenirse satır sayısı arttırılır.

### Karar 9.5 — "Hızlı Öde" sadece tam tutar
- v3'te Hızlı Öde her zaman `amount = order.total_cents`.
- v5'te aynı: kısmi ödeme yalnız Detaylı Öde ekranından.
- **Öneri:** v3 paritesi.

### Karar 9.6 — 3-nokta menüsü "İptal" semantiği
- Kırmızı buton **modal kapatır**, "siparişi iptal et" DEĞİL.
- Türkçe ambiguity tehlikesi. **Öneri:** Buton yazısı **"Vazgeç"** olarak değişsin (kırmızı tonu da yumuşak).

### Karar 9.7 — Ayrı Ayrı Öde "Geri Al" davranışı
- Tek-step undo (son `+` tıklamayı geri al)
- vs Stack tabanlı (her addItem hareketi geri alınabilir)
- **Öneri:** Stack tabanlı (kullanıcı 5 ürün ekledikten sonra hata fark ederse 5'ini de geri alabilir).

---

## 7. PR-7b kapsamı (öneri)

- `payment.*` i18n namespace
- `apps/web/src/features/payment/PaymentScreenPage.tsx` route
- `apps/web/src/features/payment/components/`:
  - `QuickPaymentModal.tsx` (4-op + Nakit/Kart)
  - `PaymentSummaryCards.tsx` (toplam/ödenen/kalan trio)
  - `PaymentItemsList.tsx` (sol panel, comp strikethrough)
  - `PaymentActionGrid.tsx` (4 işlem aksiyonu)
  - `PaymentTypeSelector.tsx` (Nakit/Kart 2 buton)
  - `SplitByPersonView.tsx` (Ayrı Ayrı Öde alt-ekran)
  - `TableActionsModal.tsx` (3-nokta menü, dolu masa kartında)
- `useCreatePayment` hook + idempotencyKey UUID üretimi
- `payments` cache invalidate stratejisi
- HCI gate (rush-hour: tek-tap Hızlı Öde, 3 saniyede ödeme)
- Türkçe UX gate (label tonları, "Vazgeç" vs "İptal")

PR-7b backend tarafında **eksik kalıyor:**
- Kısmi ödeme toplamı `orders.total_cents` ile karşılaştırma → server otoritesi → eksik amount → 400
- Bahşiş kolonu (kararlaştırılırsa)

PR-7c (sonrası):
- Print Agent integration (ADR-014 Karar 7) — `print_jobs` queue + receipt template
- E2E test (Sprint 9)
