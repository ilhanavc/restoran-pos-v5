# Restoran POS v5

Cloud tabanlı, modern, basit bir restoran POS sistemi. İlhan'ın kendi restoranında (30 masa + paket servis) çalışması için tasarlandı. İleride birkaç küçük/orta işletmeye daha kurulabilir — ama bu proje Adisyo'ya rakip değildir, zincir restoran yönetim platformu da değildir.

## Neden v5?

- **v3** (Electron + SQLite desktop): çalışıyor ama mimari karışık, online değil, mobil yok, yazıcı kalitesiz
- **v4** (discovery-only): kapsam aşırı büyüktü (5-20 şube SaaS), kod yazılmadan iptal edildi
- **v5**: MVP odaklı, gerçekçi kapsam, cloud-first, 3-4 aylık solo geliştirme hedefi

## Stack

Node.js + TypeScript + PostgreSQL backend. React + Vite web UI. React Native + Expo mobil. pnpm workspaces + Turborepo monorepo. Hetzner Almanya hosting. Caller ID köprüsü (CIDShow C812A) ayrı bir .NET 8 Windows Service olarak `apps/caller-bridge/` altında — bkz. ADR-016. Print Agent (ESC/POS yazıcı servisi, `apps/print-agent/`) Windows hizmeti olarak MSI installer ile dağıtılır (`@yao-pkg/pkg` + WiX v4 + nssm — bkz. ADR-004). Detay: [`CLAUDE.md`](./CLAUDE.md).

## Nerede ne var?

| Yol | Amaç |
|---|---|
| `CLAUDE.md` | Proje anayasası, Claude Code her oturumda okur |
| `GETTING-STARTED.md` | Sıfırdan kurulum adımları |
| `docs/project-charter.md` | Vizyon, hedef, kapsam sınırları |
| `docs/engineering/` | Kod standartları, test stratejisi, git akışı, DoD |
| `docs/hci/` | UX prensipleri, POS-spesifik checklist |
| `docs/domain/` | Türkçe restoran terminolojisi |
| `.claude/memory/decisions.md` | Tüm mimari kararlar (ADR'lar) |
| `.claude/agents/` | Sub-agent ekibi (architect, implementer, qa, vb.) |
| `.claude/skills/` | On-demand know-how paketleri (yazıcı, Caller ID, Hetzner, vb.) |
| `.claude/plans/active-plan.md` | O anki sprint planı |
| `apps/api/` | Cloud backend (Express + PostgreSQL + Socket.IO) |
| `apps/web/` | Web UI (kasiyer / müdür / mutfak) |
| `apps/mobile/` | Garson uygulaması (React Native + Expo) |
| `apps/print-agent/` | Restoran PC'sinde çalışan yazıcı servisi (ESC/POS, MSI installer, ADR-004) |
| `apps/caller-bridge/` | Caller ID köprüsü (.NET 8 Windows Service, ADR-016) |
| `packages/shared-types/` | Zod şemalar + TS tipler (her app import eder) |
| `packages/shared-domain/` | Saf domain fonksiyonları (sipariş, KDV, ESC/POS render) |
| `packages/db/` | Kysely migrations + repository'ler |

## Nasıl başlarım?

[`GETTING-STARTED.md`](./GETTING-STARTED.md) dosyasını sırasıyla uygula.

## Felsefe

1. Kapsam kilidi: v5 MVP'de olmayan şey, v5.1 backlog'una gider.
2. Mimari önce: ADR olmadan kod yok.
3. HCI + SOLID + Clean Architecture her satırda.
4. v3'teki karışıklığı, yazıcı sorunlarını, rebuild acılarını bu kez yaşamayacağız.
