# Session 103 — Kickoff (Session 102 devri, 2026-07-21 akşamı)

## Tek cümlede

S102'de **mobil yayın dalgası çıktı ve iOS ilk kez pilota girdi** — 5 iPhone kayıtlı, her iki platformun paketi sevk edildi, sipariş akışı gerçek cihazda kâğıtla doğrulandı; geriye 2 kişinin hesabı/cihazı ile cutover gününün kendisi kaldı.

## Durum

| | |
|---|---|
| main (HEAD) | **`b177544`** · migration head **049** |
| **main KOD başı** | **`275250a`** (#418) — S102'nin 4 PR'ı da **doküman**; üstündeki commit'ler HEAD'i kaydırdı ama kodu değiştirmedi |
| prod | **`275250a`** = kod başı → **prod GÜNCEL, deploy borcu YOK** |
| mobil paketler | main `2b5f7909`'dan derlendi (o da docs commit'i; kod olarak `275250a` ile aynı) |
| Açık PR | yok · 13 eski draft audit PR (#329-341) duruyor |
| Mobil paketler | iOS build **`4e29245a`** · Android APK (ikisi de main `2b5f7909`) |

## ⚠️ İLK İŞ — devir notunu DOĞRULA, güvenme

S102'nin kendisi bu dersi yaşadı: `session-102-kickoff.md` "decisions.md commit'lenmedi" diyordu, oysa `#414` ile main'deydi. **Bu dosyadaki her "kalan iş" iddiasını 30 saniyede kontrol et** — özellikle prod hesapları (SSH ile `SELECT role, username FROM users`) ve cihaz listesi (`eas device:list --apple-team-id WFU9WJHJHT`).

## Sıradaki işler

### 1. [USER] Mobil dağıtımın kalanı — küçük, mekanik

| kişi | hesap | cihaz | kalan |
|---|---|---|---|
| İlhan · Recep | ✅ | ✅ | — *(giriş yaptılar)* |
| Kadir · İsmail | ✅ | ✅ | kurulum + Geliştirici Modu |
| **Ceren** | ❌ | ✅ | **hesap açılacak** — `ceren@restoran.com`, rol `waiter`, şifre **min 10 karakter** |
| Sıraç · Fırat | Sıraç ❌ / Fırat ✅ | ❌ | cihaz kaydı → resign → **IPA doğrulaması** |

**Cihaz ekleme reçetesi (sıra atlanırsa sessizce eski profil gömülür):**
1. `eas device:create` → link → telefonda Safari → profil kur
2. `eas credentials --platform ios` → `production` → `All` → *"missing devices"* uyarısı → **"choose devices again" → eksikleri Space ile işaretle**
3. `eas build:resign --platform ios`
4. **IPA'yı indir, `embedded.mobileprovision` içindeki `ProvisionedDevices`'ı SAY** — bu adım atlanamaz ([[feedback_eas_resign_profile_stale]])

**Her yeni iPhone'da:** Ayarlar → Gizlilik ve Güvenlik → **Geliştirici Modu** → aç → yeniden başlat (iOS 26 şartı; build defekti değil, imza doğrulandı).

### 2. [PLANLAMA] Cutover günü — artık mobilden BAĞIMSIZ

S102'de bilinçli olarak ayrıldı (`.claude/plans/mobil-kullanima-acilis-plani.md` §0). Kalemler: ADR-031 go/no-go · kasiyer-kiosk · test verisi temizliği (`docs/ops/cutover-test-temizligi.md`) · `order_no` 1'den · rollback provası · Adisyo'nun bırakılması.

**Runbook hâlâ "TASLAK" ve bayat** (S101'den devreden, dokunulmadı): `docs/ops/cutover-gunu-runbook.md` §2'deki `codepage-scan.ps1`/CP857 reçetesi **ADR-004 Amd9 K3'e göre GEÇERSİZ** (raster'da codepage gerekmez). Aynı bayatlık `restaurant-pc-install.md` §6/§8'de. **Üç-yazıcı gerçeğini ve `print_station`'ı hiç bilmiyor** — `docs/ops`'ta `grill`/`print_station` geçmiyor. Cutover günü elde tutulacak belge bu.

### 3. [KOD] Açık chip'ler

- **API'de bozuk gövde `400` yerine `500`** — `toHttpError`'da body-parser dalı yok (`err.type==='entity.parse.failed'`). Mobil hatayı bir oturum boyunca "sunucu çöktü" gibi gösteren şey buydu.
- **Web'de paket sipariş iptali sebep sormuyor** — dine-in soruyor. ADR-027 Amd2 bilinçli mi bıraktı, önce ADR okunmalı.
- **`isSplit` orphan** — `enqueue-kitchen-job.ts:225`, #416 geri almasından arta kaldı, kullanılmıyor (`noUnusedLocals` kapalı → sessiz geçiyor).
- Eski chip'ler: `9905a8eb` web-i18n · `20f0e0c9` eski-SplitPayment-i18n.

### 4. [KOD, ops.] v5.1 planlama

`docs/audit/low-nit-devir.md` (~55 LOW + ~15 NIT) · 91 unused-exported-types · ADR-032 **Dilim C/D/E** (yazıcı ekleme + revoke + test baskısı + `kitchen_print` anahtarı) · ADR-032 Amd3'ün v5.1 izleme listesi (paket fişi audit kaydı · bayat `queued` job → `cancelled` · `packing-receipt.test.ts`).

## S102'de öğrenilenler (tekrarlanmasın)

- **`eas build:resign` eski provisioning profilini SESSİZCE yeniden kullanır** ve cihaz seçim ekranında yeni cihazlar **işaretsiz** gelir. "Başarılı" çıktısı, yeni link ve FINISHED durumu hiçbir şey kanıtlamaz — **IPA'nın içindeki `embedded.mobileprovision` sayılır.** 5 yerine 3 cihazla imzalanmıştı.
- **Devir notu bir kaynak, kanıt değil.** S102'nin "İLK İŞ"inin üçte ikisi zaten yapılmıştı.
- **Teşhisi kodun kendisinden doğrula.** "eas.json'da iOS profili yok" dedim — yanlıştı; `distribution:"internal"` iOS'ta ad-hoc demek ve runbook §11 bunu zaten yazmış. Belgeyi okumadan eksik ilan etme.
- **Yetki sınırında dur, işi durdurma.** Apple ID girişi ve hesap açma (şifre) [USER] işi; Claude komutu hazırlar, çıktıyı okur, doğrular. Bu ayrım işi yavaşlatmadı.
- **iOS ad-hoc kritik kısıt:** provisioning profili cihaz listesini **build'in içine gömer**. Cihazlar build'DEN ÖNCE kaydedilmeli; sonradan gelen `resign` ister.
- **`apps/mobile`'da OTA YOK** (`expo-updates` bağımlılıklarda değil) ve **gerçek test koşumu yok** (`"test":"echo ok"`). İkisi birleşince: canlıda çıkan hata = yeni build + her cihaza elden kurulum. Dağıtımdan önce elle smoke **pazarlığa kapalı**.

## Kapsam dışı (sessizce geri gelmesin)

TestFlight/App Store (ADR-031 kilidi) · restoran logosu/ikon (v5.1, ADR-031 Amd1 K6) · iPad desteği (`supportsTablet:false`) · `ITSAppUsesNonExemptEncryption` app.json'a ekleme (yalnız Store için gerekli) · OTA/`expo-updates` altyapısı · ADR-032 Dilim C/D/E
