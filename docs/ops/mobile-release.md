# Mobil Sürüm Runbook — Garson Uygulaması (Android Release APK)

> Kaynak karar: **ADR-031 K9** (Android release APK sideload; prod API URL gömülü; self-signed sabit keystore kasada; build = EAS ücretsiz queue VEYA lokal gradle — "en maliyetsiz/basit"). Prod endpoint: **K1/K2** (tek Hetzner box, Nginx path-based, HTTPS).
> Bu doküman garson (`apps/mobile`) uygulamasının **release APK** üretim + dağıtım prosedürüdür. Deploy runbook'u (API/web/prod sunucu) ayrı: `docs/ops/deploy.md`.

## 1. Ne üretir

İmzalı bir **Android release APK** — prod bulut endpoint'ine (`https://restoranpos.org`) gömülü olarak bağlanır, garson cihazlarına **sideload** ile kurulur. Store/TestFlight pilot dışı (v5.1). Garsonlar **mobil internetle** bağlanır — WiFi şartı yok (K9).

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
4. 5 iOS cihaz sonraki faz (Apple Developer ~$99/yıl + TestFlight — Android stabilize olunca ayrı iş kalemi, ADR-031 açık soru #5).

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
