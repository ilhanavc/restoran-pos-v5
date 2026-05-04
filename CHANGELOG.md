# Changelog

Bu dosya her önemli değişikliği tarih sırasıyla kaydeder. `/phase-done` ve `/new-adr` slash command'ları bu dosyayı otomatik günceller.

Format: [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/).

Sürüm şeması: Phase 0 → 0.0.x, Phase 1 → 0.1.x, pilot → 0.9.x, prod → 1.0.0.

## [Unreleased]

### Session 51 (2026-05-04) — PR-8 Caller ID + Müşteri Yönetimi (ADR-016)

**Added:**
- Migration 027 — customers/customer_addresses/call_logs şeması + tenant_settings caller_id_* (PR-8a, commit `ba9228f`)
- 13 customer + caller-id endpoint (PR-8b, commits `263bf2c`/`6bd80c0`/`828bfd7`) — bridge auth, Socket.IO room, bypass pattern
- Web: `IncomingCallProvider` + popup, `CustomersPage`/`CustomerDetailPage`, Excel import/export, kara liste, toplu sil (PR-8c, commits `08dfbcd`..`181d8f8`)
- TTL cleanup cron — `audit_logs` 2y + `call_logs` 30d KVKK retention (PR-8e, commit `6a49204`); `apps/api/src/cron/ttl-cleanup.ts`, advisory lock registry, self-audit `audit.purge` event
- Caller Bridge .NET 8 Worker Service (PR-8d, PR #100) — `apps/caller-bridge/`, cid.dll P/Invoke, `X-Bridge-Token`, KVKK phone masking
- `phoneInvalid` + `nameNoLetter` inline validation NewCustomerDrawer (commit `fc42c11`)

**Changed:**
- `customers.drawer.phonePlaceholder` realistic number → `0123456789` (commit `cfa8315`)
- POST/GET/PATCH `/customers/:id` response shape flatten (`{data:x}`) — frontend hook uyumu

**v5.1 backlog'a ertelendi:**
- PR-8f V3 müşteri import CLI (ImportDrawer UI yeterli)
- Multi-line CIDShow (4/8 port), arama geçmişi raporu, sadakat puanı, kampanya SMS

**DoD borç kapatması (Session 51 ikinci yarı):**
- ADR-016 §Karar 9 backend integration testleri + frontend RTL
- HCI critical/major bulguları (telefon/adres silme onaysız, popup buton 32→48px, hover-only state, kırmızı seçili state semantik)
- Turkish UX bulguları (CSV header hardcode, 'Ev' i18n)
- CHANGELOG `[Unreleased]` (bu girdi)

### Session 25 (2026-04-25..26) — Phase 1.5 paketi + ADR-004 Accepted

Phase 1 Exit Audit (Forensic Verdict B): charter "Menu/Payment/User policy'leri" maddesi sessiz daraltma + Katman 2 ek bulgular (ESLint, migration idempotency, ölü directives). Phase 2 öncesi 9 iş paketi.

**Added:**
- ADR-004 Accepted — Print Agent Mimarisi (Phase 2 başı, commit `8fb7e1b`)
- `packages/shared-types/src/permissions.ts` — ADR-002 §6 role permission matrix, default-deny, ABAC notu (commit `bc9cba1`)
- `packages/shared-domain/src/menu.ts` Menu policy + 5 test — `canHardDeleteProduct` (ADR-003 §8 + Sinyal #7) (commit `bf33fc5`)
- `packages/shared-domain/src/payment.ts` Payment policy + 20 test — `canAddItemToPayment`, `calculatePayableCents`, `canCloseOrder`, `validateCashTendered` (ADR-003 §10) (commit `c27de1a`)
- `packages/shared-domain/src/user.ts` User policy + 20 test — `validatePassword`, `canManageUsers`, `canHardDeleteUser` (ADR-002 §1/§6/§8 + ADR-003 §8) (commit `a564d55`)
- ESLint `no-restricted-imports` kuralı + gerçek `lint`/`lint:fix` scriptleri (ADR-001 §2.2) (commit `040521f`)

**Changed:**
- Migration scriptleri `CREATE ROLE` → `DO/EXCEPTION` idempotent pattern (cluster-level çakışma fix) (commit `3eb8481`)
- `docs/v3-reference/domain-rules.md` + ADR-003 §10 prose: `payment_scope` enum isimleri RENAME sonrası güncellendi (`full_order/split_item/equal_split` → `full/item/partial`), `payment_type` += `transfer`, ADR-003 §10.2.3 `OrderCompService` dosya yolu (`shared-domain/orderComp.ts` → `apps/api/services/orderComp.ts`, Phase 2'de yazılacak) (commit `2526aa7`)
- `packages/shared-types/src/user.ts` `UserCreateSchema.password.min(8)` → `min(10)` (ADR-002 §8 hizalaması) (commit `27a6484`)
- `apps/api` ölü `eslint-disable` directives temizliği (ADR-001 §2.2 enforce sonrası yan ürün) (commit `3c5458b`)

**Açık borç (yeni):**
- decisions.md §9 `CREATE TYPE payment_scope AS ENUM ('full_order', 'split_item', 'equal_split')` hâlâ eski isimleri kullanıyor — ayrı drift ticket
- Demo seed şifresi `admin1234` (9 char) ADR-002 §8 ihlal — `local-dev.md` smoke curl güncellemesi dahil ayrı ticket (anchor borçlar listesinde, commit `b5a0277`)

**Next:** Phase 2 (Sipariş + Masa + Menü UI). Öncesi: GitHub Pro upgrade + branch protection main'de aktif.

**Session commits:** `bc9cba1`, `040521f`, `3c5458b`, `3eb8481`, `bf33fc5`, `c27de1a`, `66c50b9`, `8fb7e1b`, `2526aa7`, `a564d55`, `27a6484`, `b5a0277`

### Session 22-24 (2026-04-25) — Phase 1 Core Domain + Auth + DB Repository ✅

Görev 9-13 (shared-types, shared-domain pure, packages/db repository, apps/api auth, seed + smoke) tamamlandı; Phase 1 exit ✅, CI yeşil.

**Added:**
- `packages/shared-types` zod şemaları — auth/user/table/menu/order/payment/audit/money (Görev 9, commit `43bf030` + DoD fix `c65334e`)
- `packages/shared-domain` pure domain fonksiyonları (money/order/tax/table/order-no/validation) + 75 test + Vitest setup (Görev 10, commit `7f7b28c`)
- `packages/db` connection + repository katmanı: `connection.ts`, `kysely.ts`, `repositories/{users,refresh-tokens,tables}.ts`, `errors.ts` (`RepositoryError`/`NotFoundError`/`ConflictError`/`mapPgError`) (Görev 11, commit `c6c80e8`)
- Migration 002 (`refresh_tokens` tablosu, BYTEA SHA-256 hash) + 003 (`users.email` kolonu) — kysely-codegen aligned
- `apps/api` auth modülü: `jwt.ts` (HS256 30m), `password.ts` (bcrypt 12), `refresh.ts` (RTR + reuse detection + transaction), `cookie.ts` (HttpOnly/Secure/SameSite=Strict/Path=/auth/refresh), `middleware/{authenticate,authorize}.ts`, `routes/auth.ts` (login + refresh + logout + me, rate limit 5/15m/IP, CSRF header) (Görev 12, commit `7180503` + `e3c4a7f`)
- `packages/db/src/seed.ts` — idempotent dev seed (1 tenant Demo Restoran, 1 admin user `admin@local.test`/`admin1234`, 5 masa MASA 1..5, 3 kategori, 5 ürün), `NODE_ENV=production`+`ALLOW_SEED!==true` guard (Görev 13)
- `docs/engineering/local-dev.md` — yerel geliştirme akışı + 6 adım curl smoke senaryosu
- ADR-004 Draft — Print Agent Mimarisi (Phase 2 başı), `architect` sub-agent ile yazıldı, 8 açık soru ile kapatıldı (Session 24, commit `e2c967d`)

**Changed:**
- Security blocker fixes (apps/api): DUMMY_HASH constant timing defense, `/health` error mesajı sabit, 500 handler `console.error` (commit `e3c4a7f`)
- bcryptjs ESM/CJS interop (`/index.js`), pool çift-close, `packages/db` exports, `apps/api` `"type":"module"`, `apps/api/.env.example` TENANT_ID UUID v7 hizalandı, `000_init.sql` hardcoded "Pilot Restoran" INSERT kaldırıldı (migration=şema, seed=veri ayrımı)
- `tables.code` 'MASA 1'..'MASA 5' (kullanıcı konvansiyonu) (commit `79a06e1`)

**Açık borç:**
- `tables.status` derived field semantiği — Phase 2 sipariş ekranı öncesi ADR-003 §14.2.B ile hizalama
- Migration 003 partial index — Phase 3'te `email NOT NULL` sonrası `WHERE email IS NOT NULL` partial olarak yenilenecek

**Next:** Phase 1.5 paketi (eksik policy + drift cleanup) — Phase 2 öncesi forensic audit bulgularını kapat.

**Smoke 6/6 yeşil:** login (200) → me (200, tenantId UUID v7) → refresh (200, token rotated) → me (200) → logout (200) → refresh-after-logout (401 `AUTH_REFRESH_INVALID`). CI workflow + Migration Check ✅ (run 24938360853, 24938360868).

**Session commits:** `1292b7f`, `7efe422`, `43bf030`, `24a37ea`, `7f7b28c`, `a81c040`, `c65334e`, `b1d596b`, `c6c80e8`, `4f48e66`, `0efeea7`, `73805be`, `7180503`, `8cb8b70`, `036ad36`, `e3c4a7f`, `a4aa467`, `ef8f2db`, `79a06e1`, `6d181e6`, `e2c967d`, `f0fd920`

### Session 11-21 (2026-04-22..25) — Phase 0 finalization ✅

ADR-003 §10-§16 tam Accepted, ADR-001/ADR-002 Accepted, monorepo bootstrap + docker + hello endpoint. Phase 0 exit ✅.

**Added:**
- ADR-003 Bölüm 10 (Ödeme Modeli & İnvaryantları) — §10.1-10.4 onaylandı (commit `15649bb`), §10.5 review gate + §6.5 composite UNIQUE (`caa0b53`), mini-pass C1-C4 concerns (`459ea97`)
- ADR-003 Bölüm 11 (order_no Günlük Unique sayaç) + mini-pass A1-A3 (commit `9fd6467` + `2938b0f`)
- ADR-003 Bölüm 12 (`audit_logs` + AuditSanitizer<T> kontratı) (commit `8abd722`)
- ADR-003 Bölüm 13 (Retention + cron + RLS) + 2x mini-pass (commit `df08a18`)
- ADR-003 Bölüm 14 (Kritik index'ler) + ikili review + mini-pass A1-A6 (commit `eddf6f7`)
- ADR-003 Bölüm 15 (Migration Stratejisi) + paralel review + mini-pass A1-A7 (commit `a8d00f2`)
- ADR-003 Bölüm 16 (Consequences) + ADR-003 Accepted (commit `c3c0cb7`)
- `packages/db/migrations/000_init.sql` — initial schema (14 tablo, 7 enum, 4 DB rolü) (commit `5d7d08d`)
- ADR-001 Accepted — monorepo structure + package naming + CI/deploy pipeline (commit `308f08a`)
- ADR-002 Accepted — auth strategy, JWT/RTR, role matrix (commit `49682c6`)
- Monorepo iskelet + CI pipeline (Görev 6, commit `98f4563`)
- docker-compose lokal PostgreSQL + kysely-codegen (Görev 7, commit `6fb7299`)
- Hello endpoint — `GET /health` + web ana sayfa (Görev 8, commit `043e225`)
- `docs/context-anchor.md` — Claude.ai sohbetleri için tutarlılık çapası (commit `0f31fce`)

**Changed:**
- Session kapanış protokolüne context-anchor §2 güncelleme adımı eklendi (commit `a95fdef`)
- `apps/web` `"type":"module"` (postcss ESM warning sustur, commit `f6a26dd`)

**Açık borç (Phase 0 sonu):**
- Daily-closeout ADR (§10.4.2 forward-ref)
- Error taxonomy ADR (§10.5 C6 + §11.10)
- PITR/backup stratejisi (`docs/ops/backup-strategy.md`)
- Cron lock id registry (`docs/engineering/cron-conventions.md`)
- KVKK veri haritası (`docs/compliance/kvkk-data-mapping.md`)
- §11 parity stress harness, §14.5/§14.6 ölçüm borçları

**Next:** Phase 1 (Core Domain + Auth + DB Repository) — Görev 9-13.

**Session commits (özet):** `c705f13`, `15649bb`, `caa0b53`, `459ea97`, `9fd6467`, `2938b0f`, `8c44ff9`, `8abd722`, `df08a18`, `eddf6f7`, `4091fa0`, `a8d00f2`, `c3c0cb7`, `5d7d08d`, `d954caa`, `308f08a`, `49682c6`, `21634f3`, `98f4563`, `6fb7299`, `42d8c8d`, `043e225`, `7fa5869`, `f6a26dd`, `0f31fce`, `a95fdef`

### Session 10 (2026-04-24) — ADR-003 Bölüm 7-9 onaylandı

**Added:**
- ADR-003 Bölüm 7 (Snapshot İnvaryantı) — verbatim onay, Edit kilit
- ADR-003 Bölüm 8 (Soft vs Hard Delete) — verbatim onay, §8.4 ON DELETE RESTRICT gerekçesi + §8.5 default filter kuralı (tool-agnostik repository helper) eklendi
- ADR-003 Bölüm 9 (Enum Kullanımı) — verbatim onay, §9.1 enum listesi final (7 enum), §9.2.1 4 domain kararı (delivery, equal_split, payment_type değişmedi, print_job_status.cancelled), §9.3 forward-only 4 kural (ADD/REMOVE/REORDER/RENAME), §9.5 review gate (a/b/c)
- `CLAUDE.md` Core Directive #7 "Cerrahi değişiklik" (Karpathy CLAUDE.md §3 adapt)
- `docs/context-anchor.md` (yeni Claude.ai sohbetleri için yapıştırılabilir tutarlılık çapası)

**Changed:**
- ADR-003 §9.3 ADD VALUE örneği `order_status 'delivered'` → `order_type 'catering'` (delivery enum kararı sonrası tutarlılık)
- ADR-003 §9.5(b) db-migration-guard referansı somutlaştı (`.claude/agents/db-migration-guard.md` atıf + pre-commit hook ADR-001 bağı)
- ADR-003 §9.2.1 `order_type.delivery` maddesine v3→v5 geçiş notu eklendi

**Açık borç (yeni):**
- v3→v5 takeaway/delivery backfill ADR'si — Phase 5 geçiş planında yazılacak; `active-plan.md` Follow-up'ta kayıtlı

**Next:** ADR-003 Bölüm 10 (Ödeme Modeli & İnvaryantları) — Session 11

**Session commits:** `4289bde`, `0f31fce`, + Bölüm 9 onay commit'i (bu session)

### Session 8 (2026-04-22) — Görev 1 kapandı, ADR-003 sırada

**Added:**
- Charter v5.0 kapsam onaylandı (Phase 0 Görev #1 ✅, commit `72e00c5`)
- `docs/project-charter.md` → "Kapsam değişikliği nasıl belgelenir" paragrafı — erteleme / mimari / tasarım ADR ayrımı kuralı
- `docs/domain/personas.md` → terminoloji notu: yasal Z raporu (yazarkasa) vs POS günlük kapanışı ayrımı

**Changed:**
- Phase 3 roadmap ↔ MVP listesi tutarsızlıkları giderildi (iskonto v5.1'e ertelendi, raporlar MVP ile tam uyumlu)
- Personas.md "Z raporu" → "günlük kapanış raporu (POS)" (2 satır)
- İskonto placeholder'ları: `ADR-XXX` → `commit a6d746e` (erteleme kapsam kararı, tasarım ADR'si v5.1'de)
- `active-plan.md` Görev 1 ✅, ADR sırası netleştirildi (ADR-003 → ADR-001 → ADR-002)
- `scratchpad.md` Session 8 kapanış + Session 9 starter prompt eklendi

**Next:** ADR-003 DB Şema İlkeleri (Session 9) — `architect` + `db-migration-guard`

**Session commits:** `72e00c5`, `cdb3deb`

### Session 1 (2026-04-22)

**Added:**
- v3 reference infrastructure: `docs/v3-reference/modules.md` (Modül 1 Ayarlar + Modül 2 Auth/Login tam dolu, 15 modüllük sıra belirlendi)
- `CLAUDE.md` → yeni "v3 referans erişimi" bölümü (read-only, copy-paste yasak, kaynak etiketleme kuralları: Kodda tespit / Kullanıcı gözlemi / Doğrulanmamış)
- `.claude/skills/simple-first-ui/SKILL.md` — iskelet (detay Phase 0 sonunda dolacak)

**Changed:**
- `docs/hci/pos-checklist.md` — yeni "Basit UI & Sıfır Yapılandırma" bölümü (iki seviye ayarlar gate + zero-config gate + v3 Yazıcı Detayı anti-örneği)
- `CLAUDE.md` — v3 yol tutarlılığı (`d:/dev/restoran-pos-v3/` → `D:\dev\restoran-pos-v3\`)
- `.claude/plans/active-plan.md` — ADR İzleme bölümü (ADR-004 Print Agent Phase 1 notu), Session 2 açılış görevi, Görev 2 ilerleme durumu (2/15 modül)
- `.claude/memory/scratchpad.md` — ADR-002 açık kararlar + Session 1 kapanış özeti + v3 mimari sinyaller + Session 2 starter prompt

**Architectural signals (v3 kod araştırması sonrası):**
- Garson rolü v3'te yalnız `/tables` route — sipariş yönetimi masa detayı içinde entegre (v5 Modül 4 tasarımına sinyal)
- Rol matrisi v3'te tek merkezi yerde (`tD` nav array) — v5'te korunacak config-driven yaklaşım
- Backend route guard varlığı doğrulanamadı — v5'te kesinlik (her endpoint'te rol kontrolü), `pain-points.md` adayı
- Şifre reset v3'te admin-manuel-reset modeli kodlanmış — hibrit ADR-002 önerimizle uyumlu

**Session commits:** `b4d308b`, `25e395f`, `259b102`, `e2a86fb`

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
- 2026-04-22: Session 1 — Modül 1 Ayarlar ve Modül 2 Auth/Login röportajları tamamlandı, v3 kodu araştırması ilk kez yapıldı, stratejik kararlar (yazıcı sıfırdan + basit UI prensibi) kaydedildi
