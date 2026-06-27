# Aktif Plan — Faz geçişi (Phase 3 ✅ kapandı → Phase 4 bekliyor)

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince **tamamen yenilenir**.
> Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap". Geçmiş sprint detayları: git history + memory `project_session_*_summary.md`.

**Son güncelleme:** 2026-06-27 (Session 70)
**main HEAD:** PR #196 sonrası

## Durum: Phase 0-3 ✅ tamamlandı, Phase 4 başlamadı

| Faz | Durum |
|---|---|
| Phase 0 Bootstrap | ✅ |
| Phase 1 Core Domain + Auth | ✅ |
| Phase 1.5 Drift cleanup | ✅ |
| Phase 2 API + Web UI | ✅ Mühürlendi (Session 57) |
| **Phase 3** Sipariş+Mutfak+Ödeme+Yazıcı+Rapor | ✅ **9/9 KAPANDI** (Session 70, PR #192 — USB smoke DoD §D) |
| Phase 4 Mobile + Caller ID + Audit + Yedek | ⛔ **Başlamadı** (aşağı) |
| Phase 5 Pilot + Migration | ⛔ Başlamadı |

## Şu an aktif sprint YOK — Phase 4 kickoff ADR'si bekliyor

Phase 3 kapandı, Phase 4 henüz ADR'lenmedi. Sıradaki iş Phase 4 başlangıç ADR'sini yazmak (architect).

### Phase 4 gerçek kalan iş (denetimde netleşti — Session 70)

Charter "Mobile + Caller ID + Audit + Yedek" diyor ama **Caller ID ZATEN yapılmış** (ADR-016, PR #99/#100 Sprint 8 — caller-bridge .NET 8 + caller-id/customers route). Gerçek kalan:

1. **Mobile garson uygulaması** — `apps/mobile` şu an boş iskelet (`src/index.ts = export {}`, 0 dependency, Expo yok). **Sıfırdan.** En büyük parça. ADR gerekiyor (Expo SDK 53+ dev client, monorepo entegrasyon, LAN discovery, printer bridge — `react-native-expo-setup` skill referansı).
2. **Audit log tamamlama** — backend `audit_logs` şema (ADR-003 §12) + `writeAudit` var; viewer UI v5.1'e ertelenmiş. Kapsam netleştirilecek.
3. **Otomatik DB yedek** — ADR bile yok (sadece `hetzner-deployment` skill'inde değiniliyor). Cron + Hetzner Storage Box / S3.

## Session 70'te tamamlananlar (bu oturum)

- **Phase 3 9/9 closure** (#192): PR-5b USB real-printer smoke DoD §D ✅ (STM32 POS-80, Zadig WinUSB + codepage 13 = CP857 donanım-doğrulaması).
- **Kalite/risk denetimi** (5 adversarial sub-agent) → 2 🔴 + 3 🟠 bulgu, hepsi kapandı:
  - #193 🔴 `/payments *_close` tutar doğrulaması (ADR-014 §12, canCloseOrder ölü koddu)
  - #194 🔴 print job retry requeue + stuck reclaim (ADR-004 §Amendment 3, Migration 039)
  - #195 🟠 agent endpoint rate-limit (güvenlik)
  - #196 🟠 KDS reconnect resync (ADR-010)

## Açık borçlar (Session 71'e)

- **(MEDIUM) CHANGELOG Session 53-69 backfill** — ~55 PR sentez; `## [Unreleased]` arada boşluk. (ADR-006 §5.2 Sprint 13 payment kod backfill Session 70 hijyende tamamlandı.)
- **(LOW) Phase 4 başlangıç ADR** — Mobile (sıfırdan) + Audit + Backup; architect ile.
- Chip'te izlenen UX borcu: KDS bağlantı-durumu göstergesi (disconnect banner / reconnect toast).
- Worktree disposal kısmen (Windows file-lock; kozmetik).

## Çalışma kuralları (değişmez — CLAUDE.md)

- ADR önce, kod sonra. DoD olmadan "bitti" yok. Branch-first. Cerrahi değişiklik.
- Araştırma → sub-agent. UI → hci-reviewer. DB şema → db-migration-guard. Auth/payment/PII → security-reviewer.
- Kapsam kilidi: v5.0 MVP'de yoksa v5.1 backlog veya ADR ile gerekçelendir.
