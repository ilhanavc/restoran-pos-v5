# Aktif Plan — Phase 4: Mobil Garson Uygulaması (İŞ DEVAM EDİYOR)

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince **tamamen yenilenir**.
> Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap". Geçmiş detay: git history + memory `project_session_*_summary.md`.

**Son güncelleme:** 2026-06-28 (Session 71)
**main HEAD:** `998f32e` (PR #208 sonrası) · **0 açık PR**

## Durum: Phase 0-3 ✅ · Phase 4 mobil backend+iskelet ✅ · ekranlar sıradaki

| Faz | Durum |
|---|---|
| Phase 0-2 | ✅ |
| Phase 3 Sipariş+Mutfak+Ödeme+Yazıcı+Rapor | ✅ (Session 70, tag `v0.3.0`) |
| **Phase 4** Mobil + Caller ID + Audit + Yedek | 🔄 **mobil DEVAM** (Caller ID / Audit / Yedek ✅) |
| Phase 5 Pilot + Migration | ⛔ Başlamadı |

## Phase 4 — Mobil Garson Uygulaması (ADR-025)

Caller ID (ADR-016, Sprint 8), Audit (#202/ADR-024), DB yedek (#199/ADR-023) **zaten bitti**. Phase 4'ün kalan tek büyük işi = **mobil garson app** (`apps/mobile`, sıfırdan). Kickoff Session 71'de başladı.

### İş kalemleri (ADR-025'te kilitli)

1. **ADR-025 Mobil Kickoff** — ✅ #204 (Android-first + iOS fast-follow; saf cloud client; **native modül YOK** mDNS/SQLite/printer-bridge dışı; K4 garson ABAC genişletme; Expo SDK 54; portrait + i18n; skill BAYAT-uyarısı)
2. **Auth body-refresh** — ✅ #205 (`X-Client:mobile` body-refresh + **token-source gate** XSS HttpOnly-bypass önlemi; ADR-002 §2.1 amendment; security-reviewer APPROVED)
3. **Garson ABAC genişletme (K4)** — ✅ #206 (tenant-geneli açık adisyon GÖR+kalem EKLE; **item-owner void guard**; ADR-008 §7 amendment + K4 architect-drift düzeltmesi; security-reviewer APPROVED)
4. **Tipli `orders.*` realtime** — ✅ #207 (colon→dot ADR-010 §11.6; `customerId` nullable runtime-bug typecheck'le yakalandı; canlı masa senkronu hazır)
5. **Mobil iskelet (Expo SDK 54)** — ✅ #208 (monorepo metro + i18n; **gerçek Android telefonda doğrulandı**)
6. **EKRANLAR — ⏳ SIRADAKİ:** Login → Masa listesi → Sipariş girişi → Adisyon görüntüleme. Her UI PR'ında **hci-reviewer + turkish-ux-reviewer + i18n-key-checker** gate (K9). Canlı hot-reload + telefon testi. UI'ı önce mock ile kur (akış telefonda test edilir), gerçek API'yi backend-bağlantısı çözülünce bağla.

### Mobil dev-loop (KANITLANDI — Session 71)

- `cd apps/mobile && npx expo start --lan` (detached) → telefonda **Expo Go** → `exp://<PC-LAN-IP>:8081` (non-TTY QR basmaz, URL elle girilir). Aynı WiFi şart; firewall/farklı-ağ → `--tunnel`. Reçete: [[feedback_mobile_expo_go_devloop]].
- Native modül YOK (K3) → Expo Go yeterli. UI/akış hemen telefonda test edilebilir; gerçek veri backend ister.

### 🔴 Açık karar — backend bağlantısı (İş Kalemi 5'te login'i gerçek API'ye bağlarken)

Telefonun gerçek login/sipariş için **API + DB**'ye ulaşması gerek. **Lokal Docker ÇÖKTÜ** (Docker Desktop "Inference manager" / Model Runner). Seçenekler: (a) Docker'ı düzelt (Model Runner kapat), (b) Windows'a native Postgres, (c) Hetzner'e dev API deploy (telefon her yerden bağlanır). UI'ı mock ile kurup akışı telefonda test edebiliriz; gerçek auth bu kararı bekler.

## Açık borçlar (mobil-dışı, düşük öncelik)

- Deploy-zamanı manuel smoke (sunucu/donanım): DB yedek restore drill (`docs/ops/backup-strategy.md` §9) + USB yazıcı pilot.
- CHANGELOG Session 53-69 backfill (kısmi).
- Worktree disposal (Windows file-lock, kozmetik).

## Çalışma kuralları (değişmez — CLAUDE.md)

- ADR önce, kod sonra. DoD olmadan "bitti" yok. Branch-first. Cerrahi değişiklik.
- UI → hci+turkish-ux+i18n. Auth/payment/PII → security-reviewer. DB şema → db-migration-guard.
- Kapsam kilidi: v5.0 MVP'de yoksa v5.1 backlog veya ADR.
- **Lokal Postgres yok → entegrasyon testleri CI'da doğrulanır** (lokalde Docker başlatma denenmez). Test-fixture tuzakları: [[feedback_api_integration_test_fixtures]].
