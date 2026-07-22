# Session 104 — Kickoff (Session 103 devri, 2026-07-22)

## Tek cümlede

S103 **cutover hazırlık günüydü**: 10 PR, prod'a deploy (migration 050 dahil), ürün sahibinin canlıda bulduğu **3 bug** düzeltildi, yetim-kuyruk göstergesi **gerçek olayla sınandı** ve **OTA kapsama alındı** — geriye yeni mobil paketin cihazlara kurulumu ve cutover gününün kendisi kaldı.

## Durum

| | |
|---|---|
| main | **`d4c9d57`** |
| **prod (kod)** | **`f30f882`** · migration **050** — ✅ deploy edildi |
| main − prod farkı | **yalnız mobil** (#433 + #434); API/web değişikliği yok → prod kod açısından güncel |
| Açık PR | yok · 13 eski draft audit PR (#329-341) duruyor |
| Mobil paketler | ⏳ **S103 sonunda build başlatıldı**: iOS `f7f325d4` · Android `4e0b2411` (main `d4c9d57`'den) |
| Bir önceki iOS | `f39905bb` — 6 cihaz, **OTA ve fiş düzeltmesi YOK** |
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
