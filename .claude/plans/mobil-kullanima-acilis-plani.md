# Mobil Kullanıma Açılış Planı — 2 Gün (2026-07-21 → 23)

> **Hedef (ürün sahibi, 2026-07-21):** 23 Temmuz'da garsonlar sipariş almayı **iPhone ve Android** üzerinden yapıyor olacak.
> **Kaynak kararlar:** ADR-031 (pilot go-live) · ADR-031 Amendment 1 (iOS ad-hoc) · `docs/ops/mobile-release.md` §9 + §11.

---

## 0. Kapsam kararı — MOBİL AÇILIŞ ≠ CUTOVER

Bu plan **yalnız garsonların uygulamayı kullanmaya başlamasını** kapsar. **Adisyo'nun bırakılması, test verisi temizliği, `order_no` sıfırlama ve rollback provası bu planın DIŞINDADIR** — ayrı bir cutover günü olarak sonraya kalır.

**Gerekçe:** mobil yayın işi ~1 günlük operasyon işidir ve teknik olarak hazırdır. Cutover'ın ise kapanmamış kalemleri var (`docs/ops/cutover-gunu-runbook.md` hâlâ **TASLAK** ve §2'si ADR-004 Amd9'a göre bayat; test-verisi temizliği çalıştırılmadı; rollback provası yapılmadı). İkisi aynı güne bağlanırsa **mobilde çıkan küçük bir hata cutover arızasına dönüşür** ve geri dönüş yolu karışır. Ayrıldığında mobil kendi başına doğrulanır, cutover kendi takvimiyle gelir.

**Pratik sonuç — 23 Temmuz'da ne oluyor:** garsonlar uygulamayı **gerçek serviste** kullanmaya başlıyor. Bu, sipariş girişinin v5'e geçmesi demektir; mutfak fişleri v5'ten çıkar. Adisyo'nun kasada/raporlamada ne kadar süre paralel kalacağı **ürün sahibinin operasyonel kararıdır** ve bu planı değiştirmez.

---

## 1. Kritik yol

En uzun kalem **iOS**'tur ve tek nedeni Apple girişinin `[USER]` işi olmasıdır:

```
[USER] eas device:create ──> iPhone'larda link aç ──> [CLAUDE] iOS build ──> kurulum ──> smoke
                                                          (~30 dk + EAS kuyruğu)
```

Diğer her şey buna **paralel** yürür. Kritik yolu kısaltmanın tek yolu cihaz kaydını erken bitirmektir.

---

## 2. Görev sırası

### FAZ 0 — Teknik hazırlık (21 Tem, bugün)

| # | İş | Sahip | Durum |
|---|---|---|---|
| 0.1 | Android production build (main `2b5f7909`; #409 + #406 + #393 + #394 içerir) | CLAUDE | ✅ **BİTTİ** |
| 0.2 | **`eas device:create`** → 5 iPhone kaydedildi (Fırat + Sıraç sonraya) | USER | ✅ **BİTTİ** |
| 0.3 | iOS ad-hoc build + resign (5 cihaz) | CLAUDE+USER | ✅ **BİTTİ — IPA'dan doğrulandı** |
| 0.4 | **3 yeni `waiter` hesabı**: Ceren · Recep · Sıraç (`/users` ekranından) | **USER** | ⛔ **bekliyor — tek kalan** |

**Sevk edilen paketler (ikisi de main `2b5f7909`):**

| platform | link |
|---|---|
| iOS (build `4e29245a`) | `https://expo.dev/accounts/ilhanavciii/projects/restoran-pos-garson/builds/4e29245a-7388-464b-b45c-246863882e72` |
| Android APK | `https://expo.dev/artifacts/eas/wK5Y5S3RP8XpXJDCP5k-fodmeWcyaJhCk9-Ptk8moPY.apk` |

⚠️ **Eski iOS linkleri (`04f05db2`, `db74fea1`) GEÇERSİZ** — yalnız 3 cihaz taşıyorlar. Dağıtımda daima **en son** build linki verilir ([[feedback_eas_resign_profile_stale]]).

**Kurulu profildeki 5 cihaz (IPA içinden doğrulandı):** İlhan · Recep · Ceren · İsmail · Kadir. **Fırat ve Sıraç eklendiğinde** → `eas credentials` ile profile ekle → `eas build:resign` → **IPA'yı aç, UDID say** (adım atlanırsa sessizce eski profil gömülür).

**Cihaz envanteri (ürün sahibi, 2026-07-21):** iPhone'u olanlar → **Kadir · Ceren · İlhan · İsmail · Recep · Sıraç** = **6 cihaz**. Kota 100, sorun yok. (Fırat kasiyer, dükkan PC'sinden çalışıyor → cihaz listesinde yok.)

**0.4 neden `[USER]`:** hesap açmak şifre belirlemeyi gerektiriyor; şifre üretme/girme Claude'un sınırı dışında. Ekran: `https://restoranpos.org/users` → admin ile gir → yeni kullanıcı, rol `waiter`.

**⚠️ GİRİŞ KULLANICI ADIYLA DEĞİL, E-POSTA İLE YAPILIYOR.** `LoginRequestSchema` (`packages/shared-types/src/auth.ts:5`) → `email: z.string().email()`. Sonuçları:

- `username` yalnız **görünen ad**; Türkçe karakter (`İlhan`, `Fırat`) giriş için sorun DEĞİL.
- Kritik alan **e-posta**: benzersiz + geçerli formatta olmalı. **Gerçek posta kutusu şart değil** — Kadir'in hesabı `aaa1@gmail.com` ile canlı çalışıyor (kanıt).
- **Önerilen desen:** sahip olunan alan adı kullanılsın → `ceren@restoranpos.org` · `recep@restoranpos.org` · `sirac@restoranpos.org`. Yabancı birine ait olabilecek rastgele gmail adresi kullanmaktan kaçınılır. `sıraç` → e-postada **ASCII** (`sirac`), e-posta Türkçe karakter kabul etmez.

**Mevcut hesapların giriş e-postaları (prod, doğrulandı):** Kadir `aaa1@gmail.com` · İlhan `ilhanavci499@gmail.com` · İsmail `avciismail115@gmail.com` · Fırat `sarikayaf539@hotmail.com`.

**Rol kararı (ürün sahibi):** Ceren · Recep · Sıraç → **üçü de `waiter`**. Garson rolü sipariş alma + mutfağa gönderme + ödeme alma + sipariş iptali (ADR-027 Amd2) yetkisine sahiptir; menü/kullanıcı/rapor yönetimi kapalıdır.

**Not — admin de mobili kullanabilir:** giriş ucunda rol kısıtı yok, İlhan ve İsmail kendi admin hesaplarıyla uygulamaya girebilir. Ayrı garson hesabı açmalarına gerek yok.

### FAZ 1 — Doğrulama — müşteriye dokunmadan

> **✅ 1.1 KAPANDI — 2026-07-21 akşamı, planlanandan bir gün önce.** Ürün sahibi gerçek iPhone'da tam turu koştu: sipariş → porsiyon/özellik/not → mutfağa gönder (**fiş kağıtta doğrulandı**) → iptal (sebep ekranı + iptal fişi) → ödeme. **Hepsi çalıştı.** Bu, #409 (iptal isteği sunucuya ulaşmıyordu) ve #406 (Kaydet-footgun) düzeltmelerinin canlı kanıtıdır — `apps/mobile`'da test koşumu olmadığı için başka kanıt yolu yoktu.
>
> **Ayrıca doğrulanan zincir:** IPA imzası → cihaz profilde → kurulum → **iOS Geliştirici Modu** → uygulama açıldı → prod API → garson hesabıyla giriş (İlhan-admin + Recep-waiter).

| # | İş | Sahip |
|---|---|---|
| 1.1 | ~~Ürün sahibi kendi telefonunda tam tur~~ | ✅ **BİTTİ (21 Tem)** |
| 1.2 | `docs/ops/mobile-release.md` §9 smoke (mobil veri, WiFi kapalı) — her iki platformda | USER |
| 1.3 | §11.8 iOS'a özgü 2 madde: arka-plan→ön-plan tazeleme · uçak modu bandı | USER |
| 1.4 | Çıkan hata varsa düzelt + **yeniden build** | CLAUDE |
| 1.5 | Garsonlara 30 dakikalık kullanım turu (kapalı restoranda, gerçek cihazla) | USER |

**1.1 neden bu sırayla:** #409 (iptal) ve #406 (Kaydet-footgun) tam da bu akışa dokunuyor ve **mobilde test koşumu yok** — tek yapısal koruma TypeScript. Bu turu atlamak, hatayı garsonun gerçek serviste bulması demektir.

### FAZ 2 — Canlı kullanım (23 Tem)

| # | İş | Sahip |
|---|---|---|
| 2.1 | Garsonlar gerçek serviste uygulamayı kullanır | USER |
| 2.2 | İlk servis boyunca ürün sahibi yanında — hata notları | USER |
| 2.3 | Çıkan bulgular → ertesi gün düzeltme dalgası | CLAUDE |

---

## 3. Bu planın DIŞINDA — sonraya

- **Cutover günü:** ADR-031 go/no-go · test verisi temizliği (`docs/ops/cutover-test-temizligi.md`) · `order_no` 1'den · rollback provası · Adisyo'nun bırakılması
- **Runbook tazeleme:** `cutover-gunu-runbook.md` §2 (CP857 reçetesi ADR-004 Amd9'a göre geçersiz) + üç-yazıcı/`print_station` gerçeğinin hiç yazılmamış olması · `restaurant-pc-install.md` §6/§8
- **Açık kod chip'leri:** bozuk gövde `400` yerine `500` · web'de paket iptalinde sebep sorulmuyor
- **v5.1 backlog:** `docs/audit/low-nit-devir.md` · 91 unused type · ADR-032 Dilim C/D/E

---

## 4. Kabul edilen riskler

| # | Risk | Neden kabul | Azaltım |
|---|---|---|---|
| R1 | **OTA güncelleme YOK** (`expo-updates` bağımlılıklarda yok) — canlıda çıkan hata "hemen it" ile kapatılamaz; her düzeltme yeni build (~30 dk + kuyruk) + **her telefona elden kurulum** | 2 günde OTA altyapısı kurmak yeni risk getirir | FAZ 1'in tamamı bunun için var: hatayı serviste değil provada bul |
| R2 | **Mobilde gerçek test yok** (`"test": "echo 'test: ok'"`) → tek koruma TypeScript | Bilinen borç, 2 günde kapanmaz | Elle smoke (1.1–1.3) zorunlu, atlanamaz |
| R3 | iOS ad-hoc profil **cihaz listesini build'e gömer** — sonradan gelen telefon o IPA'yı kuramaz | Ad-hoc kanalının doğası | Cihazları **cömert** kaydet. Sonradan gelirse `eas credentials` → profile ekle → `eas build:resign` → **IPA'yı aç, UDID say**. ⚠️ Resign eski profili sessizce yeniden kullanır ve yeni cihazlar seçim ekranında **işaretsiz** gelir — S102'de 5 yerine 3 cihazla imzalandı, IPA açılmasa fark edilmeyecekti ([[feedback_eas_resign_profile_stale]]) |
| R7 | **iOS Geliştirici Modu şartı** — iOS 26, ad-hoc kurulan uygulama için *Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu* + yeniden başlatma istiyor. Her cihazda **tek tek** yapılır | İmza doğrulandı (profil ve ikili `get-task-allow=false`, Apple **Distribution** sertifikası) → build defekti DEĞİL; Apple'ın dahili dağıtım için öngördüğü yol | Cihaz kurulum adımlarına kalıcı madde olarak girer. Güvenlik ödünleşimi: fiziksel-erişim saldırılarına karşı koruma bir miktar azalır; personel telefonu için kabul edildi. **Kaçınma yolu TestFlight'tır** ama ADR-031 "Store/TestFlight pilot dışı" kilidi geçerli — 5 cihazda ayar açmak sürdürülebilir olmazsa o karar yeniden değerlendirilir |
| R4 | EAS ücretsiz kuyruğu **öngörülemez** bekletebilir | Ücretli plana geçmek bugünün işi değil | Her iki build'i **erken** kuyruğa sok; iOS'u 0.2 biter bitmez başlat |
| R5 | Tek `waiter` hesabı var — garson sayısı bilinmiyor | Bilgi eksiği | 0.4'te kapanır |

---

## 5. Durdurma kriteri (no-go)

FAZ 2'ye **geçilmez** eğer:
- FAZ 1'de sipariş → mutfak → iptal zincirinin herhangi bir halkası kağıtta/ekranda doğrulanamadıysa, **veya**
- garsonların cihazlarından biri uygulamayı açamıyorsa (iOS kayıt eksiği), **veya**
- garson hesabıyla giriş yapılamıyorsa.

Bu durumda mobil açılış **kayar**; Adisyo zaten çalışıyor, kaybedilen bir şey yok.

---

*Yazıldı: Session 102 (2026-07-21). Ürün sahibi "tüm yetki sende" dedi → kapsam ayrımı (§0) ve sıralama Claude kararıdır; itiraz gelirse §0 tek maddede geri alınabilir.*
