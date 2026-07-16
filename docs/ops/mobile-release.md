# Mobil Sürüm Runbook — Garson Uygulaması (Android Release APK + iOS Ad-hoc IPA)

> Kaynak karar: **ADR-031 K9** (Android release APK sideload; prod API URL gömülü; self-signed sabit keystore kasada; build = EAS ücretsiz queue VEYA lokal gradle — "en maliyetsiz/basit"). iOS: **ADR-031 Amendment 1** (pilot kapsamında, EAS ad-hoc/internal — §11). Prod endpoint: **K1/K2** (tek Hetzner box, Nginx path-based, HTTPS).
> Bu doküman garson (`apps/mobile`) uygulamasının **Android release APK + iOS ad-hoc IPA** üretim + dağıtım prosedürüdür. Deploy runbook'u (API/web/prod sunucu) ayrı: `docs/ops/deploy.md`.

## 1. Ne üretir

İmzalı bir **Android release APK** — prod bulut endpoint'ine (`https://restoranpos.org`) gömülü olarak bağlanır, garson cihazlarına **sideload** ile kurulur. Store/TestFlight pilot dışı (v5.1); **iOS ise ad-hoc kanalıyla pilot KAPSAMINDA — bkz. §11 (ADR-031 Amendment 1)**. Garsonlar **mobil internetle** bağlanır — WiFi şartı yok (K9).

## 2. Prod URL config (nasıl gömülü — KOD)

`apps/mobile/src/config.ts` prod endpoint'lerini **hardcode** eder (tek kaynak; build anında ekstra env gerekmez):

| Değer | Dev (`__DEV__` true) | Prod (release build, `__DEV__` false) |
|---|---|---|
| `API_BASE_URL` (REST) | `http://<LAN-IP>:3001` (Metro auto-derive / override) | `https://restoranpos.org/api` |
| `SOCKET_BASE_URL` (Socket.IO) | `http://<LAN-IP>:3001` | `https://restoranpos.org` |

**Neden iki ayrı değer:** Nginx `/api` location'ı prefix'i STRIP eder → REST base'i `/api` taşır (`${API_BASE_URL}/orders` → `…/api/orders` → API `/orders` görür). Socket.IO ise host kökünde el sıkışır (`/socket.io` default path, Nginx WebSocket-upgrade bloğu) → socket base'i `/api` taşımaz; `/realtime` namespace'i `realtime/socket.ts` ekler. Dev'de ikisi de aynı `http://<host>:3001`'e çöker, ayrım yalnız release build'de görünür.

Release build `__DEV__ === false` olduğundan dev cleartext LAN/override yolu HİÇ çalışmaz; her zaman HTTPS prod URL'i döner (cleartext yok → Android release cleartext-block ile uyumlu). Prod domain değişirse (v5.1 multi-tenant) yalnız `PROD_*` sabitleri güncellenir.

## 3. Ön koşullar

- Node 22 + pnpm (repo kök `packageManager`); `pnpm install` çalışmış monorepo.
- **Yol A (EAS):** Expo hesabı (ücretsiz) + `npm i -g eas-cli` (veya `pnpm dlx eas-cli`). İnternet.
- **Yol B (lokal gradle):** Android SDK + JDK 17 + Android build araçları kurulu; `expo prebuild` için native klasör üretimi.
- **Keystore** (her iki yol) — bkz. §6. İlk build'den önce hazır olmalı.

Build öncesi lokal doğrulama (kök dizinde):
```bash
pnpm --filter @restoran-pos/mobile typecheck   # tsc --noEmit — yeşil olmalı
```

## 4. Yol A — EAS build (ÖNERİLEN — en basit)

EAS ücretsiz queue'da bulut build; keystore'u **EAS yönetir** (ilk build'de üretir, sonraki build'lerde AYNI keystore ile imzalar → K9 "sabit keystore" sağlanır).

```bash
cd apps/mobile
eas login
eas build --platform android --profile production   # eas.json → production: apk + internal
```

- İlk build keystore sorarsa **"Generate new keystore"** seç (EAS saklar). Sonraki tüm build'ler bu keystore'u otomatik kullanır.
- Build bitince EAS bir **APK indirme linki** verir (veya `eas build:list` → indir).
- **Keystore'u kasaya yedekle (K9 zorunlu):** `eas credentials` → Android → keystore'u indir (`.jks` + parolalar) → parola yöneticisi + offline kopya. EAS hesabı kaybı = keystore kaybı = güncelleme imzalayamama.

## 5. Yol B — Lokal gradle build

İnternetsiz / EAS'siz alternatif. Native Android projesini üretip yerel keystore ile imzalar.

```bash
cd apps/mobile
npx expo prebuild --platform android     # android/ klasörünü üretir (git-ignored, geçici)
# keystore üret (§6) → android/app/ altına koy veya mutlak yol ver
# android/gradle.properties + app/build.gradle signingConfig'e keystore'u bağla
#   (RELEASE_STORE_FILE / RELEASE_STORE_PASSWORD / RELEASE_KEY_ALIAS / RELEASE_KEY_PASSWORD)
cd android && ./gradlew assembleRelease
# çıktı: android/app/build/outputs/apk/release/app-release.apk
```

> `expo prebuild` `android/`'i sıfırdan üretir; commit ETME (repo yalnız `app.json` + config tutar — "prebuild-on-demand"). Keystore dosyasını da repoya KOYMA.

## 6. Keystore custody (ADR-031 K9)

- Keystore, **age yedek anahtarı gibi** saklanır: parola yöneticisi + **offline** kopya (USB/kağıt). Sunucuda/repoda tutulmaz.
- **Tüm gelecekteki güncellemeler AYNI keystore ile imzalanır.** Farklı keystore → `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (signature mismatch) → uygulamayı **kaldır + yeniden kur** gerekir → cihazda oturum/veri kaybı.
- İmzasız APK Android'e HİÇ kurulmaz (`INSTALL_PARSE_FAILED_NO_CERTIFICATES`).
- Lokal keystore üretimi (Yol B):
  ```bash
  keytool -genkeypair -v -keystore garson-release.jks -alias garson \
    -keyalg RSA -keysize 2048 -validity 10000
  ```
- Play App Signing v5.1 (store dağıtımı pilot dışı).

## 7. Sürümleme

- `app.json` → `expo.version` (kullanıcıya görünen sürüm) + Android `versionCode` (tam sayı, her sürümde ARTIRILIR — Android güncelleme semantiği bunu gerektirir).
- **Yol A (EAS):** `eas.json` → `appVersionSource: "remote"` → `versionCode`'u EAS otomatik artırır (elle yönetme).
- **Yol B (lokal):** `app.json` → `expo.android.versionCode`'u her release'de elle artır (prebuild bunu `android/`'e taşır).

## 8. Sideload (garson cihazına kurulum)

1. APK'yı cihaza aktar (USB, e-posta, indirme linki).
2. Android → Ayarlar → "Bilinmeyen kaynaklardan kuruluma izin ver" (ilgili uygulama/dosya yöneticisi için).
3. APK'ya dokun → kur. (SmartScreen Windows'a özgü — Android'de yok; "Play Protect" uyarısı çıkarsa "yine de kur".)
4. iOS cihaz kurulumu: **§11.5** (ad-hoc install linki — ADR-031 Amendment 1 ile pilot kapsamına alındı; TestFlight değil).

## 9. Doğrulama (smoke — DoD)

Cihaz **mobil veriyle** (WiFi kapalı — K9 mobil-internet senaryosunu doğrula):

- [ ] Uygulama açılıyor; **garson** kullanıcısıyla prod'a login (REST → `https://restoranpos.org/api/auth/login` çözülüyor).
- [ ] Masalar board'u yükleniyor (REST prod URL doğru).
- [ ] Bir masaya sipariş gir → **mutfak/KDS <2 sn içinde görüyor** (charter :132; Socket.IO prod URL `https://restoranpos.org` + `/realtime` namespace çözülüyor).
- [ ] İkinci bir değişiklik (web veya başka cihaz) mobil masa kartını canlı tazeliyor (realtime iki-yön).

Bu üç madde hem REST (`/api` prefix'li) hem socket (`/api`'siz, `/socket.io` path) prod URL'lerinin **birlikte** doğru çözüldüğünü kanıtlar (§2 asimetri).

## 10. Güncelleme / rollback

- **Güncelleme:** yeni APK'yı AYNI keystore ile imzala (§6) → `versionCode` artır (§7) → sideload (üstüne kurulur, veri korunur).
- **Rollback:** önceki imzalı APK'yı sakla; sorun olursa onu yeniden kur. Prod API rollback ayrı: `docs/ops/deploy.md §10`.

## 11. iOS Sürüm — Ad-hoc / Internal (ADR-031 Amendment 1)

> Kaynak karar: **ADR-031 Amendment 1** (iOS pilot kapsamında; **EAS ad-hoc/internal** — K9'un "App Store/TestFlight pilot dışı" İLKESİ korunur, ad-hoc ayrı kanaldır, Apple review yok). iOS app Android'le **birebir aynı JS** — §2 prod URL config'i aynen geçerli (tek kod tabanı; iOS-özel kod işi YOK, Amd1 K5). `eas.json` değişikliği GEREKMEZ: `production` profili `distribution:"internal"` iOS'ta ad-hoc anlamına gelir.

### 11.1 Ne üretir

İmzalı bir **ad-hoc IPA** — yalnız UDID'i kayıtlı iPhone'lara kurulur; prod endpoint gömülü (§2). Kurulum doğrudan EAS install linki/QR ile (store yok, review yok). Ad-hoc sınırı: **≤100 iPhone / üyelik-yılı** (küçük pilot için fazlasıyla yeter).

### 11.2 Ön koşullar

- **Apple Developer Program üyeliği (~$99/yıl, Individual)** — **[USER] işi** (Claude hesap açamaz / ödeme giremez):
  1. <https://developer.apple.com/programs/enroll/> → Apple ID ile gir (2FA açık olmalı; yoksa önce Apple ID oluştur).
  2. **Individual** enrollment → kimlik/adres bilgileri → yıllık ücret (~$99 USD) ödemesi.
  3. Onay e-postası (çoğunlukla <48 saat) → üyelik aktif.
- Expo hesabı zaten var (`app.json` → `owner: ilhanavciii`) + `eas-cli` (§3 Yol A ile aynı).
- **Mac GEREKMEZ** — EAS bulutta derler ve imzalar; her şey Windows'tan yönetilir.

### 11.3 Cihaz kaydı (UDID — ad-hoc şartı)

```bash
cd apps/mobile
eas device:create   # kayıt linki/QR üretir → garson iPhone'unda aç → profil kur → UDID otomatik kaydolur
```

- Her garson iPhone'u **ilk build'den önce** kaydedilir (kayıtsız cihaza ad-hoc IPA kurulmaz).
- **Sonradan cihaz ekleme:** `eas device:create` ile kaydet → ya yeni build al ya da mevcut build'i `eas build:resign` ile güncel provisioning'e yeniden imzala (daha hızlı).

### 11.4 Build (EAS — Android Yol A'nın iOS karşılığı)

```bash
cd apps/mobile
eas login
eas build --platform ios --profile production   # eas.json → production: distribution "internal" → ad-hoc IPA
```

- İlk build'de EAS **Apple hesabına bağlanmak ister** (Apple ID login) → dağıtım sertifikası + ad-hoc provisioning profile'ı EAS üretir ve saklar (sonraki build'ler otomatik).
- **Credentials custody:** EAS saklar (`eas credentials` → iOS). Not: iOS sertifika kaybı Android keystore kaybı kadar ölümcül DEĞİL — Apple hesabından yeni sertifika üretilir, cihazlardaki kurulum bozulmaz; ama build hattı durur → EAS + Apple hesap erişimini yine de kasada tut (§6 üslubu).

### 11.5 Kurulum (garson iPhone'una)

1. Build bitince EAS **install linki/QR** verir (`eas build:list` → son build → install URL).
2. Kayıtlı iPhone'da **Safari** ile aç → "Yükle" → ana ekrana iner.
3. Gerekirse: Ayarlar → Genel → **VPN ve Cihaz Yönetimi** → geliştirici sertifikasına güven.

### 11.6 Dev-loop (Apple hesabı GEREKMEZ — bugün çalışır)

Android'dekiyle aynı Expo Go LAN akışı (Amd1 K4; `config.ts` Metro `scriptURL`'den LAN-IP türetir):

1. iPhone'a App Store'dan ücretsiz **Expo Go** kur.
2. Dev makinede: `npx expo start --lan` (detached başlat; non-TTY QR basmaz → `exp://<LAN-IP>:8081` URL'ini kullan).
3. iPhone **aynı WiFi'de** → kamerayla QR okut veya Expo Go'ya URL'i elle gir → canlı UI + Fast Refresh.
4. API dev'de `http://<LAN-IP>:3001`'e çözülür (§2 dev satırı; lokal API + pos_dev ayakta olmalı).

> **⚠️ SDK-uyum notu:** App Store'daki Expo Go **yalnız en yeni Expo SDK'yı** çalıştırır. Proje SDK 54; App Store Expo Go daha yeni SDK'ya geçtiyse "incompatible SDK" hatası verir → o durumda ya proje SDK upgrade (ayrı iş) ya da Apple hesabı sonrası **development build** (`eas build --platform ios --profile development`) ile dev-loop. İlk canlı denemede belli olur.

### 11.7 Sürümleme / güncelleme / rollback

- `appVersionSource: "remote"` → iOS **buildNumber**'ı EAS otomatik artırır (§7 Android `versionCode` ile aynı semantik; elle yönetme).
- **Güncelleme:** yeni build → aynı yolla kur (bundle ID `com.restoranpos.garson` sabit → üstüne kurulur, oturum/veri korunur).
- **Rollback:** önceki build'in install linki EAS'ta durur (`eas build:list`) → onu yeniden kur.

### 11.8 Doğrulama (smoke — DoD, iki-platform)

§9'daki 4 Android smoke maddesi iOS cihazda **AYNEN** koşulur (mobil veri, WiFi kapalı) + iOS'a özgü 2 madde:

- [ ] Arka-plan → ön-plan geçişinde masa board'u kendini tazeliyor (iOS socket'i askıya alır; `connect`-resync #361).
- [ ] Uçak modu → çevrimdışı bandı görünür; kapatınca kaybolur ve veriler tazelenir.

İki platform da geçince → **iki-platform pilot go/no-go** (ADR-031 K10 + Amendment 1 DoD).
