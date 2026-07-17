---
name: react-native-expo-setup
description: Use when setting up, configuring, or building the mobile app (apps/mobile). Covers Expo SDK 54 managed workflow, Expo Go + Metro LAN dev-loop (no dev-client), cloud API + Socket.IO architecture (no native modules, no local DB), and the EAS release pipeline (Android APK sideload + iOS ad-hoc — ADR-031 Amd1).
---

# React Native + Expo — apps/mobile (SEVK EDİLEN GERÇEKLİK)

Garson uygulaması. **Tek doğruluk kaynakları:** ADR-025 (kickoff) · ADR-026 + Amd1/Amd2 (UI kuralları + resync + bağlantı-göstergesi) · ADR-027 (operasyonel terminal) · ADR-031 Amd1 (iOS pilot) · `docs/ops/mobile-release.md` (dağıtım runbook'u). Bu skill onların özetidir — çelişki görürsen ADR kazanır.

> ⚠️ Bu dosyanın eski sürümü hiç inşa edilmemiş bir mimariyi (mDNS "ana bilgisayar" keşfi, PIN girişi, lokal SQLite, expo-router, landscape, TestFlight/OTA) anlatıyordu — S98'de sevk edilen durumla eşitlendi. O kavramların HİÇBİRİ v5'te yok.

## Mimari (ne VAR, ne YOK)

| Konu | Gerçek |
|---|---|
| Stack | Expo SDK **~54** (managed — `ios/`/`android/` klasörü YOK), RN 0.81.x, React 19 |
| Paket adı | `@restoran-pos/mobile` (pnpm workspace; `@restoran-pos/shared-types`/`shared-domain` import edilir) |
| Backend | **Cloud API** (`https://restoranpos.org`) + Socket.IO `/realtime` namespace (handshake `auth.token`). LAN "ana bilgisayar" kavramı YOK |
| Native modül | **YOK** (mdns/zeroconf/sqlite/printer-bridge yok — yazdırma sunucu tarafında print-agent'ta). Bu yüzden **Expo Go çalışır** |
| Server-state | TanStack Query v5 (ADR-026 K4); sepet saf-lokal state. **Lokal DB/offline-sync YOK** — çevrimdışılık: OfflineBanner + mutation `networkMode:'always'` + idempotency-key (#345) |
| Resync | socket-event invalidate + `connect` tam-resync + focus-refetch + Masalar 45sn emniyet-poll + AppState→socket dürtmesi (ADR-026 **Amd1**) + header bağlantı-noktası eşikli durum-makinesi (**Amd2**) |
| Navigasyon | `@react-navigation/native-stack` (**expo-router DEĞİL**); Adisyon ayrı ekran değil, Order üstü bottom-sheet |
| Auth | **e-posta + şifre** (ADR-026 K9; PIN v5.1). Token'lar `expo-secure-store`; 401 → tek-uçuş silent refresh |
| UI | Portrait-only, koyu-slate header, RN StyleSheet token'ları (`src/theme.ts` — ekranda literal hex yasak). shared-ui reuse REDDEDİLDİ (ADR-026) |
| i18n | TR-only (`src/i18n/locales/tr.json`); tüm görünür metin `t()` — dinamik template-key KULLANMA (i18n-key-checker literal ister) |
| Test | Mobilde test-runner YOK (`test: echo ok` stub) — doğrulama = typecheck/lint + **gerçek-cihaz canlı smoke**. Detox aspirasyonel, kurulmadı |

## Dev-loop (Expo Go + Metro LAN — Mac/Apple-hesabı GEREKMEZ)

1. Lokal stack: Postgres (pos_dev — **önce migration head'ini doğrula**: `SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1` repo'daki son dosyayla eşleşmeli; bayatsa `packages/db && DATABASE_URL=<pos_dev> pnpm migrate`) + API (3001) + Metro. `.claude/launch.json`'da `api`/`metro`/`web` preview-config'leri hazır.
2. Metro: `npx expo start --lan` (non-TTY QR basmaz → `exp://<LAN-IP>:8081` URL'ini kullan; QR gerekirse `segno` ile üret).
3. Telefon **aynı WiFi'de** → Expo Go (App Store/Play, ücretsiz) → QR/URL. `src/config.ts` API'yi Metro `scriptURL`'inden türetir (dev `http://<LAN-IP>:3001`); prod URL build'e gömülü.
4. Dev login: `garson@local.test` / `garson1234` (lokal seed; **e-posta ister**, kullanıcı-adı değil).
5. ⚠️ `expo start` `apps/mobile/tsconfig.json`'ı kendiliğinden değiştirir — commit'ten önce `git checkout -- apps/mobile/tsconfig.json`.

## Dağıtım (ADR-031 + Amd1; ayrıntı: `mobile-release.md`)

- **Android:** EAS production build → **APK sideload** (`eas build --platform android --profile production`); **AYNI keystore** (EAS'ta, kasada yedek) — üstüne-kurulum veri korur. Link elle yazdırma → **QR ile teslim** (elle yazılan link BUILD_NOT_FOUND verdi, S97 dersi). `appVersionSource: "remote"` → versionCode/buildNumber EAS'ta otomatik.
- **iOS:** **EAS ad-hoc/internal** (Amd1; Store/TestFlight pilot-dışı, OTA/expo-updates YOK): Apple Developer üyeliği → `eas device:create` (UDID) → `eas build --platform ios --profile production` → install-link/QR (runbook §11). Mac gerekmez.
- Rollout gerçeği: JS değişikliği canlı cihaza **ancak yeni build'le** biner (Expo Go dev'de anında).

## Bilinen tuzaklar (yaşanmış)

- Fast Refresh root-level değişikliklerde tam reload yapar; Expo Go'dan çıkmak **bellek-içi cache'i siler** (soğuk başlangıç).
- App Store'daki Expo Go **yalnız en yeni SDK'yı** açar — SDK uyumsuzluğu görürsen runbook §11.6 notu (SDK upgrade veya dev-build).
- iOS NetInfo ön-plan geçişinde kısa yanlış-"İnternet bağlantısı yok" bandı gösterebilir (Google-probe transient) — bizim API ile ilgisi yok.
- RefreshControl `refreshing`'i global `isRefetching`'e BAĞLAMA (arka-plan refetch spinner'ı takılı bırakır — Amd1'de lokal pull-state'e çevrildi); tam-ekran hata dalında `isError` değil **`isLoadingError`** kullan (cache'li refetch hatası ekranı silmesin).
- Android emülatör kullanılmıyor (gerçek cihaz + Expo Go LAN); emülatör gerekirse host = `10.0.2.2`.
