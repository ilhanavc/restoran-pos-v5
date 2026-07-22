# Session 104 — Kickoff (Session 103 devri, 2026-07-22)

## Tek cümlede

S103 **cutover hazırlık günüydü**: 10 PR, prod'a deploy (migration 050 dahil), ürün sahibinin canlıda bulduğu **3 bug** düzeltildi, yetim-kuyruk göstergesi **gerçek olayla sınandı** ve **OTA kapsama alındı** — geriye yeni mobil paketin cihazlara kurulumu ve cutover gününün kendisi kaldı.

## Durum

| | |
|---|---|
| main | **`94858d7`** (S103 sonu) |
| **prod (kod)** | **`f30f882`** · migration **050** |
| **⚠️ DEPLOY BORCU** | **`#440` (mutfak fişi tekrar basımı) prod'da YOK** — API-only, migration yok. Ayrıca #438 (mobil sürüm satırı) OTA ile indi ✅ |
| Açık PR | yok · 13 eski draft audit PR (#329-341) duruyor |
| Mobil paketler | ✅ iOS `f7f325d4` (6 UDID) + Android `4e0b2411` **kuruldu ve doğrulandı** |
| OTA | ✅ **çalışıyor** — kanal `production` → branch bağlandı; ilk tur cihazda görüldü |
| Cutover | **24-26 Tem** (2 gün) |

## ⚠️ İLK İŞ — devir notunu DOĞRULA

S103'te bu doğrulama 10 dakika sürdü ve **her iddia tuttu** (S102'nin aksine). Yine de tekrarla: prod HEAD + migration head (`ssh -i ~/.ssh/restoran_pos_ed25519`), `eas build:list` (build'ler bitti mi), prod `users`/`agents` sayımı.

## Sıradaki işler

> ✅ **S103 sonunda [USER] tarafından kapatıldı:** mobil kurulum **ve** personel eğitimi (A7).
> ⛔ **A4 KVKK kapsam dışı** — ADR-031 **Amendment 3** (ürün tek işletmeye kapalı; yükümlülük ortadan kalkmadı, ertelendi — başka işletmeye açılırsa geri gelir).
> **→ Cutover'ın önünde teknik/operasyonel bir bağımlılık kalmadı; kalan tek şey cutover gününün kendisi.**
> ⚠️ Yine de teyit et: aşağıdaki **iki fiziksel doğrulama** yapıldı mı — hızlı öde → kasa fişi kâğıtta, ve ilk OTA turu.

### 1. [USER] Mobil paketi dağıt — S103'te tamamlandı

Build'ler bitmiş olmalı. Sırayla:

1. `eas build:list --limit 2` → ikisi de `finished` mi
2. **iOS IPA'sını indir, `embedded.mobileprovision` içindeki `ProvisionedDevices`'ı SAY** — 6 çıkmalı ([[feedback_eas_resign_profile_stale]]; "başarılı" çıktısı kanıt değildir)
3. 6 cihaza kur (QR: build sayfasındaki **Install**)
4. ✅ **İki fiziksel doğrulama — S103'te YAPILDI:**
   - ✅ **Hızlı öde → kasa fişi kâğıtta çıktı** (ADR-014 Amd2'nin tek canlı kanıtı)
   - ✅ **İlk OTA turu başarılı** — **ama ilk denemede inmedi.** `eas update` *"Published!"* dedi, branch'e yazdı, runtime eşleşti, build'in kanalı doğruydu; yine de cihaza hiçbir şey gitmedi çünkü **kanal hiçbir branch'e bağlı değildi** (`channel:view` → liste boş). `eas channel:edit production --branch production` sonrası göründü. → **ADR-031 Amd2 K7** + [[feedback_eas_update_channel_branch]] + `mobile-release.md §9.2`.
   - **Kalıcı yan ürün:** Ayarlar'ın altında `Sürüm 0.0.1 · yerleşik paket | güncelleme <id>` satırı (#438) — cihazda hangi paketin çalıştığı artık iki dokunuşla görülür.

### 1.4 🔥🔥 [KOD] **PAKET SİPARİŞTE PORSİYON HİÇ KAYDEDİLMİYOR — PARA KAYBI** (S103 sonu, en yüksek öncelik)

> **Ürün sahibi:** *"adisyon listesinde 1.5 olarak gözüküp tutarı doğru olsa bile **kaydet dediğim anda porsiyon 1'e düştü ve mutfağa 1 olarak gitti**."* Kendisi "paket olduğu için mi?" diye sordu — **evet, örüntü prod'da kesin.**
>
> **Prod kanıtı (son 12 saat, pide kalemleri):**
> | order_type | `variant_name_snapshot` | birim fiyat |
> |---|---|---|
> | **dine_in** (55, 59, 33, 26, 25, 24, 23, 22) | `Tam` / `Bir buçuk` — **hep DOLU** ✅ | 420 / 525 → **delta uygulanmış** |
> | **takeaway** (49, 41, 39, 29) | **(BOŞ) — 4/4** ❌ | 380 / 350 / 350 / 350 → **taban fiyat, delta YOK** |
>
> **Etki ÇİFT:** (1) mutfağa yanlış porsiyon gidiyor → yanlış üretim; (2) **fiyat farkı tahsil edilmiyor** → müşteri 1.5 porsiyon alıp 1 porsiyon parası ödüyor. **Cutover'da her paket siparişte para kaybı.**
>
> **Aranacak yer:** paket akışı web'de `createTakeaway.mutateAsync({ items: buildItemsPayload() })` ile gidiyor; `buildItemsPayload` **`variantId`'yi gönderiyor** (kod-teyitli). Dolayısıyla şüphe **API tarafında `createTakeawayOrder`**: variantId'yi okuyup `variant_name_snapshot` + `unit_price_cents` deltasını yazıyor mu? Dine-in yolu (`POST /orders` + `PATCH /orders/:id/items`) bunu **doğru** yapıyor → **iki yolu yan yana oku** ([[project_session_103_summary]] "asimetri bug'ın işaretidir" dersi).
>
> **Doğrulama:** düzeltmeden önce fix'siz kırmızı test (paket sipariş + variantId → snapshot + delta beklenir). `apps/api` entegrasyon testi; bu yol test edilmemiş olabilir.

### 1.5 🎯 [KOD] İKİNCİ (AYRI) BUG — porsiyon **kaydediliyor ama kasa fişinde/ödeme ekranında GÖSTERİLMİYOR**

> **S103 sonunda çözüldü.** Ürün sahibi ikinci gözlemi verdi: *"masayı kapattığımda ürün ismi 1.5 olarak gözükmedi, 1 olarak gözüktü **ancak tutar 1.5 tutarıydı**."* Tutarın doğru olması, `variantId`'nin API'ye gittiğini ve fiyatın doğru hesaplandığını kanıtlar → sorun **seçimde değil, gösterimde**.
>
> **Prod kanıtı (order 59, 18:13):** `Kıymalı Pide` · `variant_name_snapshot = "Bir buçuk"` ✅ · `unit_price_cents = 525` (taban 350 + delta 175) ✅ — **veri katmanı tamamen doğru.**
>
> **Eksik olan yer (kod taraması):**
> | katman | durum |
> |---|---|
> | `enqueue-bill-job.ts` | ❌ `variant_name_snapshot`'ı **SELECT etmiyor** (0 referans) |
> | `templates/bill-receipt.ts` | ❌ porsiyonu **render etmiyor** (0 referans) |
> | `apps/web/src/features/payment/` | ❌ ödeme/kapatma ekranı porsiyonu göstermiyor |
> | mutfak fişi (`kitchen-receipt.ts`) | ✅ var (ADR-004 Amd5 K4) |
> | `AdisyonPanel` (sipariş ekranı) | ✅ var |
>
> **Neden cutover'ı ilgilendiriyor:** müşteriye verilen kasa fişinde `Kıymalı Pide … 525,00` yazacak ama **"Bir buçuk" yazmayacak** → müşteri neden 525 ödediğini kâğıttan anlayamaz. Aynı şey ödeme ekranında kasiyer için de geçerli.
>
> **Yapılacak (S104):** `enqueueBillJob` fetch'ine `variant_name_snapshot` eklenir + `bill-receipt.ts` kalem satırında ad yanına yazılır (mutfak fişindeki `qty variant_name_snapshot` deseniyle hizalı — ADR-004 Amd5 K4) + ödeme ekranı kalem listesi. **ADR-027 Amd1 (adisyon fişi) kapsamında amendment** gerekir; fiş yerleşimi değişiyor. Migration yok.
>
> ⚠️ **"Bazen oluyor" izlenimi büyük olasılıkla buradan:** porsiyon **her zaman** doğru kaydediliyor; kullanıcı bazen sipariş ekranına (gösteriyor), bazen kasa fişine/ödeme ekranına (göstermiyor) bakınca "bazen çalışıyor" gibi görünüyor.

<details><summary>S103'te izlenen yanlış iz (tekrarlanmasın)</summary>

**Ürün sahibi (22 Tem, canlı):** *"farklı porsiyon seçimlerinde ürün kaydedildikten sonra yazıcıda ve masada normal porsiyon olarak çıktı."* Ekran: **web kasiyer**. Akış: **ürünü ekle → adisyondaki satıra tıkla → porsiyonu değiştir → kaydet.**

**Kesin veriler (prod'dan doğrulandı):**
- "Bir buçuk" porsiyon **5 kez başarıyla kaydedilmiş**, sonuncusu **12:38** (deploy 11:30'du → parti modeli sonrası da çalışmış). **Yani bug her seferinde olmuyor.**
- **14:54, order 55:** 4 kalemin **hepsi `Tam`** — Kuşbaşılı Pide 420 TL (Bir buçuk olsa 630 olurdu).
- Prod'da **hiçbir zorunlu attribute grubu YOK** (8 grubun hepsi `is_required=f`).
- Web'in gönderim yolu **doğru**: `buildItemsPayload` → `variantId`. `editItem` + `handleModalConfirm` mantığı da doğru.

**⚠️ S103'te yanlış ize girildi, tekrarlanmasın:** lokalde reprodüksiyon denendi ve "zorunlu özellik seçilmezse porsiyon sessizce düşüyor" bulundu — ama bu **lokal seed verisindeki** "Pişirme (zorunlu)" grubuna özeldi; **prod'da zorunlu grup yok**, dolayısıyla o bulgu bu bug'ı açıklamıyor. (Lokal ortamda ayrıca `observer.getOptimisticResult is not a function` react-query/Vite cache hatası vardı; `rm -rf apps/web/node_modules/.vite` + dev restart ile geçti.)

**Sıradaki 3 aday (bu sırayla):**
1. **Tarayıcı önbelleği** — 11:30'da yeni web paketi yayınlandı; sert yenileme (Ctrl+Shift+R) yapılmadıysa eski JS çalışıyor olabilir. **Aralıklı davranışı en iyi bu açıklar.** Kullanıcıdan sert yenileme sonrası tekrar denemesi istendi; **cevap alınmadı**.
2. **`OrderScreenPage` ~satır 355** — ürün `useProductsAdmin` cache'inde bulunamazsa **`variants: []` ile sahte ürün** kuruluyor → porsiyon seçimi işlevsizleşir. Prod'da hangi koşulda tetiklendiği bakılmalı.
3. **Order 55'i tam incele** — 4 kalem aynı anda mı girildi, hangi kullanıcı, **web mi mobil mi** (`refresh_tokens.user_agent` ile eşleştirilebilir).

### 2. [PLANLAMA] Cutover günü

Runbook **S103'te tazelendi ve artık güvenilir**: `docs/ops/cutover-gunu-runbook.md` (üç yazıcı tablosu + Windows servis adları + dükkan-PC erişim gerçeği + kademeli geri alma). Kalemler: ADR-031 go/no-go · test verisi temizliği (`cutover-test-temizligi.md`) · `order_no` 1'den · Adisyo'nun bırakılması.

**Cutover gecesi kuralları:** deploy YOK · **OTA da YOK** (ADR-031 Amd2 K6) · kasada **admin hesabı** (#429).

### 3. [KOD] Kapanmamış iz — `42501`

Prod log'unda **`insufficient_privilege`** hataları: 21 Tem ×4 (19:21-19:22), 22 Tem ×1 (07:49). S103'te fark edildi ama **incelenmedi**. Tablo sahipliği/izin sınıfı bir konu (S91'de benzeri yaşanmıştı: fresh-install `postgres`-owned tablolar → migrator aclcheck). Hangi uç olduğunu bulmak için nginx access log'unda o saatlerin 5xx'lerine bakmak yeterli.

### 4. [KOD, ops.] v5.1 planlama

`docs/audit/low-nit-devir.md` (~55 LOW + ~15 NIT) · 91 unused-exported-types · ADR-032 **Dilim C/D/E** · ADR-032 Amd3 v5.1 izleme listesi · kişi-bazlı `cashier` rolü (#429 kabul edilen risk) · web'de paket sipariş iptalinin sebep sormaması (chip).

## S103'te öğrenilenler (tekrarlanmasın)

- **Bir kısıt iki katmanda olabilir.** Ek ücret tavanı hem zod'da (üç yerde) hem DB CHECK'te duruyordu; yalnız birini gevşetmek kullanıcıya "eklenemedi"yi 400 yerine **500** olarak gösterirdi. Şema değiştirirken **DB tarafını da sor**.
- **Asimetri bug'ın işaretidir.** Grup ekleme çalışıyor, kaldırma 500 veriyordu — fark, audit `entity_id`'ye kompozit anahtar yazılmasıydı. "Biri çalışıyor, diğeri çalışmıyor" gördüğünde **iki yolu yan yana oku**.
- **Test edilmemiş uç = prod'a giden bug.** Hem `unassign` hem mobil fiş yolu testsizdi. Düzeltmeden önce **fix'siz kırmızıyı** görmek her ikisinde de teşhisi kanıtladı.
- **Tasarım kararı işin gerçeğiyle çelişebilir.** Mobil fiş "opt-in" olduğu için basmıyordu — kod doğruydu, karar eksikti. Kullanıcı "çıkmadı" dediğinde önce **kasıtlı mı** diye bak.
- **Canlı sınama, belge okumaktan farklı şeyler öğretir.** Yetim-kuyruk testinden iki gerçek çıktı: servis adları istasyonlara sezgisel eşlenmiyor, ve dükkan-PC **uzaktan komut kabul etmiyor** — ikisi de hiçbir belgede yoktu.
- **`shared-types` değişince build şart.** API derlenmiş `dist`'i okuyor; test `expected 400 to be 201` ile kırıldı, `pnpm --filter @restoran-pos/shared-types build` sonrası geçti.
- **Lokal Postgres:** `pg_ctl` sessizce başlatmıyor; **`postgres.exe`'yi doğrudan** `Start-Process` ile aç.

## Kapsam dışı (sessizce geri gelmesin)

TestFlight/App Store (ADR-031 kilidi) · restoran logosu/ikon (v5.1) · iPad · istasyon-bazlı KDS (ADR-032 Amd1 K3) · sepette ürün-bazlı gruplama (ADR-013 Amd2) · OTA'da staging kanalı (v5.1) · ADR-032 Dilim C/D/E.
