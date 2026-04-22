# Changelog

Bu dosya her önemli değişikliği tarih sırasıyla kaydeder. `/phase-done` ve `/new-adr` slash command'ları bu dosyayı otomatik günceller.

Format: [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/).

Sürüm şeması: Phase 0 → 0.0.x, Phase 1 → 0.1.x, pilot → 0.9.x, prod → 1.0.0.

## [Unreleased]

### Added
- Phase 0 bootstrap paketi (CLAUDE.md, sub-agent'lar, skill'ler, engineering docs)
- v4'ten taşınan altyapı: architect/implementer/qa/security/hci/turkish-ux/db-migration-guard sub-agent'ları
- v4'ten taşınan skill'ler: escpos-printer, caller-id-bridge, hci-pos-checklist, turkish-restaurant-domain, multi-tenant-postgres (MVP tek tenant notuyla), react-native-expo-setup, hetzner-deployment
- Engineering docs: code-style, definition-of-done, git-workflow, test-strategy
- Slash command'lar: `/new-adr`, `/phase-done`
- Hook'lar: ADR hatırlatması, commit format kontrolü, oturum açılış notu
- `docs/domain/personas.md` — 4 rol (admin, kasiyer, garson, mutfak) + yetki matrisi
- `docs/project-charter.md` — v5.0 MVP / v5.1 / v5.2+ / non-goals ayrımı
- Phase roadmap (5 phase, 23 hafta ≈ 5.5 ay)

### Changed
- **Kapsam revizyonu** (charter v2): v3'ün gerçek modül kapsamına göre charter yeniden yazıldı
- MVP dondurulmuş özellik listesi: auth + masa + menü + sipariş + mutfak + ödeme + Caller ID + Print Agent + temel raporlar + web + mobile + audit/yedek backend
- v5.1'e ertelendi: detaylı raporlar, stok, rezervasyon, müşteri CRM, audit/yedek/sürüm notları/mobil eşleştirme UI'leri
- Kalıcı non-goal olarak işaretlendi: çoklu şube (v5.2'de değerlendirilir), e-Fatura, yazarkasa, yemek platformları, QR menü, sadakat, combo
- StoreBridge → v5'te Print Agent olarak yeniden adlandırıldı (aynı iş, temiz mimari)
- Proje özeti: "30 masalı" → "25 masalı pide/lokanta" (v3 ekranlarından doğrulandı)

### Removed
- v4'ten: Electron bağımlılığı (desktop app → web UI)
- v4'ten: Lokal SQLite (cloud PostgreSQL tek DB)
- v4'ten: CRDT/sync engine ve ilgili skill'ler (`better-sqlite3-electron`, `sync-crdt-patterns`)
- v4'ten: electron-specialist, sync-engine-specialist sub-agent'ları
- v4'ten: 22+ v4 ADR'si (v5 kendi kararlarını yazacak)
- v4'ten: 5 journey, 5 persona, event-storming dokümanları (MVP kapsamına uygun değil)
- v4'ten: `sync-schemas` slash command'ı (tek DB, sync yok)

### Timeline
- 2026-04-22: İlk charter (kapsam yanlış, çok dar)
- 2026-04-22: Charter v2 — v3 ekran görüntüleri incelendi, kapsam v3 seviyesine güncellendi, MVP/v5.1 ayrımı yapıldı
