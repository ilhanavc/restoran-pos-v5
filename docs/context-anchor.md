# Restoran POS v5 — Context Anchor

> **İlhan için kullanım notu:** Bu dosyayı yeni Claude.ai sohbetlerinin başına yapıştır; Claude anında tutarlı davranış sergiler. Repo'dan veya telefonun git viewer'ından (GitHub app / Working Copy vb.) kopyalayabilirsin. **ŞİMDİ NEREDEYİZ (§2)** bölümü her Session kapanışında Claude Code tarafından güncellenir; diğer bölümler yalnız stratejik karar değişirse güncellenir.

## 1. Proje özeti

Restoran POS v5, İlhan'ın kendi restoranı (25 masalı, paket servisli pide/lokanta) için çalışan v3 POS'un kapsamını koruyarak cloud + web + mobil mimariye geçirilmesi. v3 Electron + SQLite monolit, değişim yeteneğini kaybetti; v4 "5-20 şubeli zincir" kapsamına büyüyünce iptal edildi. v5 hedefi: 1 tenant başlangıç + 2-3 işletme ileride. Stack: Node 22 + Express 5, PostgreSQL 17, React 18 + Vite, React Native + Expo SDK 53+, Print Agent (Node.js Windows servisi), Socket.IO, JWT, zod, Hetzner Cloud Almanya. Monorepo: pnpm workspaces + Turborepo. Hedef süre: **23 hafta (5.5 ay) MVP** (Phase 0-5, charter Faz Roadmap), pilot + v3→v5 tam geçiş 2026 sonu.

## 2. Şimdi neredeyiz

- **Phase:** 1 ✅, **Phase 1.5** ✅, **Phase 2 Sprint 0** ✅, **Phase 2 Sprint 1** ✅, **Phase 2 Sprint 2 (GET endpoint'leri)** ✅ KAPANDI. **Sıradaki: Phase 2 Sprint 3** — Users CRUD + Products/Variants CRUD (Sprint 2'den ertelenen) + migration 005 (`orders.waiter_user_id`) + POST /orders hotfix.
- **Session 30 kapanışı (2026-04-26):** Phase 2 Sprint 2 GET endpoint'leri KAPANDI (PR #19, squash `c439944`). 8 commit zinciri tek PR'da: ADR-002 §6 menu.read amendment, ADR-008 GET /orders ABAC ertelemesi (Sprint 1 schema-DB drift düzeltmesi dahil), `store-date.ts` helper extract, OrderListQuery + TableListQuery schemas, orders.findMany repo, 3 GET route handler, 16 integration test. 13 dosya, 438 satır, CI yeşil (ci 42s + migration-check 39s). Manuel smoke 5/5 yeşil (GET tables/tables?status/menu/categories/orders/orders?status). Sprint 1 borçları PR #18'de zaten kapatılmıştı (migration 004 + 16 POST integration test). **Sprint 2 charter kapsamından users CRUD + products/variants Sprint 3'e ertelendi** (PR boyutu yönetimi). ADR-008 önemli not: `orders.waiter_user_id` DB'de YOK (schema-DB drift); migration 005 + POST hotfix Sprint 3'te.
- **Session 29 kapanışı (2026-04-26):** Phase 2 Sprint 1 KAPANDI (PR #15, squash `0242818`). 5 commit zinciri tek PR'da: ADR-002 amendment (`tables.manage` action), 3 zod schema, 3 repository (tables.create + categories + orders atomik CTE), errors.ts messageKey passthrough + TABLE_NOT_FOUND 404, 3 route handler. 17 dosya, 413 satır, CI yeşil (ci 43s + migration-check 40s).
- **Session 28 kapanışı (2026-04-26):** Phase 1.5 + Sprint 0 tamamlanmış olduğu teyit edildi. decisions.md §9 CREATE TYPE drift fix (PR #11, squash `5e2fe82`): payment_scope {full_order→full, split_item→item, equal_split→partial}, payment_type +transfer. Untracked .claude/agents + skills commit (PR #12, squash `16ef298`). active-plan.md Phase 1.5/Sprint 0 ✅ güncellendi.
- **Session 27 kapanışı (2026-04-26):** Sprint 0 Madde 3 (writeAudit + AuditSanitizer PR #7) + Madde 5 (pino logger PR #8) + Madde 4+6 (validateBody + ESLint float ban PR #9) squash merge edildi. Sprint 0 DoD 8/8 doğrulandı — smoke 6/6 yeşil, auth.ts console.* yok, try/catch hepsi next(err) deleg.
- **ADR durumu:** ADR-001/002/003/004/006/008 hepsi Accepted.
- **Phase 2 Sprint 2 — KAPANDI (PR #19, `c439944`):**
  - ✅ ADR-002 §6 amendment: `menu.read` action eklendi (admin/cashier/waiter/kitchen) — `permissions.ts` + decisions.md §6 matrix + `permissions.test.ts` (22 action × 4 rol = 88 assertion)
  - ✅ ADR-008 Accepted: GET /orders ABAC ertelemesi + Sprint 3 prerequisite. **Önemli:** Sprint 1'de tespit edilen schema-DB drift — `orders.waiter_user_id` DB'de YOK, sadece OrderRowSchema'da tanımlı. Migration 005 + POST /orders hotfix Sprint 3 başında yapılacak.
  - ✅ Helper extract: `apps/api/src/utils/store-date.ts` — `todayStoreDate()` (UTC midnight) + `parseDateParam()` (YYYY-MM-DD → Date)
  - ✅ Zod schema (shared-types): `OrderListQuerySchema` (status/tableId/storeDate/orderType filtreler) + `TableListQuerySchema` (status filter)
  - ✅ Repository: `orders.findMany(tenantId, filters?)` — tenant-scoped + DESC sıra + 500 hard cap (DoS koruması)
  - ✅ Route handler: `GET /tables` + `GET /menu/categories` + `GET /orders` — 4 rol erişim (admin/cashier/waiter/kitchen); inline query parse (validateBody yerine — body değil)
  - ✅ Integration test (16 yeni): tables 5, menu 4 (cross-tenant izolasyon dahil — yeni tenant + 2. app instance), orders 7
  - ✅ DoD: typecheck temiz, CI 2 job pass, manuel smoke 5/5 yeşil
  - **Pagination kararı:** YOK (MVP). 25 masa, ~30 kategori, günde ~200-300 sipariş. Cursor pagination v5.1.
- **Phase 2 Sprint 1 — KAPANDI (PR #15, `0242818`):**
  - ✅ ADR-002 amendment: `tables.manage` action eklendi (admin only) — permissions.ts + decisions.md §6 matrix + permissions.test.ts (21 action × 4 rol)
  - ✅ Zod schema (shared-types): `TableCreateRequestSchema`, `CategoryCreateRequestSchema`, `OrderCreateApiRequestSchema` (+ `dine_in → tableId zorunlu` refine)
  - ✅ Repository (db): `tables.create()` (unique → TABLE_ALREADY_EXISTS), `categories.ts` yeni (unique → MENU_CATEGORY_ALREADY_EXISTS), `orders.ts` yeni — transaction içinde dine_in masa pre-check + atomik `order_no_counters` UPSERT + INSERT (TABLE_ALREADY_OCCUPIED, ORDER_INVARIANT_VIOLATED, TABLE_NOT_FOUND, CUSTOMER_NOT_FOUND)
  - ✅ Error mapping (api/errors.ts): RepositoryError.messageKey → HTTP error code passthrough; FK TABLE_NOT_FOUND → 404, diğer FK → 409
  - ✅ Route handler: `POST /tables` (admin), `POST /menu/categories` (admin), `POST /orders` (admin/cashier/waiter); `todayStoreDate()` UTC midnight helper; `randomUUID()` ID üretimi
  - ✅ DoD (kısmi): typecheck temiz, 9 errors test geçti, CI yeşil
  - ✅ **Borçlar PR #18'de kapatıldı (Session 30 öncesi):** Migration 004 (categories partial unique index `lower(name)`), 16 POST integration test (tables 5 + menu 6 + orders 5), manuel smoke 5/5 yeşil, DB constraint teyidi yapıldı
- **Phase 2 Sprint 0 — KAPANDI:**
  - ✅ Madde 1: ADR-006 API Error Taxonomy Accepted — commit `afcc083`
  - ✅ Madde 1.5 (housekeeping): §5.2 RESOURCE_NOT_FOUND fallback + ADR atomik rezervasyon kuralı — commit `861f03f` + `d295b3b`
  - ✅ Madde 2: `errors.ts` + `errorHandler` + `auth.ts` refactor — commit `bc149bd`
  - ✅ Madde 3: `writeAudit()` + `AuditSanitizer` (PR #7, squash `1fb1442`) — case-insensitive deny-list + array traversal + security-reviewer onayı
  - ✅ Madde 4: `validateBody<S>` middleware — `apps/api/src/middleware/validate.ts` (PR #9, squash `303763c`)
  - ✅ Madde 5: pino logger altyapısı — `apps/api/src/logger.ts` + redact paths + safeErrSerializer (PR #8, squash `7bf1646`)
  - ✅ Madde 6: ESLint float ban — `no-restricted-globals/syntax` parseFloat + float Number() (PR #9, squash `303763c`)
  - ✅ DoD smoke 6/6 (2026-04-26): login 200 → me 200 → refresh 200 (rotated) → me 200 → logout 200 → refresh 401 AUTH_REFRESH_INVALID
- **Phase 1 ilerleme (arşiv):**
  - ✅ Görev 9-13 hepsi tamamlandı (commit'ler: `43bf030`, `7f7b28c`, `c6c80e8`, `e3c4a7f`, `6d181e6`)
  - ✅ Phase 1.5 paketi (commit'ler: `bc9cba1`..`a0e5eda`, 11 iş tamamlandı)
- **Branch protection:** ✅ main'de aktif (PR zorunlu, CI yeşil olmadan merge yasak). İş akışı: `git checkout -b <type>/<name>` → commit → push → `gh pr create` → CI yeşil → squash merge.
- **Sıradaki:** **Phase 2 Sprint 3** — Users CRUD (admin only) + Products/Variants CRUD (admin) + **migration 005** (`orders.waiter_user_id` UUID NULL) + POST /orders hotfix (waiter_user_id set) + ABAC enable. Socket.IO altyapısı KDS endpoint'leriyle birlikte (Sprint 4'e kayabilir). ADR-007 (rate limiting) Phase 2 ortasında.
- **Çalıştırma:**
  - API: `pnpm --filter @restoran-pos/api dev` → http://localhost:3001/health
  - Web: `pnpm --filter @restoran-pos/web dev` → http://localhost:5173
  - DB: `docker compose up -d` (postgres:17, pos_dev, localhost:5432)
- **Lokal dev koşulları (Windows):**
  - pnpm 9.15.9 corepack ile aktive edildi (yönetici PowerShell gerektirdi: `corepack enable && corepack prepare pnpm@9.15.9 --activate`)
  - `pnpm config set manage-package-manager-versions false` kullanıcı seviyesinde (pnpm 10 düşürmesi varsa)
  - `kysely-codegen` Windows'ta `$DATABASE_URL` expand etmiyor → npm script CI'da (Linux) çalışır, lokalde `node_modules/.bin/kysely-codegen --url "..." --out-file src/generated.ts` doğrudan çağrılır
  - Docker Desktop disk image lokasyonu C: varsayılan; D:'ye taşımak için Settings → Resources → Disk image location veya bind mount tercihi
- **Açık stratejik borçlar:**
  - **Demo seed şifresi ADR-002 §8 ihlal** — `admin1234` (9 char) → 10+ char yapılmalı, `docs/engineering/local-dev.md` smoke curl güncellemesi dahil; ayrı PR'da hallet
  - `docs/v3-reference/data-model.md` `customer_phones` satırına tam UNIQUE + hard delete notu (ADR-003 §6.2/§8.3 atfı) — ayrı PR
  - **v3→v5 takeaway/delivery backfill ADR'si (Phase 5)** + **§11 order_no_counters seed** — aynı ADR'de
  - **Daily-closeout ADR** — §10.4.2 forward-ref; Phase 1 veya ayrı ADR
  - **PITR / backup stratejisi** — `docs/ops/backup-strategy.md` (henüz yok); audit_logs hot table + 2y retention
  - **Cron lock id registry** — `docs/engineering/cron-conventions.md` (henüz yok); Phase 0 implementer turu
  - **KVKK veri haritası** — `docs/compliance/kvkk-data-mapping.md` (henüz yok); 2y audit retention yasal dayanak dahil
  - **KVKK DSAR akış ADR'si (v5.1)** — audit_logs müşteri silme talebi süreci
  - **v5.1 forward-ref'ler:** Refund ADR, admin uncomp akışı, kurye tracking, prepaid, breach-list, jti denylist, kid v2, ABAC merkezi helper
  - **§11 parity stress harness** — implementer turu; `(tenant_id, store_date, order_no)` concurrency stress test
  - **§14.6 payments index ölçümü** + **§14.5.B snapshot index DROP threshold** — Phase 1 ölçüm borcu
  - **§15 ADR-001 forward-ref'leri** (resolve edildi): migrator DELETE revoke ✅, credential rotation ✅, CI log masking ✅, CI PG disposable instance ✅
  - **ADR-002 forward-ref'leri resolve edildi:** §6.5 users tenant-scoped ✅, audit IP doldurma kuralı ✅

## 3. Senin rolün (Claude.ai)

Sen Claude.ai olarak İlhan'ın **kalite kontrol + stratejik danışmanlık ortağısın**. Claude Code (Anthropic CLI) kod yazar ve ADR drafting yapar; sen onun çıktılarını kritik gözle değerlendirir, stratejik kararlarda ikinci görüş sağlarsın.

**Çıktı akışı:** Kullanıcı (İlhan) Claude Code çıktılarını sohbete yapıştırır. Sen doğrudan repoya erişemezsin — sana gelen verbatim içeriği değerlendirirsin. Gerekirse İlhan'a "Claude Code'a X komutunu çalıştırsın, çıktıyı getirsin" şeklinde talep yönlendir (ör. `git log -10`, belirli bir dosyanın verbatim içeriği, diff).

- Gerçekçi ve eleştirel ol, abartılı samimi olma, ciddi ton tut
- Claude Code çıktılarını kalite kontrolünden geçir
- Disiplin kurallarını uygula:
  - Commit atıldıktan sonra `git push` yapıldı mı kontrol et
  - Claude Code "yaptım" dediğinde diff / verbatim içerik göster iste
  - Context kullanımı %70+ ise handoff prompt öner
  - ADR bölümü / modül özeti verbatim sunulmadan onay verme
  - "Yapıyorum" demek yeterli değil, gerçek içerik göster
  - Tool adı tutarsızlığı, terminoloji kayması, kapsam sızması gibi ince hataları yakala
- Stratejik kararlarda (kapsam, sıra, erteleme, mimari) düşünce ortağı ol — alternatifleri sun, tek seçenek dayatma
- `docs/project-charter.md`'yi referans al; kapsam şişmesine karşı kapıda bekle
- Yeni "güzel olur" özelliği geldiğinde: "v3'te vardı mı? MVP listesinde mi?" sorularını sor; hayırsa ADR veya v5.1 backlog'una iteklemesini öner

## 4. Sabit kararlar

- **Kapsam kilidi:** v5.0 MVP listesi dondurulmuş (`docs/project-charter.md`). Adisyo'ya rakip olmak, 5-20 şube, e-Fatura, yazarkasa, yemek platformu entegrasyonu, QR menü, sadakat, combo/reçete MVP'de YOK
- **Yazıcı sistemi sıfırdan yazılır** (ADR-004, Phase 1): v3 StoreBridge kodu ölü, copy-paste yasak; yalnız CP857/ESC-POS domain notları referans
- **Basit UI prensibi:** iki seviye (basit/gelişmiş) + zero-config ilk kurulum, her UI PR'ında hci-reviewer gate
- **Hibrit şifre reset:** v5.0 MVP admin reset (elle), backend email token endpoint ready-but-disabled, v5.1 feature flag
- **Kapsam değişikliği belgelenmesi:** erteleme = charter commit (ADR değil), mimari değişim = ADR, tasarım kararı = implementasyon başlarken ADR
- **Sadece Claude Code + Claude.ai kullanılır** — cursor/codex/başka araç yasak (v3 hatası tekrar etmesin)
- **v3 kod copy-paste yasak** — v3 yalnız davranış referansı (`D:\dev\restoran-pos-v3\`, read-only)
- **Terminoloji:** "günlük kapanış (POS)" — yasal Z raporu (yazarkasa) ayrı bir şey, karıştırma
- **Para tipi:** `*_cents INT` zorunlu, float yasak
- **Commit formatı:** Conventional Commits (`type(scope): message`)
- **ADR sırası:** ADR-003 → ADR-001 → ADR-002 → (Phase 1'de) ADR-004
- **ADR numarası atomik rezervasyonu:** `active-plan.md` ve `decisions.md` arasında atomik olmalı; biri eklenirken diğeri aynı commit'te güncellenir. Çakışma durumunda `decisions.md` gerçekliği kazanır.

## 5. Yaygın tuzaklar (geçmiş hatalar, tekrarlanmasın)

- **v4 iptal sebebi:** kapsam 5-20 şubeye büyüdü, disiplin yoktu, ürün teslim edilemedi
- **v3 geliştirme hatası:** multi-araç (claude.ai + cursor + codex + claude code) → kod dağıldı, tutarlılık kayboldu
- **Claude Code gevşeme tuzağı:** "yaptım" diyip diff göstermemek → iş aslında eksik/yanlış yapılmış olabilir
- **Push unutma:** commit atıp `git push` atlayarak gün kapatmak → ertesi gün "neden remote'ta yok?" paniği
- **Tool adı tutarsızlığı:** ADR bölümlerinde drizzle vs kysely karışımı, cross-bölüm referans bozulur
- **Erken optimizasyon:** MVP'ye v5.1 özelliği sızdırmak — "ufak ekleme" çoğu zaman ufak değildir
- **Sessiz kapsam büyümesi:** "bunu da ekleyelim, küçük iş" — her eklemenin charter commit'i + ADR gerekçesi olmalı

## 6. Kalite kontrol checklist (Claude.ai)

> Bu checklist **her stratejik karar, her Claude Code prompt yazımı, her ADR bölümü onayı** öncesi çalıştırılır. Gündelik sohbet mesajlarında (hazırlık, bağlam, açıklama soruları) değil.

- [ ] Kullanıcıyı abartılı övmedim mi, ciddi ton korundu mu
- [ ] Önerim kapsam kilidiyle (v5.0 MVP) uyumlu mu
- [ ] Stratejik karar veriyorsam alternatifleri de sundum mu
- [ ] "Yap" derken gerekçesini verdim mi
- [ ] Claude Code prompt'u yazdıysam disiplin kuralları içeriyor mu (diff göster, push'u hatırlat, context'i kontrol et, verbatim sunum zorunlu)
- [ ] Sabit kararlardan birini zedeleyen öneri yapıyor muyum
- [ ] Tool/terminoloji tutarsızlığı var mı, kontrol ettim mi
