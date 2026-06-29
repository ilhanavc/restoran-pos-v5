# Aktif Plan — Phase 4: Mobil Garson Uygulaması (İŞ DEVAM EDİYOR)

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince **tamamen yenilenir**.
> Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap". Geçmiş detay: git history + memory `project_session_*_summary.md`.

**Son güncelleme:** 2026-06-29 (Session 72)
**main HEAD:** `412f30c` (PR #212 sonrası) · **0 açık PR**

## Durum: Phase 0-3 ✅ · Phase 4 mobil backend+iskelet ✅ · ekranlar 🔄 (5a/5b ✅, 5c/5d sırada)

| Faz | Durum |
|---|---|
| Phase 0-2 | ✅ |
| Phase 3 Sipariş+Mutfak+Ödeme+Yazıcı+Rapor | ✅ (Session 70, tag `v0.3.0`) |
| **Phase 4** Mobil + Caller ID + Audit + Yedek | 🔄 **mobil ekranlar DEVAM** (Caller ID / Audit / Yedek ✅) |
| Phase 5 Pilot + Migration | ⛔ Başlamadı |

## Phase 4 — Mobil Garson Uygulaması (ADR-025 + ADR-026)

Caller ID (ADR-016, Sprint 8), Audit (#202/ADR-024), DB yedek (#199/ADR-023) **zaten bitti**. Phase 4'ün kalan tek büyük işi = **mobil garson app** (`apps/mobile`). Backend+iskelet Session 71'de (#204-208), ekranlar Session 72'de başladı.

### İş kalemleri

1. **ADR-025 Mobil Kickoff** — ✅ #204 (Android-first; saf cloud client; **native modül YOK**; K4 garson ABAC; Expo SDK 54; portrait + i18n)
2. **Auth body-refresh** — ✅ #205 (`X-Client:mobile` body-refresh + token-source gate; ADR-002 §2.1; security APPROVED)
3. **Garson ABAC genişletme (K4)** — ✅ #206 (tenant-geneli açık adisyon GÖR+kalem EKLE + item-owner void guard; ADR-008 §7; security APPROVED)
4. **Tipli `orders.*` realtime** — ✅ #207 (colon→dot ADR-010 §11.6; canlı masa senkronu hazır)
5. **Mobil iskelet (Expo SDK 54)** — ✅ #208 (monorepo metro + i18n; gerçek Android'de doğrulandı)
6. **EKRANLAR (İş Kalemi 5) — 🔄 DEVAM (ADR-026 kural kitabı, mockup 6-iter onaylı):**
   - **ADR-026** Mobil Garson UI Tasarım Kuralları ✅ #210 — ADR-011'in mobil muadili; **Adisyon ayrı ekran DEĞİL = Order üstü sepet alt-sheet**; **Kaydet = kaydet + mutfağa otomatik** (ayrı buton yok); **K6 frontend EXPLICIT gating** (yetkisiz aksiyon hiç render edilmez); demir: web kasiyer akışı + ürün sahibi aktif POS app (görsel ilham).
   - **PR-5a** Navigation v7 native-stack + i18n + mock + **Login** ✅ #211 (cihazda doğrulandı; şifre göster/gizle + e-posta hatırlama/remember-me + body-refresh).
   - **PR-5b** **Masalar** ekranı ✅ #212 (TanStack Query mock seam, 3-sütun KARE kart, bölge pill dolu-sayısı, boş/dolu-amber+₺tutar+kompakt-canlı-süre/60dk-kırmızı, K6 gating, Tables→Order nav; cihazda doğrulandı; garson adı + boş-kart "+" kaldırıldı).
   - **PR-5c — ⏳ SIRADAKİ:** Order ekranı — koyu başlık + sepet-ikonu(rozet) + renkli **kategori ızgarası** (`category.color`) + ürün katalog (dokun=direkt-ekle, ADR-013 §10) + sepet ikonu→**Adisyon alt-sheet** (kalem stepper +/adet/çöp; void yalnız own `status='new'`) + kalıcı koyu **Kaydet** barı. Mock veri.
   - **PR-5d:** Gerçek API + realtime — `POST /auth/login`(X-Client:mobile)/`GET /tables`+`/areas`/`/menu/*`/`POST /orders`/`POST /orders/:id/items` + `orders.*` events (ADR-010 §11.6). Backend = **Windows native Postgres** (aşağı). Gate: +**security-reviewer**.
   - Her UI PR'ında **hci + turkish-ux + i18n** gate (K9). Mock-first → telefon testi → gerçek API.

### Mobil dev-loop (KANITLANDI — Session 71/72)

- **Başlatma (Session 72 güncel reçete):** `EXPO_NO_DEPENDENCY_VALIDATION=1 EXPO_OFFLINE=1 REACT_NATIVE_PACKAGER_HOSTNAME=<LAN-IP> pnpm --filter @restoran-pos/mobile exec expo start --lan --clear` (detached). İlk iki env Node22 undici "Body has already been read" çökmesini engeller. Telefonda **Expo Go** → `exp://<LAN-IP>:8081` (non-TTY QR basmaz, URL elle; LAN IP `os.networkInterfaces`, WSL/vEthernet atla — Session 72: `192.168.1.88`). Aynı WiFi şart; farklı-ağ → `--tunnel`. TaskStop sonrası port 8081 takılırsa `taskkill //PID <pid> //F`. Demo kimlik (mock): `ahmet@restoran.com` / `1234`. Reçete: [[feedback_mobile_expo_go_devloop]].
- Native modül YOK (K3) → Expo Go yeterli. **3 Metro/monorepo keşif tuzağı çözüldü** (metro.config + package.json): react-singleton (kök hoisted react@18) · @expo/vector-icons doğrudan dep (CI frozen-lockfile) · `.js→.ts` resolver (shared-domain NodeNext). Yeni RN-lib/shared-paket eklerken bu sınıf tekrar çıkabilir → metro.config + frozen-lockfile kontrol.

### ✅ Karar verildi — backend bağlantısı: Windows native Postgres (Session 72)

Gerçek login/sipariş için **Windows'a native PostgreSQL** kurulur + API PC'de çalışır, telefon LAN IP ile bağlanır (Docker yerine — Docker Desktop çökmüştü). **PR-5d'de** kurulur. 5a-5c mock ile sürer.

## Açık borçlar (mobil-dışı, düşük öncelik)

- Deploy-zamanı manuel smoke (sunucu/donanım): DB yedek restore drill (`docs/ops/backup-strategy.md` §9) + USB yazıcı pilot.
- CHANGELOG Session 53-69 backfill (kısmi).
- Worktree disposal (Windows file-lock, kozmetik).

## Çalışma kuralları (değişmez — CLAUDE.md)

- ADR önce, kod sonra. DoD olmadan "bitti" yok. Branch-first. Cerrahi değişiklik.
- UI → hci+turkish-ux+i18n. Auth/payment/PII → security-reviewer. DB şema → db-migration-guard.
- Kapsam kilidi: v5.0 MVP'de yoksa v5.1 backlog veya ADR.
- **Lokal Postgres yok → entegrasyon testleri CI'da doğrulanır.** **Kod PR'ında merge'den önce CI yeşilini POLL ile bekle** (auto-merge gerekli-check yoksa anında merge eder) → [[feedback_merge_wait_ci_no_required_checks]]. Test-fixture tuzakları: [[feedback_api_integration_test_fixtures]].
