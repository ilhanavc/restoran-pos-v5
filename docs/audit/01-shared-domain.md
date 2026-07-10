# Blok 1 — packages/shared-domain (para/vergi/encoding çekirdeği)

> Derin denetim serisi (deep-audit-master-prompt.md) Blok 1. **Tarih:** 2026-07-10 · **Branch:** `audit/01-shared-domain` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 3 paralel qa-engineer hattı (A: money/tax/payment/order/order-no · B: printer/CP857/ESC-POS · C: phone/pii-mask/audit/validation/table/menu/user/cron) + ana-context çapraz doğrulama (tüm BLOCKER/HIGH adayları kaynak kod üzerinde ikinci kez teyit edildi).
> **Kurallar:** Prod kod DEĞİŞTİRİLMEDİ (rapor önce, düzeltme onayla). Yalnız additive test eklendi: **22 yeni test dosyası, 237 test (203 yeşil + 34 kasıtlı KIRMIZI karakterizasyon)**. Kırmızılar BLOCKER/HIGH bulguları kilitler; fix sonrası yeşile döner ve regresyon paketine geçer.
> Baseline (Blok 0): paket 233 test / %97.19 stmt coverage / hepsi yeşildi.

---

## 0. Yönetici özeti

**38 bulgu: 0 BLOCKER · 20 HIGH · 7 MEDIUM · 8 LOW · 3 NIT.**

Paketin matematik çekirdeği (CP857 tablosu, VAT round-trip, canCloseOrder eşitlik mantığı, tablo durum-matrisi) **doğru**. Sorunlar üç temada toplanıyor:

1. **🔴 Canlı-tetiklenebilir fiş bozulması (SD-P-01/02):** `sanitizeForCP857` canlı fiş hattında (mutfak + adisyon) her gün çalışıyor; NFD-formda Türkçe metin → `"U?sku?dar"`, iOS akıllı-kesme işareti → `"Kadıköy?e"`. Blok 1'in canlı yüzeyi en geniş iki bulgusu; ikisi de tek satırlık, düşük riskli fix.
2. **🟠 KVKK savunma katmanlarında yazım-uyumsuzluğu zinciri (SD-S-01/13 + SD-S-09):** audit sanitizer canlı (her mutation'da `writeAudit`); ama TS DENY_LIST, DB CHECK ve gerçek kolon adı (`raw_phone` / `phone_raw`) birbirinden habersiz evrilmiş. Bugün whitelist (default-deny) tutuyor; ikinci savunma hattı fiilen delik.
3. **🟡 "Yazılmış + %97 test edilmiş + HİÇ bağlanmamış" domain katmanı (SD-M-08/10, SD-S-14):** para/policy export'larının büyük kısmı (money 18/20, pii-mask 3/3, policy 15/26) canlıda sıfır çağrı alıyor; gerçek para matematiği `apps/api/routes/orders.ts`'te inline duplike yaşıyor, `users.ts` rol kontrolü `canManageUsers`'tan DİVERGE inline mantık kullanıyor. Bu dormant yüzeyin İÇİNDE 7 gerçek para-bug'ı (SD-M-01…07: NaN bypass, negatif-indirim/comp şişirme, parseMoney 1000×) mayın olarak duruyor — bugün patlamıyor çünkü kod çağrılmıyor; **wiring öncesi fix zorunlu ön-koşul**.

**BLOCKER'ın 0 olmasının nedeni tesadüf değil, mimari:** API sınırındaki zod şemaları (`MoneyCentsSchema .int().nonnegative()`, `quantity .int().positive()`) ve sanitizer whitelist'i bugün tüm bulunan açıkların önünü kesiyor. Domain katmanının kendisi "authoritative" iddiasına rağmen savunmasız — savunma tek katmanda (boundary) yaşıyor.

### En kritik 3 bulgu (sonraki bloklara taşınan öncelik)
1. **SD-P-01 + SD-P-02** — canlı fişte sessiz metin bozulması (NFD + akıllı tırnak). MVP-fix, tek satırlık.
2. **SD-S-01 + SD-S-13** — `raw_phone` hiçbir deny katmanında yok; TS↔DB listeleri drift'li ("senkron" yorumu yanlış). MVP-fix (TS) + migration (DB, Blok 3'e devir).
3. **SD-M-01…07 + SD-S-14 kümesi** — dormant para/policy katmanı: ya bağla (fix'lerle birlikte) ya sil; karar ADR ister (aşağıda "ADR-gerekli" listesi).

---

## 1. Kapsam & yöntem

**Denetlenen dosyalar (prod):** money, tax, order, order-no, payment, table, menu, user, phone, pii-mask, validation, audit/{sanitizer,deny-list,allowed-keys,types,index}, printer/{encode-cp857,sanitize-cp857,esc-pos,index}, cron/lock-ids, index (barrel). Toplam ~1 573 LOC + 15 mevcut test dosyası.
**Okunan ADR'lar:** ADR-003 (§10 ödeme/ikram, §12 audit), ADR-004 (+Amd3/Amd5), ADR-014, ADR-016 §11, ADR-021, ADR-024, ADR-029, ADR-033.
**Çapraz-doğrulama için okunan kapsam-dışı dosyalar** (düzenlenmedi): `apps/api/src/routes/{orders,customers/index,users,tables,products}.ts`, `apps/api/src/print/templates/*`, `apps/api/src/audit/writeAudit.ts`, `packages/db/src/repositories/payments.ts`, `packages/db/migrations/000_init.sql`, `docs/compliance/kvkk-data-inventory.md`.
**Sınır-zorlama:** MAX_SAFE_INTEGER, NaN/±Infinity/-0/null/undefined, seeded-PRNG property testleri (para birleşme/değişme, VAT invariantları, 500-1000 iterasyon), CP857 referans-byte hardcode + bijektiflik, NFD/emoji/lone-surrogate/ESC-injection, unicode rakamlar, circular reference, advisory-lock uniqueness. (fast-check eklenmedi — bağımlılık-ekleme yasağı; inline seeded LCG kullanıldı.)

**Severity kalibrasyon notu:** Hat C, 4 bulguyu BLOCKER önerdi (SD-S-08/01/02/03). Konsolidasyonda A.4 tanımı ("aktif veri kaybı / güvenlik ihlali / para hatası") esas alınarak HIGH/MEDIUM'a çekildi — gerekçeler ilgili bulguların içinde. Hat A'nın kendi kalibrasyonu (dormant kod → BLOCKER değil HIGH) zaten aynı ilkeyle uyumluydu.

---

## 2. Bulgular

### 2.1 HIGH (20)

#### Canlı yüzeyli (bugün tetiklenebilir)

### [HIGH] [BUG] NFD (ayrıştırılmış) Türkçe karakterler fişte kelime-içi sahte "?" üretiyor (ID: SD-P-01)
- **Dosya:** `packages/shared-domain/src/printer/sanitize-cp857.ts:32-46` (encode-cp857.ts de `.normalize()` çağırmıyor)
- **Kanıt:** `sanitize-cp857.findings.test.ts` 3 test KIRMIZI: `'İstanbul'.normalize('NFD')` → `'I?stanbul'`; `'Üsküdar, Şemsi Paşa'` (NFD) → `'U?sku?dar, S?emsi Pas?a'`. Combining mark (U+0307 vb.) TRANSLIT'te ve CP857_MAP'te yok → `?`. `ı` hariç 11/12 Türkçe harf etkileniyor.
- **Senaryo:** Kopyala-yapıştır / bazı IME'ler / macOS kökenli metin NFD gelirse müşteri adresi/notu fişte bozuk basılır.
- **Etki:** Kurye adresi okuyamayabilir; sessiz bozulma (throw yok) — encoder'ın "görünür hata" felsefesine aykırı sınıf.
- **Öneri:** `sanitizeForCP857` girişine `text.normalize('NFC')` — tek satır; NFC sonrası bileşik harfler CP857_MAP ile eşleşir.
- **Etiket:** MVP-fix

### [HIGH] [BUG] Tipografik (akıllı) tırnak/kesme işareti fişte "?" oluyor (ID: SD-P-02)
- **Dosya:** `packages/shared-domain/src/printer/sanitize-cp857.ts:22-30` (TRANSLIT tablosu)
- **Kanıt:** `sanitize-cp857.findings.test.ts` 2 test KIRMIZI: U+2019 → `'Kadıköy?e teslim'`; U+201C/201D → `'?Acılı? olsun'`.
- **Senaryo:** iOS "Akıllı Noktalama" varsayılan AÇIK — garson mobil app'te not yazarken `'` otomatik U+2019 olur. Türkçe imlada kesme işareti günlük kullanım ("Kadıköy'e").
- **Etki:** Mutfak/teslimat fişinde okunabilirlik bozulması; em-dash fix'inin (S91) birebir eksik kalmış kardeşi.
- **Öneri:** TRANSLIT'e 4 giriş: `'’':"'", '‘':"'", '“':'"', '”':'"'`.
- **Etiket:** MVP-fix

### [HIGH] [SEC] `encodeCP857`'nin belgelenen "safety-net" iddiası kontrol-baytı (ESC/GS) enjeksiyonu için GEÇERSİZ (ID: SD-P-03)
- **Dosya:** `packages/shared-domain/src/printer/encode-cp857.ts:65-69`; iddia: sanitize-cp857.ts:16-17 + ADR-004 Amd5 K10
- **Kanıt:** `encode-cp857.findings.test.ts` 2 test KIRMIZI: `code < 0x80` dalı ESC (0x1B), GS (0x1D), NUL dahil TÜM C0 baytlarını throw'suz geçiriyor. "Sanitize atlanırsa throw görünür kılar" iddiası yalnız eşlenemeyen-Unicode için doğru.
- **Senaryo:** Gelecekte bir template alanı sanitize'siz kalırsa, kullanıcı metnindeki `\x1B@` yazıcıya gerçek komut (reset/kesim) olarak gider — sessizce.
- **Etki:** Bugün aktif sömürü YOK (kitchen-receipt + bill-receipt'te her dinamik alan sanitize'den geçiyor — grep + tam okuma ile doğrulandı). Dokümante güvence kısmen yanlış → tek-nokta-hata riski.
- **Öneri:** (1) Minimal: docstring'i düzelt (doküman-only). (2) Savunma-derinliği: encode'a `code < 0x20 || code === 0x7f` throw'u ekle — throw kontratını genişletir, **ADR-gerekli**.
- **Etiket:** MVP-fix (seçenek 1, önerilen) / ADR-gerekli (seçenek 2)

### [HIGH] [SEC] DENY_LIST `raw_phone` içermiyor; DB CHECK ise TERS yazımı (`phone_raw`) denetliyor — "NEVER in audit payload" sözü hiçbir katmanda tutulmuyor (ID: SD-S-01)
- **Dosya:** `packages/shared-domain/src/audit/deny-list.ts:1-14`; karşı: `packages/db/migrations/000_init.sql:374` (CHECK'te `'phone_raw'`) ve `:382` (yorum: "raw_phone NEVER in audit payload"); gerçek kolon her yerde `raw_phone`
- **Kanıt:** `sanitizer.findings.test.ts` KIRMIZI: `sanitize()` payload'da `raw_phone` anahtarına throw ETMİYOR. Ek: PG `?|` operatörü yalnız top-level anahtar bakar; dizi-içi nested `raw_phone` DB CHECK'e de takılmaz (SD-S-09 ile birleşik zincir).
- **Senaryo:** Bir DB satırı spread'iyle (`{...customerPhoneRow}`) `raw_phone` payload'a sızarsa: deny-list yakalamaz; anahtar yanlışlıkla ALLOWED_KEYS'e eklenirse sıfır savunma kalır.
- **Etki:** Şemanın "ASLA" dediği tek alan için iki tasarlanmış savunma katmanı da fiilen devre dışı. **Kalibrasyon (BLOCKER→HIGH):** bugün whitelist default-deny tutuyor + hiçbir çağrı noktası `raw_phone` göndermiyor → aktif sızıntı değil, savunma-derinliği deliği.
- **Öneri:** `deny-list.ts`'e `'raw_phone'` (+`'phone_raw'`) ekle (MVP-fix); DB CHECK yazım düzeltmesi migration ister → **Blok 3'e devir** (db-migration-guard).
- **Etiket:** MVP-fix (TS) + Blok-3 devri (DB)

### [HIGH] [SEC] DENY_LIST ↔ DB CHECK listeleri iki yönde drift'li — "ADR-003 §12.2 ile senkron" yorumu yanlış (ID: SD-S-13)
- **Dosya:** `packages/shared-domain/src/audit/deny-list.ts` vs `packages/db/migrations/000_init.sql:368-378`
- **Kanıt:** `sanitizer.findings.test.ts` 4 test KIRMIZI (`customer_name`, `customer_phone`, `session_token`, `iban` → throw yok). DB'de olup TS'te olmayan 15 anahtar (`authorization/bearer/cookie/jwt/refresh_token/session_id/...`); TS'te olup DB'de olmayan 8 (`token/ssn/pan/cvv2/pin/track_data/credit_card/vergi_no`).
- **Senaryo:** `customer_name`/`customer_phone` — kod-içi-İngilizce kuralına göre Türkçe varyantlardan DAHA olası gerçek anahtar adları — TS deny katmanında korumasız.
- **Etki:** İki liste 91 oturum boyunca bağımsız evrilmiş; drift'i yakalayan CI guard'ı yok.
- **Öneri:** Eksik anahtarları TS listesine ekle (MVP-fix) + "DB CHECK ⊆ TS DENY_LIST" CI testi; uzun vadede tek-kaynak üretim (v5.1).
- **Etiket:** MVP-fix + v5.1-backlog (senkron mekanizması)

### [HIGH] [SEC][ROB] Sanitizer array-path'i whitelist filtrelemesini atlıyor (yalnız deny-key taraması) (ID: SD-S-09)
- **Dosya:** `packages/shared-domain/src/audit/sanitizer.ts:82-88`
- **Kanıt:** `sanitizer.audit.test.ts` YEŞİL karakterizasyon: dizi-içi obje `{note, arbitrary_field}` AYNEN geçiyor. Kod yorumu bunu bilinçli belirtiyor ("Does NOT apply whitelist... pure PII sweep") — ama deny-list yalnız KEY adı arar, VALUE içeriğini asla kontrol etmez.
- **Senaryo:** `changed_fields` yarın `[{field, from, to}]` diff-yapısına evrilirse (doğal evrim), `from`/`to` içindeki eski/yeni telefon değerleri filtresiz loglanır — sıfır uyarı.
- **Etki:** Bugün canlı risk DEĞİL (8 dosyadaki tüm `changed_fields` çağrıları string[] — grep ile doğrulandı). Nested-object path (whitelist recursion) ile tutarsız mimari.
- **Öneri:** Dizi elemanı plain-object ise `sanitizeRecord` ile filtrele — ADR-003 §12 kapsam genişlemesi, **ADR-gerekli**.
- **Etiket:** ADR-gerekli

### [HIGH] [SEC] `/customers/export` 1469 müşterinin PII'sini maskesiz döndürüyor; pii-mask fonksiyonları repo'da hiç çağrılmıyor (ID: SD-S-08) *(kapsam-dışı dosya — Blok 6'ya devir)*
- **Dosya:** `apps/api/src/routes/customers/index.ts:544-557`; boşa düşen güvence: `packages/shared-domain/src/pii-mask.ts:1-9` ("CSV export'larda ... **mecburi** maskelenir")
- **Kanıt:** exportRows `full_name` + tüm `phones` + `addresses` ham döner; `maskPhoneForExport/maskCustomerName/maskAddress` → repo genelinde 0 çağrı. Audit'e yalnız `{rows_count, format}` yazılıyor.
- **Senaryo:** Admin hesabı ele geçirilirse tüm müşteri defteri tek istekle çekilir.
- **Etki & kalibrasyon (BLOCKER→HIGH):** Route `authenticate + authorize(['admin'])` korumalı, audit-log'lu, tenant-scoped (ana-context'te doğrulandı); `kvkk-data-inventory.md:161` bu endpoint'i veri-taşınabilirliği mekanizması olarak listeliyor; admin zaten UI'da tam telefonları görüyor (Caller ID ürün gereği). Yani aktif ihlal değil — **dokümante edilmemiş tasarım çelişkisi**: pii-mask "mecburi" derken export ham dönüyor ve bu istisna hiçbir ADR'da yazılı değil.
- **Öneri:** ADR ile karar: (a) "admin tam-export bilinçli maskesizdir (DSAR/yedek), pii-mask JSDoc'u rapor-CSV'lerine daraltılır" YA DA (b) endpoint maskeli varsayılana çekilir (`?unmask=true` + genişletilmiş audit). Hukuki boyut A4 aydınlatma-metni işiyle birlikte ele alınmalı.
- **Etiket:** ADR-gerekli (Blok 6 önceliği)

#### Dormant yüzeyli (bugün çağrılmıyor — wiring öncesi zorunlu fix)

### [HIGH] [BUG] `parseMoney`, `formatMoney`'nin ürettiği binlik-ayraçlı biçimi ~1000× küçük parse ediyor (ID: SD-M-01)
- **Dosya:** `packages/shared-domain/src/money.ts:26-39`
- **Kanıt:** `money.findings.test.ts` 3 KIRMIZI: `formatMoney(123456)="₺1.234,56"` → `parseMoney("₺1.234,56")=123` (beklenen 123456). Kök: `replace(',', '.')` yalnız İLK virgül; ilk `.` ondalık sanılıyor.
- **Senaryo:** ≥1000 TL her formatlanmış tutarın round-trip'i kırık (en-US "1,234.56" da kırık).
- **Etki:** Canlı çağrı yok (grep 0) — ama exported API; ilk "tutar elle gir/düzenle" alanına bağlandığında sessiz ~1000× veri kaybı.
- **Öneri:** Son ayracı ondalık kabul eden yeniden-yazım (sağdan 2 hane), öncesindeki tüm ayraçları temizle.
- **Etiket:** MVP-fix (wiring öncesi zorunlu)

### [HIGH] [BUG] `subtractMoney` (paket-geneli desenin temsilcisi) NaN operandı sessizce geçiriyor (ID: SD-M-02)
- **Dosya:** `packages/shared-domain/src/money.ts:7-11`
- **Kanıt:** `money.findings.test.ts` 2 KIRMIZI: `subtractMoney(NaN,100)` → `NaN` döner (throw beklenirdi); `NaN < 0 === false` → guard ölü.
- **Senaryo:** Sistemik desen: SD-M-03/04/07 aynı kök neden (JS'te NaN karşılaştırması her zaman false). NaN zincirde hiçbir guard'a takılmadan `canCloseOrder`'a kadar akabilir.
- **Etki:** Dormant; ama "domain layer authoritative" iddiasının tam kalbinde savunmasızlık.
- **Öneri:** Ortak `Number.isFinite` guard deseni (money/payment/order fonksiyon girişleri) — küçük iç değişiklik, ADR gerekmez.
- **Etiket:** MVP-fix

### [HIGH] [BUG] `canCloseOrder` NaN/undefined toplamlarda `{ok:true}` dönüyor (ID: SD-M-03)
- **Dosya:** `packages/shared-domain/src/payment.ts:139-151`
- **Kanıt:** `payment.findings.test.ts` 3 KIRMIZI: `payableCents:NaN` → `ok:true`; `paymentsTotalCents:NaN/undefined` → `ok:true`.
- **Senaryo:** underpaid/overpaid iki karşılaştırma da NaN'da false → invariant kontrolü atlanır, sipariş "kapatılabilir" görünür.
- **Etki:** Paketin **canlı** 2 export'undan biri! Tek çağrı yeri `packages/db/src/repositories/payments.ts:403-408` `Number(paid.paid_total ?? 0)` ile coerce ediyor (dikkatli caller — bugün korunuyor). Domain fonksiyonunun kendisi tam da önlemesi gereken senaryoda sessiz.
- **Öneri:** SD-M-02 ortak guard.
- **Etiket:** MVP-fix

### [HIGH] [BUG] `validateCashTendered` NaN tendered'da `{ok:true, changeCents:NaN}` (ID: SD-M-04)
- **Dosya:** `packages/shared-domain/src/payment.ts:171-182`
- **Kanıt:** `payment.findings.test.ts` KIRMIZI: `{amountCents:1500, tenderedCents:NaN}` → `ok:true`.
- **Senaryo/Etki:** Dormant ama docstring'i onu "cash payment endpoint'inde tendered validation" için Phase-2 wiring listesine koyuyor — bir sonraki sprintin ayak-tuzağı; UI'da "NaN ₺ para üstü".
- **Öneri:** SD-M-02 ortak guard. · **Etiket:** MVP-fix

### [HIGH] [BUG] `calculatePayableCents` negatif `compedAmountCents` ile payable'ı ŞİŞİRİYOR (ID: SD-M-05)
- **Dosya:** `packages/shared-domain/src/payment.ts:102-110`
- **Kanıt:** `payment.findings.test.ts` KIRMIZI: `{totalCents:1000, compedAmountCents:-100}` → `1100` (guard yalnız `comped > total`).
- **Senaryo:** İkram tutarı hesap hatasıyla negatif üretilirse müşteriden FAZLA tahsilat istenir — doğrudan "para hatası" sınıfı; yalnız dormant olduğu için BLOCKER değil.
- **Öneri:** `compedAmountCents < 0` → throw. · **Etiket:** MVP-fix

### [HIGH] [BUG] `calculateItemSubtotal` kesirli/sonsuz adette kuruş-tamsayı invariantını kırıyor (ID: SD-M-06)
- **Dosya:** `packages/shared-domain/src/order.ts:10-13`
- **Kanıt:** `order.findings.test.ts` 2 KIRMIZI: `qty:1.5 × 333` → `499.5` (integer değil); `qty:Infinity × 0` → `NaN`.
- **Etki:** Dormant (apps/api inline hesap + zod `.int().positive()` koruyor — SD-M-08); `MoneyCents` dönüş tipi iddiası korumasız.
- **Öneri:** integer-qty guard + `multiplyMoney` kullanımı. · **Etiket:** MVP-fix

### [HIGH] [BUG] `calculateOrderDiscount` negatif indirimle toplamı ARTIRIYOR + NaN bypass (ID: SD-M-07)
- **Dosya:** `packages/shared-domain/src/order.ts:22-25`
- **Kanıt:** `order.findings.test.ts` 2 KIRMIZI: `(1000, -100)` → `1100`; `(1000, NaN)` → `NaN`.
- **Etki:** Dormant; v5.1 indirim özelliği tam bu fonksiyonun üstüne inşa edilecek.
- **Öneri:** `discountCents < 0` throw + `subtractMoney` delegasyonu (SD-M-15). · **Etiket:** MVP-fix

### [HIGH] [BUG] `normalizePhoneTr` Unicode rakamları (Arapça/Farsça/tam-genişlik) dönüştürmüyor, SİLİYOR → bozuk numara (ID: SD-S-05)
- **Dosya:** `packages/shared-domain/src/phone.ts:15`
- **Kanıt:** `phone.findings.test.ts` 3 KIRMIZI: `"٠٥٣٢1234567"` → `"1234567"` (JS `\D` yalnız ASCII; unicode rakam \D sayılıp siliniyor — 11 haneli geçerli GSM, 7 haneli "sabit hat"a dönüşüyor, sessizce).
- **Etki:** `normalizePhoneTr` CANLI (6 dosya kullanıyor; UNIQUE eşleştirme bu çıktıyla). Gerçek tetiklenme olasılığı düşük (Caller ID donanımı ASCII üretir) ama yapıştırma/OCR yolu açık; bozulma sessiz ve kalıcı.
- **Öneri:** Unicode-digit → ASCII ön-dönüşümü (`\p{Nd}` map) veya unicode-rakam içeren girdiyi reddet.
- **Etiket:** MVP-fix

### [HIGH] [BUG] `normalizePhoneTr` uzun "90…" çöp girdiyi rastgele 11-haneli SAHTE-geçerli numaraya küçültüyor (ID: SD-S-06)
- **Dosya:** `packages/shared-domain/src/phone.ts:25-30`
- **Kanıt:** `phone.findings.test.ts` 2 KIRMIZI: `'905'+'9'.repeat(57)` (60 kr) → `'05999999999'`; 40 haneli girdi de AYNI çıktıyı veriyor (`slice(2,12)` sonrasını sessizce atar).
- **Etki:** CANLI fonksiyon + UNIQUE index girdisi: bozuk girdi gerçek bir müşterinin numarasına ÇAKIŞABİLİR → Caller ID/sipariş geçmişi yanlış kişiye bağlanır (yanlış PII gösterimi).
- **Öneri:** `length > 12` dalına üst-sınır sağlık kontrolü (ör. ≤14 hane), ötesinde aynen-döndür/reddet.
- **Etiket:** MVP-fix

### [HIGH] [BUG] `isValidNormalizedPhone`, `normalizePhoneTr`'nin belgeli "sabit hat" çıktısını reddediyor — paket-içi kontrat çelişkisi (ID: SD-S-04)
- **Dosya:** `packages/shared-domain/src/validation.ts:19-21`
- **Kanıt:** `validation.findings.test.ts` KIRMIZI: `normalizePhoneTr('5288300')='5288300'` (7 hane, phone.test.ts'in geçerli saydığı çıktı) → `isValidNormalizedPhone(...)=false` (regex 10-15 hane).
- **Etki:** İkisi de dormant değil/dormant karışık: normalize CANLI, validator DEAD — entegre edildiği an sabit hatlar sistematik reddedilir.
- **Öneri:** Alt sınırı 7'ye çek YA DA adı/JSDoc'u "yalnız cep" olarak daralt. · **Etiket:** MVP-fix (entegrasyon öncesi)

### [HIGH] [QUAL/DEAD] 15 policy/PII export'u (%58) `apps/` içinde SIFIR kullanım; `users.ts` DİVERGE inline mantık kullanıyor (ID: SD-S-14)
- **Dosya:** `menu.ts`+`user.ts`+`pii-mask.ts` (%100 dead), `table.ts`/`validation.ts` (yarı); tam tablo §5
- **Kanıt:** Repo-geneli grep: `canManageUsers/canHardDeleteUser/validatePassword/canHardDeleteProduct/isValidTableStatusTransition/isTableOccupied/canOpenOrderOnTable/mask*` → 0 çağrı. `apps/api/src/routes/users.ts:244-245` rol kontrolünü `canManageUsers`'tan FARKLI/daha dar inline yazıyor. Dosya JSDoc'ları itiraf ediyor: "Phase 1.5 forensic ... eksik 3 entity policy yazıldı" — yazılmış, bağlanmamış.
- **Etki:** İş kuralları iki yerde iki farklı biçimde: hangisi kanonik belirsiz; DoD süreci "entegre edildi" adımına geçmemiş.
- **Öneri:** Fonksiyon başına karar: bağla / eşdeğeri route'ta varsa sil. **ADR-gerekli** (SD-M-08/10 ile birlikte tek mimari karar).
- **Etiket:** ADR-gerekli

### [HIGH] [QUAL/DEAD] İki farklı, birbirinden habersiz telefon-maskeleme fonksiyonu (%64 vs %36 reveal) (ID: SD-S-07)
- **Dosya:** `validation.ts:14-17` (`maskPhone`) vs `pii-mask.ts:23-30` (`maskPhoneForExport`)
- **Kanıt:** `pii-mask.audit.test.ts` karşılaştırma: `'05321234567'` → `'053***4567'` (7/11 açık) vs `'****4567'` (4/11 açık). Hangi bağlamda hangisi — kod-içi kural yok; ikisi de dead.
- **Öneri:** Tek kanonik maske fonksiyonuna konsolidasyon (ADR ile). · **Etiket:** ADR-gerekli

### 2.2 MEDIUM (7)

### [MEDIUM] [QUAL/DEAD] order.ts toplam fonksiyonları canlıda yok; apps/api aynı matematiği inline duplike yazıyor (ID: SD-M-08)
- **Dosya:** `order.ts` (tüm modül) vs `apps/api/src/routes/orders.ts:177,487-490`
- **Kanıt:** `const totalCents = unitPriceCents * input.quantity;` (route, inline) — shared-domain çağrısı 0. İki yerde aynı iş mantığı → sessiz ıraksama riski.
- **Öneri:** (a) apps/api'yi domain fonksiyonlarına konsolide et VEYA (b) order.ts'nin scaffolding statüsünü ADR ile belgele + senkron contract-testi. **Blok 5'in ana odağına devir** (gerçek para matematiği orada yaşıyor).
- **Etiket:** ADR-gerekli

### [MEDIUM] [BUG] Satır-bazlı vs toplam-bazlı KDV yuvarlaması 1 kuruş uyuşmuyor — kanonik politika yok (ID: SD-M-09)
- **Dosya:** `tax.ts:20-23` · **Kanıt:** `3×calculateVat(333,1000)=99` ≠ `calculateVat(999,1000)=100` (`tax.audit.test.ts`'te karakterize).
- **Etki:** KDV MVP'de devre dışı (orders.ts:486 "KDV v5.1") → sıfır canlı etki; v5.1 KDV wiring ADR'sinde satır-mı-toplam-mı kararı zorunlu.
- **Etiket:** ADR-gerekli (v5.1 öncesi)

### [MEDIUM] [DEAD] Para yüzeyinin 18/20 export'u sıfır üretim çağrısı (ID: SD-M-10)
- **Kanıt:** CANLI yalnız `formatMoney` (20 dosya) + `canCloseOrder` (1). Sıfır: add/subtract/multiply/parseMoney, tüm tax.*, tüm order.*, order-no.*, canAddItemToPayment, calculatePayableCents, validateCashTendered.
- **Etki:** %97 coverage "prod yolu test edildi" yanılsaması veriyor; SD-M-01…07 bu yüzeyde yaşıyor. payment.ts docstring'i Phase-2 wiring'i tarif ediyor (kasıtlı scaffolding kanıtı) — karar yine de belgelenmeli.
- **Etiket:** ADR-gerekli (SD-S-14 ile birleşik karar)

### [MEDIUM] [ROB] `ESC_POS` sabitleri dondurulamayan paylaşımlı `Uint8Array` singleton — index-mutasyonu sessizce kalıcı (ID: SD-P-05)
- **Dosya:** `esc-pos.ts:13-41` · **Kanıt:** `ESC_POS.RESET[0]=0x00` sıradan TS'le derlenir ve process-ömrü boyunca TÜM print job'ları bozar; `Object.freeze(TypedArray)` V8'de TypeError (empirik doğrulandı — CP857_MAP'teki freeze deseni buraya taşınamaz).
- **Etki:** Bugün hiçbir çağıran mutate etmiyor; gelecekteki-yazım-hatası sınıfı, teşhisi zor mystery-bug.
- **Öneri:** Sabit-byte alanlarını factory-fonksiyona çevir (align/feed deseni) veya savunmacı-kopya sözleşmesi. · **Etiket:** v5.1-backlog

### [MEDIUM] [BUG] `maskPhone` (validation.ts) tam 4 karakterde sıfır hane gizliyor (ID: SD-S-03)
- **Dosya:** `validation.ts:13-17` · **Kanıt:** `validation.findings.test.ts` KIRMIZI: `maskPhone('1234')='****1234'` — throw eşiği `<4`, `slice(-4)` 4-haneli girdinin tamamını açık bırakır; `****` yanıltıcı "maskelendi" izlenimi verir.
- **Kalibrasyon (BLOCKER→MEDIUM):** dead fonksiyon + 4-haneli girdi gerçekçi telefon sınıfı değil (kısa kod); SD-S-02'den (7 hane = gerçek normalize çıktısı) bu yüzden bir kademe düşük.
- **Öneri:** Eşiği `<8`'e çek veya eşik altında sabit `'****'` sentinel. · **Etiket:** MVP-fix (wiring öncesi)

### [MEDIUM] [ROB] Sanitizer'da döngüsel-referans guard'ı yok → kontrolsüz RangeError (ID: SD-S-10)
- **Dosya:** `sanitizer.ts:27-38,53-91` · **Kanıt:** self-referans dizi → stack overflow (`sanitizer.audit.test.ts` karakterize).
- **Etki:** Gerçekleşirse istek 500 olur ve audit kaydı YAZILMAZ (mutation+audit aynı-tx ilkesi bozulur); olasılık düşük (payload'lar elle inşa).
- **Öneri:** WeakSet "seen" guard'ı + kontrollü `error.audit.circularPayload`. · **Etiket:** MVP-fix (küçük, izole)

### [MEDIUM] [ROB] Sanitizer Map/Set/class-instance değerlerini hiç taramadan geçiriyor (ID: SD-S-11)
- **Dosya:** `sanitizer.ts:9-16,76-88` · **Kanıt:** `Map([['phone','0532...']])` → aynen çıktıda (karakterize edildi).
- **Etki-notu (konsolidasyon):** `writeAudit` `JSON.stringify` kullanır; Map/Set `{}`'e serileşir → DB'ye fiilen PII yazılmaz, ama sanitizer kontratı ("tarandı") yine de deliktir. Düşük olasılık.
- **Etiket:** v5.1-backlog

### 2.3 LOW (8)

### [LOW] [ROB] add/multiplyMoney MAX_SAFE_INTEGER üstünde sessiz hassasiyet kaybı (ID: SD-M-11) — ~90 trilyon TL; pratikte erişilemez. Karakterize edildi (`money.audit.test.ts`). Etiket: v5.1-backlog.
### [LOW] [BUG] `multiplyMoney(x, -0)` guard'ı atlayıp `-0` üretiyor; `formatMoney(-0)`="-₺0,00" (ID: SD-M-12) — kozmetik. Etiket: v5.1-backlog.
### [LOW] [ROB] `formatOrderNo(1e21)`="#1e+21" (exponential-notation guard yok) (ID: SD-M-13) — erişilemez girdi. Etiket: v5.1-backlog.
### [LOW] [DEAD] order-no.ts iki fonksiyonu da dormant; duplikasyonu bile yok (tam izole) (ID: SD-M-14) — SD-M-10 kararına dahil. Etiket: v5.1-backlog.
### [LOW] [QUAL] order.ts money.ts primitiflerini kullanmıyor — paket-İÇİ duplike aritmetik + guard'ları farklı mesajla yeniden yazıyor (ID: SD-M-15) — SD-M-02 fix'i order.ts'ye otomatik yansımaz. Etiket: v5.1-backlog (SD-M-02/06/07 fix PR'ıyla birlikte).
### [LOW] [BUG] sanitize `\n`/`\t`'yi boşluksuz siliyor → çok-satırlı notta "Zili çalmakapıyı vurun" birleşmesi (ID: SD-P-04) — mevcut test bu davranışı KİLİTLİYOR (bilinçli olabilir); değişiklik ürün kararı ister. Etiket: v5.1-backlog.
### [LOW] [QUAL] Sanitizer dizi değerini referans-paylaşımlı döndürüyor (deep-clone yok) (ID: SD-S-12) — stringify hemen çağrıldığı için pencere çok dar. Etiket: v5.1-backlog.
### [LOW] [QUAL] `getTableStatusTransition` hardcoded İngilizce reason metni (i18n ihlali adayı; şu an DEAD) (ID: SD-S-15) — diğer modüllerin reason-kodu desenine çevrilmeli. Etiket: v5.1-backlog (entegrasyon anında zorunlu).

### 2.4 NIT (3)

### [NIT] ₺/€ kaybı bulgu DEĞİL — ADR-004 Amd5 K13 ile v5.1'e kilitli; `moneyDigits` para yolunda zaten "TL" metni kullanıyor, sembol encode katmanına girmiyor (ID: SD-P-06).
### [NIT] `maskCustomerName` tek-kelime isimde maskesiz döner — JSDoc'ta belgeli bilinçli tasarım; CSV'de diğer kolonlarla birleşince re-identification notu düşüldü (ID: SD-S-16).
### [NIT] `isValidNormalizedPhone` regex'indeki `\+?` hiç eşleşemez (normalize çıktısı `+` içermez) — ölü desen parçası (ID: SD-S-17).

---

## 3. Temiz çıkan alanlar (kontrol edildi, sorun bulunamadı)

- **CP857 Türkçe-kritik tablo 12/12 referansla BİREBİR** (Ç 0x80 · ü 0x81 · ç 0x87 · ı 0x8D · İ 0x98 · Ö 0x99 · Ü 0x9A · Ş 0x9E · ş 0x9F · Ğ 0xA6 · ğ 0xA7 · ö 0x94); S83 `ğ/Ğ` fix regresyonu YOK; bijektif; ASCII-çakışmasız. Byte'lar hardcode-assert edildi (salt round-trip'in kendini-doğrulama tuzağına düşülmedi). ESC t 29 (mutfak) / ESC t 61 (kasa) seçici byte'ları doğru.
- **ESC/POS komutları spec'e uygun** (RESET/align/printMode-bitmask/feed-clamp/CUT_FULL); `feed()` NaN/±Inf/negatifte doğru clamp; `concat()` girdileri mutate etmiyor.
- **Sanitize→encode uçtan-uca hattı 14 saldırı senaryosunda hiç throw etmiyor** ve çıktıda 0x00-0x1F/0x7F yok; ESC/GS enjeksiyonu (sanitize kullanıldığında) nötralize; lone-surrogate fail-fast. Çağrı-noktası disiplini: kitchen/bill template'lerinde HER kullanıcı-alanı sanitize'den geçiyor.
- **calculateVat ↔ calculateVatInclusive ileri/geri round-trip tutarlı** (500 rastgele + %8.5/%18.03 hedefli — 0 uyuşmazlık); `0 ≤ vergi ≤ matrah` invariantı 1000 denemede sağlam; `getCategoryVatRateBps` tr-TR locale-lowercase doğru ("İÇECEK"→içecek).
- **canCloseOrder tam-eşitlik mantığı doğru** (integer-kuruşta epsilon anti-pattern'i yok); tek canlı caller (`payments.ts:403`) SQL SUM'ı dikkatli coerce ediyor. **addMoney** rastgele değerlerde commutative+associative (1000 üçlü).
- **formatOrderNo/parseOrderNo tüm gerçekçi malformed girdilerde doğru throw** — paketin en sağlam-guard'lı ikilisi.
- **table.ts durum-matrisi ↔ TableStatus enum birebir**; user.ts `canManageUsers` rol enum'unun tamamını kapsıyor (default-deny); validatePassword NIST-uyumlu sınır davranışı.
- **cron/lock-ids:** 3 ID unique + bigint aralığında + tek registry (`ttl-cleanup.ts`) — çakışma yok; İLK test dosyası bu denetimde eklendi (13 test).
- **Sanitizer çekirdeği:** deny→whitelist önceliği doğru (bilinen PII'de gürültülü throw), case-insensitive, nested-object recursion her seviyede deny kontrol ediyor, `__proto__` güvenli düşüyor (prototip kirlenmesi yok).
- **normalizePhoneTr idempotent** (10 örnek: normalize∘normalize = normalize); `MoneyCentsSchema`/`quantity` zod sınır-korumaları bulunan domain açıklarının bugün tetiklenmemesinin nedeni olarak doğrulandı.
- **`any` kullanımı: 0** (tüm kapsam); duplike CP857 tablosu yok (print-agent "dumb transport" ilkesiyle tutarlı).

---

## 4. Eklenen test envanteri (22 dosya, 237 test)

| Hat | Dosya | Test | Sonuç |
|---|---|---:|---|
| A | money.audit / tax.audit / payment.audit / order.audit / order-no.audit | 10+10+8+6+5 | ✅ 39 yeşil |
| A | money.findings / payment.findings / order.findings | 5+5+4 | 🔴 14 kasıtlı kırmızı |
| B | encode-cp857.audit / sanitize-cp857.audit / esc-pos.audit | 27+34+13 | ✅ 74 yeşil |
| B | encode-cp857.findings / sanitize-cp857.findings | 2+5 | 🔴 7 kasıtlı kırmızı |
| C | pii-mask.audit / phone.audit / audit/sanitizer.audit / validation.audit / cron/lock-ids.test | 22+21+17+16+13 | ✅ 89 yeşil |
| C | pii-mask.findings / phone.findings / audit/sanitizer.findings / validation.findings | 2+5+5+2 | 🔴 13 kırmızı + 1 yeşil eşlik testi |

**Kırmızı → bulgu eşlemesi:** SD-M-01×3 · SD-M-02×2 · SD-M-03×3 · SD-M-04 · SD-M-05 · SD-M-06×2 · SD-M-07×2 · SD-P-01×3 · SD-P-02×2 · SD-P-03×2 · SD-S-01 · SD-S-02 · SD-S-03 · SD-S-04 · SD-S-05×3 · SD-S-06×2 · SD-S-13×4 = **34 kırmızı**. Her test adı ID ile başlar; fix'i yapılan bulgunun testi yeşile döner (kalıcı regresyon kilidi).

**Suite durumu (bu branch'te BEKLENEN):** `pnpm --filter @restoran-pos/shared-domain test` → 34 failed / 436 passed (470). Mevcut 233 test regresyonsuz yeşil. CI bu branch'te KASITLI kırmızı — master-prompt Blok 1 talimatı ("kırmızı bırak, notunu düş").

---

## 5. DEAD-export haritası (silinmedi — CLAUDE.md cerrahi kuralı; karar ADR'ye)

**Canlı (11):** `formatMoney`(20 dosya) · `canCloseOrder`(1) · `normalizePhoneTr`(6) · `isTurkishMobile`(2) · `sanitize`(writeAudit) · `ALLOWED_KEYS`(dolaylı) · `DENY_LIST`(dolaylı) · `tableDisplayNo`(5) · `tableLabel`(1) · `UNASSIGNED_AREA`(4) · `selectVisibleTables`(2) · `groupOccupiedTotal`(2) · `CRON_LOCK_IDS`(ttl-cleanup).
**Dormant (18+):** money: `addMoney/subtractMoney/multiplyMoney/parseMoney` · tax: tümü (3 fn + 2 sabit) · order: tümü (4) · order-no: tümü (2) · payment: `canAddItemToPayment/calculatePayableCents/validateCashTendered` · pii-mask: tümü (3) · validation: tümü (4) · table: `isTableOccupied/canOpenOrderOnTable/isValidTableStatusTransition/getTableStatusTransition` · menu: `canHardDeleteProduct` · user: `validatePassword/canManageUsers/canHardDeleteUser`.

---

## 6. Etiket özetleri

- **MVP-fix (onay bekliyor, prod koda dokunulmadı):** SD-P-01, SD-P-02, SD-P-03(doküman-seçeneği), SD-S-01(TS), SD-S-13(liste), SD-S-05, SD-S-06, SD-S-04, SD-S-03, SD-S-10, SD-M-01…07 (ortak finite-guard deseni tek PR'da toplanabilir).
- **ADR-gerekli:** SD-S-08 (export maskeleme politikası — Blok 6) · SD-S-09 (sanitizer array-whitelist kapsamı) · SD-S-14 + SD-M-08 + SD-M-10 (dormant domain katmanı: bağla-veya-sil mimari kararı) · SD-S-07 (tek kanonik telefon-maske) · SD-M-09 (KDV satır-vs-toplam, v5.1 KDV öncesi) · SD-P-03 (encode kontrat genişletme seçeneği).
- **v5.1-backlog:** SD-P-04, SD-P-05, SD-M-11…15, SD-S-11, SD-S-12, SD-S-15, SD-S-17 + DENY_LIST tek-kaynak senkron mekanizması.

## 7. Sonraki bloklara devir notları

- **Blok 3 (db):** `audit_logs_payload_no_pii` CHECK'indeki `'phone_raw'` yazımını `'raw_phone'` yapacak migration (SD-S-01'in DB yarısı); `?|` operatörünün yalnız top-level bakması sınırlaması not edilsin.
- **Blok 5 (orders/payments):** Gerçek para matematiği `apps/api/routes/orders.ts:177,487` inline yaşıyor (SD-M-08) — split/idempotency denetimi ORADA yapılmalı; shared-domain'deki split fonksiyonu hiç yazılmamış (YAGNI notu payment.ts:27-30).
- **Blok 6 (api routes):** SD-S-08 export-maskeleme ADR'ı; `users.ts:244` diverge rol kontrolü (SD-S-14 kanıtı).
- **Blok 7 (reports/CSV):** pii-mask fonksiyonları dead olduğuna göre rapor-CSV'lerinde PII kolonu var mı, varsa neyle maskeleniyor — ADR-021 "mecburi maskeleme" sözünün gerçek uygulandığı yer denetlensin.
- **Blok 8 (print pipeline):** `receipt-layout.ts` kolon hesapları `.length` (UTF-16 code-unit) kullanıyor — emoji/astral girdilerde kolon kayması potansiyeli (Hat B kapsam-dışı gözlemi).

## 8. Blok DoD durumu

- [x] Kapsamdaki tüm dosyalar okundu (3 hat + ana-context doğrulaması)
- [x] Bulgular A.4 şemasıyla raporlandı (38 bulgu)
- [x] Her BLOCKER/HIGH için kırmızı karakterizasyon testi (34 test; SD-S-07/08/14 gibi grep-tabanlı yapısal bulgular hariç — bunlar test ile temsil edilemez, kanıtları rapor içinde)
- [x] Sınır-zorlama additive testleri eklendi (203 yeşil)
- [x] Prod kod değişmedi; mevcut testler değişmedi; bağımlılık eklenmedi
- [ ] BLOCKER fix/issue takibi → BLOCKER çıkmadı; HIGH'lar Blok 13 sentezinde (`00-summary.md`) önceliklendirilecek (asılı bırakma yok)
