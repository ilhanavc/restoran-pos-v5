# Blok 8 — apps/api: print pipeline (enqueue + template)

> Derin denetim serisi Blok 8. **Tarih:** 2026-07-12 · **Branch:** `audit/08-print-pipeline` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 2 paralel hat (A: qa-engineer — enqueue/routing/idempotency · B: qa-engineer — template render/CP857/tz) + ana-context çapraz doğrulama + severity kalibrasyonu.
> **Canlı test:** enqueue testleri `pos_test` (head 044); template testleri saf fonksiyon. Prod/pos_dev'e dokunulmadı. Prod kod DEĞİŞTİRİLMEDİ.
> **Testler:** **4 yeni test dosyası, 39 test (29 yeşil + 10 kasıtlı KIRMIZI).**
> **Ham bulgu:** 6 (A:3, B:3) → konsolide **7 bulgu (line() QUAL ayrı): 0 BLOCKER · 2 HIGH · 3 MEDIUM · 2 LOW.**

---

## 0. Yönetici özeti

**Fiş üretim çekirdeği sağlam — CP857 Türkçe eksiksiz, tz doğru, routing çalışıyor; iki gerçek HIGH kenar durumda.**

**✅ Güçlü çıkanlar (canlı/kod doğrulandı):** CP857 bozulma **YOK** (tüm serbest metin sanitize→encode zincirinden eksiksiz geçiyor — Blok 1 encoder entegrasyonu sağlam); **tz DOĞRU** ve Blok 7 store-date UTC bulgusundan **bağımsız** (`format-receipt-datetime.ts` gerçek `Intl`+IANA kullanıyor, ayrı modül); kategori routing çekirdeği (`kitchen_print` ayrımı) doğru; 0-kalem ve 45-kalem uç durumları temiz; tenant scope (cross-tenant 404, sızıntı yok); `threeColFit` (ürün adı sabit-genişlik kırpma) taşma-güvenli.

**🟠 2 HIGH:**
1. **P8-ENQ-08** — adisyon fişi kalem SELECT'inde status filtresi yok → **iptal edilmiş kalem müşteri fişinde satır+fiyat olarak basılıyor** (orders.total dışlasa da). **Blok 5 MONEY-01'in fiş-katmanı ikizi** (aynı "status-filtresiz kalem sorgusu" ailesi).
2. **P8-TPL-01** — `twoCol()` sağ-kolon ≥48 karakter olunca `maxLeft` negatif → `slice(0,-1)` + negatif gap → satır 48 kolonu aşar (fiş fiziksel hizalama bozulur).

**Kalibrasyon:** P8-ENQ-09 (kitchen enqueue dedup yok → retry'da çift fiş) HIGH→MEDIUM: ADR-004 §A3.4'te **bilinçli reddedilmiş** + Migration 039'da "v5.1'e ertelendi" belgeli — yeni bug değil; ama prod artık canlı olduğundan kararın yeniden değerlendirilmesi notu.

### En kritik 3
1. **P8-ENQ-08** (HIGH) — iptal kalem adisyon fişinde. Fix: bill items SELECT'e `status != 'cancelled'` (MONEY-01 ile aynı aile).
2. **P8-TPL-01** (HIGH) — twoCol 48-kolon taşması. Fix: `maxLeft` clamp + doğru slice.
3. **P8-ENQ-09** (MEDIUM) — kitchen çift-fiş (retry); ADR-004 §A3.4 prod-canlı yeniden-değerlendirme.

---

## 1. Kapsam & yöntem
**Denetlenen:** `apps/api/src/print/` — enqueue-kitchen-job(222), enqueue-bill-job(186), templates/{bill-receipt(215), kitchen-receipt(340), receipt-layout(96)}, format-receipt-datetime(36). Çapraz: shared-domain/printer (Blok 1), migrations 034/036/038/039, orders/payments/kds enqueue çağrı noktaları.
**Canlı:** pos_test enqueue senaryoları; template snapshot/unit.

---

## 2. Bulgular

### 2.1 HIGH (2)

### [HIGH] [BUG] Adisyon fişi kalem SELECT'i iptal edilmiş kalemi dışlamıyor (ID: P8-ENQ-08)
- **Dosya:** `apps/api/src/print/enqueue-bill-job.ts:65-71` · **Kanıt (ana-context doğrulandı):** items SELECT `where tenant_id + order_id + orderBy created_at` — **status filtresi YOK**; cancelled kalem product_name/quantity/total_cents ile fişe giriyor. `orders.total_cents` onu dışlar (MONEY-01 hariç) → **fişte kalem satırları toplamı ≠ fiş toplamı** → müşteri-yüzlü finansal belge tutarsızlığı. `print-enqueue-findings.test.ts` KIRMIZI.
- **Aile:** Blok 5 MONEY-01 (recalc status-filtresiz) + Blok 8 P8-ENQ-08 (bill items status-filtresiz) — aynı kök desen.
- **Öneri:** items SELECT'e `.where('status','!=','cancelled')` (order-level cancel'da tüm kalemler zaten cancelled → boş fiş beklenir; kontrol et). · **Etiket:** MVP-fix

### [HIGH] [BUG] `twoCol()` 48-kolon taşması — uzun sağ-kolon metni (ID: P8-TPL-01)
- **Dosya:** `apps/api/src/print/templates/receipt-layout.ts:51-54` · **Kanıt (ana-context doğrulandı):** `maxLeft = WIDTH(48) - right.length - 1`; right ≥48 → maxLeft negatif → `left.slice(0, negatif)` (kırpma değil kuyruk-atma) + `gap` negatif → padEnd no-op → satır 61-63 bayt. 3 gerçek yol: kök fn, mutfak Layout A uzun porsiyon/varyant adı, bill/kitchen uzun bölge+masa etiketi. `threeCol/threeColFit` sabit-genişlik → MUAF (kontrast test).
- **Etki:** Fiş fiziksel hizalama bozulur (yazıcıda satır kayar/sarar). Nadir uzun-metin tetikliyor; çökme değil, belge bütünlüğü.
- **Kanıt testi:** `templates-findings.test.ts` KIRMIZI (8 test — twoCol yolları). · **Öneri:** `maxLeft = Math.max(0, ...)` + `gap = Math.max(1, ...)`; right'ı da sınırla. · **Etiket:** MVP-fix

### 2.2 MEDIUM (3)

### [MEDIUM] [ROB] Kitchen enqueue dedup yok → retry'da çift mutfak fişi (ID: P8-ENQ-09)
- **Dosya:** `enqueue-kitchen-job.ts` · **Kanıt (canlı):** aynı gönderim 2 kez tetiklenirse (network retry/çağıran hatası) 2 bağımsız `print_jobs` satırı = fiziksel fiş 2 kez. `print-enqueue-findings.test.ts` KIRMIZI (`expected 2 to be 1`). **Bilinçli karar:** ADR-004 §A3.4 reddetmiş + Migration 039 yorumu "v5.1'e ertelendi". · **Öneri:** Prod-canlı olduğundan ADR-004 §A3.4'ü yeniden değerlendir (job dedup key: order_id + sent-item-set hash). · **Etiket:** v5.1-backlog (ADR yeniden-değerlendirme)

### [MEDIUM] [ROB] `orders.ts` KDS-hook enqueue çağrıları try/catch'siz (ID: P8-ENQ-10, doğrulanmamış)
- **Dosya:** `orders.ts` 3 KDS-hook noktası · **Kanıt (kod-tespiti):** payments.ts fire-and-forget deseninin aksine orders.ts enqueue çağrıları korumasız → enqueue hatası zaten commit edilmiş siparişi 500'e çevirebilir (sipariş kaydedildi ama response hata). Canlı fault-injection yazılmadı (prod-kod değişikliği gerektirir) → doğrulanmamış. · **Öneri:** enqueue'yu fire-and-forget + logla (payments deseni). · **Etiket:** MVP-fix

### [MEDIUM] [BUG] `format-receipt-datetime` geçersiz ISO'da uncaught throw (ID: P8-TPL-02)
- **Dosya:** `format-receipt-datetime.ts` · **Kanıt (canlı):** try/catch yalnız tz'yi koruyor; iso bozuksa fallback da `RangeError: Invalid time value` fırlatıyor. Mevcut 2 çağıran her zaman `new Date().toISOString()` geçtiği için **şu an prod'da ULAŞILAMAZ** ama fonksiyon sözleşmesi kırık. · **Öneri:** iso parse'ı guard'la, fallback güvenli string. · **Etiket:** v5.1-backlog

### 2.3 LOW (2)
- **P8-TPL-03** [BUG] presence-check ham metinde, render sanitize-sonrası → kontrol-baytından ibaret not/seçenek/müşteri-adı guard'ı geçip sanitize sonrası boşalıyor → "  ()" / "Müşteri : " hayalet satır. Kozmetik, çökme yok. v5.1.
- **P8-QUAL-01** [QUAL] `line()` helper bill-receipt + kitchen-receipt'te birebir kopya (duplikasyon); `any` sıfır. v5.1.

*(INFO — formal bug değil, green/doküman testiyle sabitlendi: remainingCents negatifken clamp yok; büyük tutar AMT_W aşımında en-anlamlı-haneler korunuyor.)*

---

## 3. Temiz çıkan alanlar (kanıtlı)
- **🎯 CP857 Türkçe bozulma YOK** — tüm serbest metin (ürün adı/masa/not) sanitize→encode zincirinden eksiksiz; ğĞİışçöü korunuyor; desteklenmeyen karakter (emoji/€) sanitize'a düşüyor (fişi bozmuyor); kontrol baytı sızmıyor (Blok 1 dersi tutuyor).
- **🎯 tz DOĞRU + Blok 7'den bağımsız** — `format-receipt-datetime` gerçek Intl+IANA (Europe/Istanbul); `store-date.ts` ayrı UTC modül (kasıtlı, sipariş sıralaması için); gece yarısı geçişi doğru (canlı).
- **Kategori routing çekirdeği** (`kitchen_print` true/false ayrımı) doğru; 0-kalem + 45-kalem uç durumları; tenant scope (cross-tenant 404); reprint non-idempotency kasıtlı (P8-ENQ-09 ayrı).
- **`threeCol`/`threeColFit`** (ürün adı·adet·tutar sabit-genişlik) taşma-güvenli — twoCol kusurundan muaf (kontrast test).
- **Migration 036/039 attempts/retry_at kontratı** doğru; enjeksiyon yüzeyi yok; `any` sıfır.

## 4. Eklenen test envanteri (4 dosya, 39 test)
| Hat | Dosya | Test | Sonuç |
|---|---|---|---|
| A | print-enqueue-audit | 7 | ✅ yeşil |
| A | print-enqueue-findings (P8-ENQ-08/09) | 2 | 🔴 kırmızı |
| B | templates-audit | 22 | ✅ yeşil |
| B | templates-findings (P8-TPL-01/02/03) | 8 | 🔴 kırmızı |

**Kırmızı → bulgu (10):** P8-ENQ-08/09 (2) · P8-TPL-01/02/03 (8).
**Koşu:** 39 test → 29 yeşil + 10 kırmızı; tsc + eslint temiz; enqueue yalnız pos_test.

## 5. Etiket özetleri
- **MVP-fix:** P8-ENQ-08 (bill status filtresi — MONEY-01 ile aile), P8-TPL-01 (twoCol clamp), P8-ENQ-10 (enqueue try/catch).
- **v5.1-backlog:** P8-ENQ-09 (ADR-004 §A3.4 dedup yeniden-değerlendirme), P8-TPL-02, P8-TPL-03, P8-QUAL-01.

## 6. Sonraki bloklara devir
- **Blok 11 (print-agent):** P8-ENQ-09 dedup kararı agent tarafıyla birlikte (job claim idempotency).
- **Blok 13 (fix fazı):** P8-ENQ-08 + Blok 5 MONEY-01 tek "status-filtresiz-kalem" PR'ı; P8-TPL-01 twoCol layout fix; P8-ENQ-09 dedup ADR-004 amendment.

## 7. Blok DoD durumu
- [x] print/ 6 dosya + çapraz okundu (2 hat + ana-context; HIGH'lar kaynak/canlı teyitli + kalibre)
- [x] Fiş düzeni/CP857/tz/routing/idempotency denetlendi — **CP857 temiz + tz doğru + routing çalışıyor**
- [x] Bulgular A.4 (6 ham → 7 konsolide; P8-ENQ-09 kalibrasyonu şeffaf: ADR-004 §A3.4 bilinçli)
- [x] Her HIGH için kırmızı test (P8-ENQ-08, P8-TPL-01 canlı/unit)
- [x] Canlı testler yalnız pos_test; prod kod değişmedi; bağımlılık yok
- [ ] BLOCKER yok; 2 HIGH Blok 13 sentezine (status-filtresiz-kalem + twoCol PR'ları)
