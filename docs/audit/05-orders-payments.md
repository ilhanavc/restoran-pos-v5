# Blok 5 — apps/api: orders & payments (PARA-KRİTİK)

> Derin denetim serisi Blok 5 — serinin en yüksek titizlik bloğu (para-kritik çekirdek). **Tarih:** 2026-07-11 · **Branch:** `audit/05-orders-payments` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 3 paralel hat (A: security-reviewer — ödeme idempotency/void/authz · B: qa-engineer — para invariantı + durum makinesi + canlı concurrency · C: qa-engineer — order-merge + emit + domain) + ana-context çapraz doğrulama + severity kalibrasyonu. **Not:** Hat B iki kez API-hatasıyla (session-limit + connection-drop) kesildi; test dosyalarını yazdıktan sonra koptuğu için ana-context testleri koşup bulgularını doğruladı + raporunu tamamladı (hafıza dersi: kesik ajan "boş sonuç" ≠ temiz).
> **Canlı test:** SADECE `pos_test` (head 044) — prod/pos_dev'e HİÇ dokunulmadı. Prod kod DEĞİŞTİRİLMEDİ.
> **Testler:** **9 yeni test dosyası, 28 test (17 yeşil + 11 kasıtlı KIRMIZI).** apps/api paketi regresyonsuz.
> **Ham bulgu:** 11 (A:7, B:6, C:2, çakışanlar ortak) → konsolide **12 bulgu: 2 BLOCKER · 7 HIGH · 1 MEDIUM · 2 LOW.**

---

## 0. Yönetici özeti

**En kritik pozitif ile en kritik negatif yan yana:**

**✅ Çift-ödeme server tarafında İMKANSIZ + merge invariant temiz + float yok.** Serinin en büyük para-korkuları gerçekleşmedi: (1) aynı idempotency-key ile çift ödeme kaydı oluşamaz (Migration 022 unique index + order `FOR UPDATE` en fazla 1 satır garantiler); (2) adisyon birleştirmede kalem/ödeme kaybı veya çift sayım YOK (zincir merge dahil canlı doğrulandı); (3) tüm tutarlar integer kuruş — float sızıntısı sıfır; (4) kart PAN/CVV saklanmıyor (PCI); void authz + tenant scope + çift-void guard + aynı-gün kısıtı + void→reopen atomikliği sağlam.

**🔴 Ama 2 BLOCKER (deterministik para hatası, prod `restoranpos.org` CANLI):**
1. **MONEY-01 (YENİ)** — `addItems` recalc'ı iptal edilmiş kalemi dışlamıyor → bir kalem iptal edilip yeni kalem eklenince **iptal edilen kalemin tutarı "dirilir"**, adisyon şişer, müşteri iptal edilen ürüne para öder.
2. **DB-TX-01 (Blok 3'ten, route'ta canlı doğrulandı)** — aynı `insertItemsAndRecalc` bloğunun kardeş kusuru: kilitsiz SELECT + cancel race → "cancelled ama total>0 + aktif kalem".

Her iki BLOCKER da **tek fonksiyonda** (`orders.ts insertItemsAndRecalc`) — fix ortak: recalc'a `status!='cancelled'` filtresi + order SELECT'e `.forUpdate()`.

**🟠 İki HIGH teması:** (a) **'merged' statüsü terminal-guard'a dahil değil** → merged order'a hem phantom ödeme (PAY-02) hem yeni kalem (ORD-STATE-01) eklenebiliyor; (b) **overpay guard eksik** → `operation='pay'` (PAY-03) ve Mod B `PATCH status=paid` (MONEY-02) yollarında SUM(payments)>total kontrolü yok.

### En kritik 3
1. **MONEY-01** (BLOCKER) — iptal-dirilir para hatası. `insertItemsAndRecalc` recalc'ına status filtresi.
2. **DB-TX-01** (BLOCKER) — addItems kilitsiz + cancel race. `.forUpdate()`. (MONEY-01 ile kardeş, tek PR.)
3. **PAY-02 + ORD-STATE-01** (HIGH) — 'merged' terminal-guard eksik → phantom ödeme + hayalet kalem; ciro şişer, void edilemez.

---

## 1. Kapsam & yöntem

**Denetlenen:** `apps/api/src/routes/orders.ts` (1972) + `payments.ts` (579) + `domain/orders/resolveItemAttributes.ts` (189) + çapraz `packages/db/src/repositories/{orders,payments}.ts`, migrations 022/023/024/025/042/044, `order-status.ts` (TERMINAL_ORDER_STATUSES). Mevcut ~6800 LOC test okundu (desen), değiştirilmedi.
**Canlı:** pos_test + supertest + node/pg; Promise.all concurrency harness; izole tenant + FK-cleanup + pool.end.

**Severity kalibrasyon notu:** MONEY-01 → BLOCKER (deterministik yanlış para hesabı, race değil — cancel-then-add sırası yeter). DB-TX-01 Blok 3'te repo-BLOCKER'dı; burada route/uçtan-uca canlı doğrulandı — çift-sayım değil, tekrar-doğrulama. PAY-01 (idempotency race) → HIGH değil BLOCKER değil: çift-ödeme İMKANSIZ (unique+lock), yalnız kaybeden istek 500/opaque alıyor (kontrat kırık) → HIGH.

---

## 2. Bulgular

### 2.1 BLOCKER (2) — canlı pos_test'te kanıtlı, ikisi de `insertItemsAndRecalc`'ta

### [BLOCKER] [BUG] `addItems` recalc'ı iptal edilmiş kalemi dışlamıyor → iptal tutarı "dirilir" (ID: MONEY-01)
- **Dosya:** `packages/db/src/repositories/orders.ts:586-591` (`insertItemsAndRecalc` recalc subquery)
- **Kanıt (ana-context + canlı):** Recalc `total_cents = (SELECT COALESCE(SUM(total_cents),0) FROM order_items WHERE order_id=$1)` — **status filtresi YOK**. Karşıt kanıt: `mergeInto:458` recalc'ı `SUM WHERE status!='cancelled' AND !is_comped` KULLANIYOR (asimetri). `updateItemTx` de cancelled'ı düşürüyor (satır 231). `payments-money.findings.test.ts` MONEY-01 KIRMIZI (canlı).
- **Senaryo:** Açık adisyon: kalem A (100₺) + B (50₺) = 150. Garson A'yı iptal eder (item-level cancel → total 50). Yeni kalem C (30₺) eklenir → `addItems` recalc'ı `SUM(order_id)` = A(100)+B(50)+C(30) = **180** (olması gereken 80); iptal edilen A'nın tutarı geri geldi.
- **Etki:** Adisyon yanlış şişer → müşteri iptal edilen üründen para öder = para doğruluğu ihlali (CLAUDE.md "asla yanlış para"). Restoranda tipik akış (yanlış ürün gir→iptal→doğru ürün ekle).
- **Öneri:** recalc subquery'sine `WHERE status != 'cancelled' AND is_comped = false` ekle (mergeInto paritesi). · **Etiket:** MVP-fix (BLOCKER; DB-TX-01 ile aynı fonksiyon, tek PR)

### [BLOCKER] [BUG] `addItems`/`updateItemTx` kilitsiz SELECT + cancel race → tutarsız state (ID: DB-TX-01, Blok 3'ten route-doğrulandı)
- **Dosya:** `orders.ts:702-707,790-795` (kilitsiz) vs `payOrderTx:899`/`cancelOrder:962` (`.forUpdate()`)
- **Kanıt:** Blok 3'te repo-BLOCKER olarak raporlandı (PR #331); Blok 5'te `order-state.findings.test.ts` DB-TX-01 ile route/DB-seviyesi deterministik kanıt (KIRMIZI): eşzamanlı addItems+cancel → `status='cancelled' ama total_cents>0 + aktif kalem`.
- **Etki:** İptal edilmiş sipariş mutfağa "iptal" görünüp fişte tutar çıkarabilir. · **Öneri:** order SELECT'e `.forUpdate()`. · **Etiket:** MVP-fix (BLOCKER; MONEY-01 ile kardeş)

### 2.2 HIGH (7)

### [HIGH] [BUG] 'merged' statüsü ödeme terminal-reddine dahil değil → phantom ödeme (ID: PAY-02)
- **Dosya:** `routes/payments.ts:220-230` (terminal reddi yalnız `paid|cancelled|void`) · **Kanıt (canlı):** merge kaynağı orderId'ye (`status='merged', total=0`) `POST /payments` → 201 phantom ödeme; void edilemez (voidPayment order='merged'→PAYMENT_VOID_ORDER_TERMINAL) → sıkışır + ciro şişer + re-merge bloklanır. `payments-money.findings.test.ts` PAY-02 KIRMIZI.
- **Öneri:** kanonik `TERMINAL_ORDER_STATUSES`'e 'merged' dahil et. · **Etiket:** MVP-fix

### [HIGH] [BUG] 'merged' order'a yeni kalem eklenebiliyor (ID: ORD-STATE-01, PAY-02 ile aynı kök)
- **Dosya:** `orders.ts` addItems terminal-guard · **Kanıt (canlı):** merged order'a `POST /orders/:id/items` → 200 (kalem eklenebiliyor); beklenen 409. `order-state.findings.test.ts` ORD-STATE-01 KIRMIZI. · **Öneri:** PAY-02 ile birlikte 'merged'ı terminal say. · **Etiket:** MVP-fix

### [HIGH] [BUG] Kısmi ödeme (`operation='pay'`, close değil) overpay guard yok (ID: PAY-03)
- **Dosya:** `payments.ts:380-433` (overpay guard yalnız `closeOrder===true`) · **Kanıt (canlı):** 100₺ order'a scope='order' `pay amountCents=999999` → 201, order açık kalır; DB'de yalnız `amount>0` CHECK var. `payments-money.findings.test.ts` PAY-03 KIRMIZI. · **Öneri:** close-dışı yola da `SUM(active)+amount ≤ total` guard'ı. · **Etiket:** MVP-fix

### [HIGH] [BUG] Mod B `PATCH /orders/:id status=paid` overpay guard yok (ID: MONEY-02, PAY-03 ile aynı aile)
- **Dosya:** `orders.ts` Mod B status geçişi · **Kanıt (canlı):** SUM(payments)>total_cents iken de order paid'e kapanabiliyor. `payments-money.findings.test.ts` MONEY-02 KIRMIZI. · **Öneri:** paid geçişinde SUM≤total invariantı. · **Etiket:** MVP-fix

### [HIGH] [ROB] `mergeInto` void'lenmiş ödemeyi "aktif" sayıyor → meşru merge 409 (ID: PAY-04/DB-TX-02)
- **Dosya:** `orders.ts:1578-1586` (ORDER_HAS_PAYMENTS count'unda `voided_at IS NULL` yok) · **Kanıt (Hat A+C, canlı):** ödeme→void→merge → yanlış-pozitif 409; kaynak VE hedef simetrik kırık. `merge-findings.test.ts` PAY-04 ×2 KIRMIZI. Blok 3 DB-TX-02 route'ta doğrulandı. · **Öneri:** count'a `.where('voided_at','is',null)`. · **Etiket:** MVP-fix

### [HIGH] [SEC/BUG] `kitchen.orderSent` emit şema-uyumsuz + helper-bypass (ID: API-RT-01, Blok 2 SD-T-B-01 / Blok 4 kök)
- **Dosya:** `orders.ts:599,1013,1147` (3 site; itemStatusChanged:1954 temiz) · **Kanıt (canlı socket):** gerçek dine-in POST → yakalanan payload `{items:[{...quantity}]}` → `KitchenOrderSentPayloadSchema.safeParse()` FAIL (`qty` + zorunlu `tableId` bekliyor). `emit-findings.test.ts` ORD-RT-01 KIRMIZI. Bugün KDS `quantity` okuduğu için çalışıyor → latent. · **Öneri:** `emitTenant` parse-path'ine taşı + şema-tel hizala. · **Etiket:** ADR-gerekli (Blok 4 emit tek-path kararıyla)

### [HIGH] [ROB] Ödeme idempotency-race recovery'si aborted-tx'te 500 veriyor (ID: PAY-01/DB-TX-05)
- **Dosya:** `repositories/payments.ts:270` (recovery SELECT aynı tx'te) · **Kanıt (canlı):** aynı key 2 eşzamanlı POST → kaybeden 23505→tx aborted→recovery SELECT 25P02→**opaque 500** (mapPgError 25P02 tanımıyor); `pay_and_close` yolunda 409. `payments-money.findings.test.ts` PAY-01+PAY-05 KIRMIZI. **Çift-ödeme OLMAZ** (unique+FOR UPDATE) — kırık olan replay *kontratı*. Blok 3 DB-TX-05 route'ta doğrulandı. · **Öneri:** SAVEPOINT / `ON CONFLICT DO NOTHING RETURNING`. · **Etiket:** MVP-fix

### 2.3 MEDIUM (1)
- **PAY-05** [ROB] concurrent `pay_and_close` same-key → kaybeden ORDER_INVARIANT_VIOLATED 409 (200-replay değil). PAY-01 ile birlikte çözülür (SAVEPOINT). · v5.1/MVP-fix.

### 2.4 LOW (2)
- **PAY-06** [SEC] İstemci-üretimli idempotency-key reuse → replay dönüşünde `order_id===req.body.orderId` doğrulanmıyor (yanlış-order sessiz replay). Öneri: uyuşmazsa 409. v5.1.
- **PAY-07** [SEC/QUAL] Ödeme create'te per-order ABAC ownership yok (garson tenant içi herhangi order'ı öder) — ADR-027 §7e ile muhtemelen KASITLI; ADR'de açıkça belgele. v5.1.

---

## 3. Temiz çıkan alanlar (canlı kanıtlı — güçlü)

- **🎯 Çift-ödeme server tarafında İMKANSIZ:** Migration 022 `UNIQUE(tenant_id, idempotency_key)` + order `FOR UPDATE` → aynı key yarışında en fazla 1 payment satırı (canlı). Kırık olan yalnız kaybeden isteğin hata-kontratı (PAY-01), veri değil.
- **🎯 Merge invariant TEMİZ:** A(2 kalem/100₺)+B(1/50₺)→150₺+3 kalem, item-id kümesi birebir korunmuş; kayıp/çift YOK; zincir merge (2 ardışık) de temiz (canlı, `merge-audit.test.ts`).
- **🎯 Para = integer kuruş, float sızıntısı SIFIR** (toFixed/parseFloat/`*`/`/` ile para grep temiz — Hat A+B).
- **void tam güvenli:** authz (admin/cashier; waiter/kitchen 403), tenant-scope/IDOR (404), çift-void (FOR UPDATE+voided_at), aynı-gün guard (PG store_date), void→reopen atomik+rollback (canlı).
- **overpay reddi close-yolunda çalışıyor** (tam-eşitlik + void SUM-dışlama); 0/negatif reddi (zod refine + CHECK); payment_items qty cap.
- **resolveItemAttributes** para aritmetiği doğru (pozitif+negatif extraPriceCents order-toplamı düzeyinde) (canlı).
- **takeaway tableId** iki-katmanlı savunmayla güvenli (Blok 2 SD-T-A-02 route'ta tetiklenmiyor).
- **kart PAN/CVV saklanmıyor** (payment_type enum); **audit PII-safe** (note/payer_label audit'e girmez); comped item ödemeye giremiyor (block_comped_item trigger).
- **durum makinesi kısmen sağlam:** cancelled→cancel 409, terminal→ödeme reddi (merged HARİÇ — PAY-02/ORD-STATE-01).

## 4. Eklenen test envanteri (9 dosya, 28 test)

| Hat | Dosya | Test | Sonuç |
|---|---|---|---|
| B | payments-money.audit / order-state.audit | 6+4 | ✅ 10 yeşil |
| B | payments-money.findings (PAY-01/02/03/05, MONEY-01/02) | 6 | 🔴 kırmızı |
| B | order-state.findings (ORD-STATE-01, DB-TX-01) | 2 | 🔴 kırmızı |
| C | merge-audit / emit-audit / attribute-audit | 2+2+2 | ✅ 6 yeşil (+1 emit yeşil kanıt) |
| C | merge-findings (PAY-04 ×2) / emit-findings (ORD-RT-01) | 2+1 | 🔴 kırmızı |

**Kırmızı → bulgu (11):** MONEY-01 · DB-TX-01 · PAY-01 · PAY-02 · PAY-03 · PAY-05 · MONEY-02 · ORD-STATE-01 · PAY-04 ×2 · ORD-RT-01.
**Konsolide koşu (pos_test):** 28 test → **17 yeşil + 11 kırmızı**; `tsc --noEmit` temiz; eslint temiz. Mevcut orders/payments suiti (56/56 hedefli) regresyonsuz. Canlı yalnız pos_test (prod/pos_dev dokunulmadı).

## 5. Etiket özetleri

- **MVP-fix (BLOCKER — öncelik):** MONEY-01 + DB-TX-01 (tek PR: `insertItemsAndRecalc`'a status-filtre + `.forUpdate()`).
- **MVP-fix (HIGH):** PAY-02+ORD-STATE-01 ('merged' terminal-guard), PAY-03+MONEY-02 (overpay guard iki yol), PAY-04 (merge void filtresi), PAY-01+PAY-05 (idempotency SAVEPOINT).
- **ADR-gerekli:** API-RT-01 (emit tek-path — Blok 4 kararıyla).
- **v5.1-backlog:** PAY-06, PAY-07.

## 6. Sonraki bloklara / fix fazına devir

- **Blok 6/7:** overpay guard'ın diğer status-geçiş yollarında da olup olmadığı; reports'un merged/void filtreleri (PAY-02 phantom ödeme ciroya sızıyor mu — Blok 7).
- **Blok 13 (fix fazı):** İki BLOCKER tek "orders-recalc-lock" PR'ı; HIGH'lar "orders-payments-guards" PR'ı (merged-terminal + overpay + merge-void-filter + idempotency-savepoint); emit ADR'ı Blok 4 ile ortak.
- **Blok 3 bağlantısı:** DB-TX-01/02/05 repo-BLOCKER/HIGH'ları burada route-seviyesinde uçtan-uca doğrulandı — repo-fix'leri route davranışını da düzeltir.

## 7. Blok DoD durumu

- [x] orders.ts (1972) + payments.ts (579) + domain + repo çapraz okundu (3 hat + ana-context; 2 BLOCKER + kritik HIGH'lar kaynak/canlı teyitli)
- [x] Idempotency/void/atomiklik/race denetlendi — **çift-ödeme imkansız + merge invariant temiz** (ana para-korkuları temiz)
- [x] Bulgular A.4 (11 ham → 12 konsolide; kalibrasyon + Hat B recovery şeffaf)
- [x] Her BLOCKER/HIGH için kırmızı karakterizasyon testi (11 kırmızı, canlı pos_test)
- [x] Canlı concurrency harness **yalnız pos_test** (prod/pos_dev dokunulmadı)
- [x] Prod kod değişmedi; mevcut testler değişmedi; float sızıntısı yok
- [ ] **2 BLOCKER** (MONEY-01 yeni + DB-TX-01 route-doğrulandı) — fix onay bekliyor; tek fonksiyon (`insertItemsAndRecalc`) tek PR; Blok 13 sentezine
