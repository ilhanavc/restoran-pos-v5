# Restoran POS v5 — Context Anchor

> **İlhan için kullanım notu:** Bu dosyayı yeni Claude.ai sohbetlerinin başına yapıştır; Claude anında tutarlı davranış sergiler. Repo'dan veya telefonun git viewer'ından (GitHub app / Working Copy vb.) kopyalayabilirsin. **ŞİMDİ NEREDEYİZ (§2)** bölümü her Session kapanışında Claude Code tarafından güncellenir; diğer bölümler yalnız stratejik karar değişirse güncellenir.

## 1. Proje özeti

Restoran POS v5, İlhan'ın kendi restoranı (25 masalı, paket servisli pide/lokanta) için çalışan v3 POS'un kapsamını koruyarak cloud + web + mobil mimariye geçirilmesi. v3 Electron + SQLite monolit, değişim yeteneğini kaybetti; v4 "5-20 şubeli zincir" kapsamına büyüyünce iptal edildi. v5 hedefi: 1 tenant başlangıç + 2-3 işletme ileride. Stack: Node 22 + Express 5, PostgreSQL 17, React 18 + Vite, React Native + Expo SDK 53+, Print Agent (Node.js Windows servisi), Socket.IO, JWT, zod, Hetzner Cloud Almanya. Monorepo: pnpm workspaces + Turborepo. Hedef süre: **23 hafta (5.5 ay) MVP** (Phase 0-5, charter Faz Roadmap), pilot + v3→v5 tam geçiş 2026 sonu.

## 2. Şimdi neredeyiz

- **Phase:** 1 ✅, 1.5 ✅, 2 Sprint 0 ✅, 2 Sprint 1 ✅, 2 Sprint 2 ✅, **2 Sprint 3a (ABAC unblock + CI gating)** ✅ KAPANDI, **Sprint 3b altyapı (ADR + plan + retrospektif)** ✅ HAZIR, **Sprint 3b Görev 17.5 (Migration 006 + zod sync)** ✅ KAPANDI. **Sıradaki: Görev 17 Users CRUD admin-only** + paralel `price_delta_cents` ADR §8.6 amendment (Görev 18 öncesi BLOCKER). **3 blocker durumu (Sprint 3b başlangıcı):** ADR-002 §10 ✅ | ADR-003 §8.6 ✅ | `permissions.ts` plan-kod drift ✅ RESOLVED. **Yeni BLOCKER (Görev 18 öncesi):** ADR-003 §8.6 `price_delta_cents` semantik amendment (signed/negatif/range tanımsız, Session 36 keşif). **Açık kritik borç:** Active-plan vs charter Phase 2 drift (Socket.IO + Web UI 7 ekran + E2E hiç plan'a girmemiş — Sprint 3b kapanışından sonra plan yeniden yapılandırılır).
- **Session 36 kapanışı (2026-04-28):** Sprint 3b ana implementasyon başladı, ilk görev **Görev 17.5 ✅ KAPANDI** (PR #33 squash `f4d2f0e`, 5 dosya 45 satır insertion). Migration 006 `product_variants` ADR-003 §8.6 SQL'ine sadık + `IF NOT EXISTS` idempotency stili (005'ten alınma); composite FK `(product_id, tenant_id) → products(id, tenant_id) ON DELETE RESTRICT` + partial index `WHERE deleted_at IS NULL`. Generated.ts kysely-codegen ile regen (manuel düzenleme yok, alfabetik sıra korundu). ProductVariantSchema 4 alan eklendi (`tenantId`/`sortOrder`/`createdAt`/`updatedAt`) — DB ile bire bir drift'siz. **db-migration-guard APPROVED 9/9** (uydurma cross-ref yok, ADR-003 §6.5/§8.4/§14.1.B.3/§14.5.A doğrulandı). Lokal: typecheck/lint/test 8/8 paket yeşil; CI 3/3 check pass (ci 1m1s + migration-check 38s/43s, postgres:17 service container migration uyguladı). **Yan keşif (🔴 BLOCKER Görev 18 öncesi):** ADR-003 §8.6'da `price_delta_cents` semantik tanımsız — signed/unsigned, negatif izinli mi, range hard-cap var mı yazılmamış. v3 davranışı negatif delta destekliyor (küçük porsiyon -2 TL). Şu an zod `z.number().int()` (signed, DB INTEGER ile drift'siz) ama Görev 18 CRUD validation kararsız semantikle yazılamaz. Active-plan §18 Bağımlılık + Sprint 3b kapanış kriterleri + context-anchor §2 borç listesi'ne BLOCKER işaretlendi; ayrı küçük PR Görev 18 başlamadan merge edilir. Sıradaki: (a) Görev 17 Users CRUD admin-only başlat (Görev 17.5 ile bağımsız), (b) `price_delta_cents` ADR §8.6 amendment ayrı küçük PR; (a) ve (b) paralel session başlatılabilir.
- **Session 35 kapanışı (2026-04-27):** Sprint 3b altyapı PR'ı (#31 squash `4d17c47`) merged. **3 iş tek PR'da:** ADR-003 §8.6 amendment (Products/Variants Lifecycle, 4 karar gerekçeli + reddedilen alternatifler, architect cross-ref doğrulama 9/9 ✅ 0 uydurma) + Sprint 3b plan revizyonu (Görev 17 `permissions.ts` drift resolve + yeni Görev 17.5 Migration 006 prerequisite + Görev 18 N+1 yasağı/PATCH semantik/`is_default` validation DoD'a) + Sprint 3a retrospektif ([docs/retrospectives/sprint-3a.md](docs/retrospectives/sprint-3a.md) — 5 keşif + 5 ders, takvim gerçekçilik dahil). **Sistemik bulgu:** Active-plan vs charter Phase 2 drift — charter Phase 2 = REST + Socket.IO + Web UI 7 ekran + E2E, active-plan vizyonu yarısı bile değil. KDS+POST /payments charter'da Phase 3, active-plan'de Sprint 4 (yanlış yerleştirme). Sprint 3b kapanışından sonra plan tamamen yeniden yapılandırılır (yeni kritik borç §2'de). 3/3 Sprint 3b blocker resolved. Sıradaki: Görev 17.5 (Migration 006 product_variants + zod sync) sonraki oturumda.
- **Session 34 kapanışı (2026-04-27):** **Phase 2 Sprint 3a ✅ KAPANDI.** ABAC unblock + CI integration test gating + sahte yeşil drift kapandı. Toplam 5 görev (Görev 14, 15, 15.5, 15.6, 16) + 8 PR (#22, #23, #24, #25, #26, #27, #28, #29) zinciri. Sprint başlangıç plan'ında 3 görev (14/15/16) öngörülmüş, drift keşifleriyle 2 ek görev eklendi (15.5 CI gating, 15.6 fixture cleanup) — sınır kuralı (≤3) işini yaptı, scope-patlama kontrol altında. CI'de **296 test gerçek execution kanıtlandı** ([PR #29 run 24994139680](https://github.com/ilhanavc/restoran-pos-v5/actions/runs/24994139680) log: `PASS apps/api/src/__tests__/orders.test.ts (19 tests)` + apps/api 56 + packages/db 11 + shared 229, skip 0). Sıradaki: Sprint 3b plan revizyonu (PR #31 — `permissions.ts` plan-kod drift + Görev 18 ADR-X yazımı), ardından Görev 17 implementasyonu (PR #32+).
- **Session 33 kapanışı (2026-04-27):** Sprint 3a Görev 15.5 + 15.6 + 16 zinciri tamamlandı. **Görev 15.5 (PR #27 squash `4792973`):** ADR-001 §6.1 amendment + ci.yml postgres:17 service container + DATABASE_URL env + TZ=UTC pin + migrate step + turbo.json `tasks.test.env` (turbo sandbox env passing tuzağı keşfi). **Görev 15.6 (PR #28 squash `cc7cb7d`):** packages/db repo test fixture seed (tenants INSERT eksikti) + afterAll pool.end() çift çağrı bug fix. CI'de gerçek execution: 63 test (apps/api 52 + packages/db 11) skip 0. **Görev 16:** GET /orders ABAC waiter filter — handler inline conditional + repo `OrderListFilters.waiterUserId` + 4 yeni test (IDOR regression, admin/cashier filtresiz, NULL davranışı). 56/56 yeşil lokal, security-reviewer ✅ APPROVED, kitchen Sprint 4'e ertelendi. **Yan keşif: `permissions.ts` plan-kod drift** — Sprint 0/1+ plan'larda referans var ama dosya yok, scope dışı bırakıldı (borç §2'ye eklendi).
- **Session 32 kapanışı (2026-04-27):** Sprint 3a Görev 14 (migration 005, PR #24 `a12fdcb`) merged + db-migration-guard ✅ APPROVED 9/9. Sprint 1 borç fixture fix (PR #25 `febc795`) merged: orders.test.ts'e tenant_settings INSERT eklendi (tenant_settings.business_day_cutoff_hour `populate_order_store_date` trigger için zorunlu, fixture eksikti, lokal'de tüm POST /orders test'leri 500 dönüyordu). Sprint 3a Görev 15 (POST /orders waiter_user_id hotfix) PR'ı açıldı: handler `req.user.userId` ataması + repository CreateOrderParams genişletmesi + 3 yeni integration test (admin/cashier/waiter; kitchen 403 zaten Sprint 1'de mevcut), security-reviewer ✅ APPROVED. Lokal: 52/52 test yeşil, typecheck + lint temiz. **Kritik bulgu:** CI integration test sahte yeşil — DATABASE_URL CI'de yok, `describe.skipIf` ile tüm integration testler skip; PR #18 "16 test yeşil" iddiası gerçekte CI'de skip durumuydu. Yeni Görev 15.5 oluşturuldu (Görev 16 öncesi blocker).
- **Session 31 kapanışı (2026-04-27):** Phase 2 Sprint 3 plan PR #22 (Sprint 3a/3b bölünme + ADR-002 §10 user lifecycle + ADR-006 §5.2 registry + ADR-008 amendment FK semantiği) ve ADR-003 §14.1.B.3 amendment PR #23 (Phase-conditional enforcement — §14.1.B kuralı korundu, aktivasyonu Phase 4'e koşullandırıldı, gerekçe: SQL migration paterni node-pg-migrate v7'de CONCURRENTLY teknik olarak desteklemez, Phase 0-3 prod traffic yok) merged. Görev 14 PR'ı açıldı: migration 005 (`orders.waiter_user_id` UUID NULL + composite FK ON DELETE SET NULL ON UPDATE NO ACTION + partial index `WHERE waiter_user_id IS NOT NULL`) yazıldı, db-migration-guard ✅ APPROVED (9/9 checklist), generated.ts regen başarılı (1 line insertion, alfabetik sıra doğru). 3 architect uydurma cross-ref tespit edilip context-anchor §5'e mitigasyon notu eklendi. Sıradaki: Görev 14 PR squash → Görev 15 (POST /orders hotfix) + Görev 16 (ABAC enable).
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
- **Sıradaki:** **Phase 2 Sprint 3b** — Görev 17 Users CRUD admin-only (Görev 17.5 ile bağımsız, paralel başlatılabilir) + paralel `price_delta_cents` ADR-003 §8.6 amendment (Görev 18 öncesi BLOCKER). Sonra Görev 18 Products/Variants CRUD. ADR-007 (rate limiting) Phase 2 ortasında. Socket.IO altyapısı KDS endpoint'leriyle birlikte Phase 3 (charter drift cleanup beklemede).
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
  - **Users `(tenant_id, username)` UNIQUE eksik (Sprint 0/1 borç):** 000_init.sql `users` tablosu yalnız `(id, tenant_id)` composite PK UNIQUE'i taşır; `(tenant_id, username)` UNIQUE constraint **mevcut şemada yok**. ADR-002 §1 implicit "tenant içinde username benzersiz" varsayımını ihlal — runtime'da iki user aynı username ile yaratılabilir. Düzeltme migration ile yapılır; hangi sprint'te ele alınacağı Sprint 3b sonrası karar verilir (ayrı PR, küçük migration). 2026-04-27 tespit (ADR-002 §10 review sırasında, PR `chore/sprint-3-plan`).
  - **[RESOLVED 2026-04-27 Görev 15.5]** CI integration test sahte yeşil drift (kritik — Görev 15.5 blocker idi): `DATABASE_URL` CI'de set edilmediği için `describe.skipIf(DB_URL undefined)` ile tüm integration testler **skip** oluyordu. PR #18 "16 test yeşil" iddiası CI tarafında **skip durumu**, gerçek execution değil. **Çözüm:** ADR-001 §6.1 amendment + `.github/workflows/ci.yml` postgres service container + DATABASE_URL env + migrate step + TZ=UTC pin. **Kalan borç:** amendment merge'i ile ortaya çıkacak fixture drift'leri (tenant_settings benzeri başka eksikler) ayrı maddeler olarak listeye eklenecek (it.skip + borç stratejisi, ≤3 sınır; aşılırsa Görev 15.6 ayrı borç).
  - **Codegen Windows shell uyumsuzluğu:** `packages/db/package.json` `codegen` script'i `--url $DATABASE_URL` shell expansion'ı Windows'ta çalışmıyor, dialect "sqlite assumed" fallback'e düşüyor. Workaround inline `--url "..."` geçirme. CI Linux'ta sorunsuz, sadece Windows lokal dev etkileniyor. Düzeltme: cross-env veya dotenv-cli script wrapper, küçük PR. Phase 2 ortası uygun, blocker değil. 2026-04-27 Görev 14 sırasında tespit.
  - **`permissions.ts` plan-kod drift:** Sprint 0/1 plan'larında ve sonraki ADR/plan referanslarında `packages/shared-domain/src/permissions.ts` dosyası gösterildi (ABAC kuralları, action matrisi). Dosya hiç yaratılmadı; mevcut authorization `apps/api`'de `authorize(['admin', ...])` middleware ile yapılıyor. Görev 16 ABAC waiter filter inline conditional ile çözüldü, dosya açma scope dışı bırakıldı. Karar: ABAC kuralları çoğaldıkça (Sprint 4 KDS kitchen-routed, v5.1 ABAC genişlemeleri) `permissions.ts` veya benzeri bir merkezi mekanizma açılır; zamanlamayı tetikleyen koşul = 3+ ABAC kural noktası. 2026-04-27 Görev 16 sırasında tespit. **Plan/ADR referansları Sprint 3b Görev 17 öncesi gözden geçirilir** (Görev 17 plan'ında `permissions.ts users.create/read/update/delete` referansı var — başlamadan revize edilmeli). **[RESOLVED 2026-04-27 PR #31]** Sprint 3b plan revizyonu ile resolve edildi: Görev 17 plan'ından `permissions.ts` referansı kaldırıldı, JSDoc + inline conditional pattern (Görev 16 örneği) kullanılır.
  - **✅ [RESOLVED 2026-04-28 PR #36] ADR-003 §8.6 `price_delta_cents` semantik amendment:** Görev 17.5 schema sync sırasında tespit (BLOCKER işaretiyle Sprint 3b kapanış kriterlerine eklenmişti). **Resolve:** §8.6 Amendment 2026-04-28 ile signed INTEGER + negatif/sıfır/pozitif izinli + range hard-cap yok netleştirildi (decisions.md §8.6 sonuna inline + changelog satırı). v3 davranış referansı (küçük porsiyon -2 TL) gerekçesiyle zod `z.number().int()` mevcut hâli korundu, drift'siz. Görev 18 başlatılabilir.
  - **Active-plan vs charter Phase 2 drift (kritik — sistemik):** Charter (`docs/project-charter.md` Faz Roadmap line 160-164) Phase 2 kapsamı = REST endpoint'ler (auth, users, menu, tables, categories, products/variants) + **Socket.IO realtime altyapısı** + **Web UI 7 ekran** (login, ana sayfa, masa yönetimi, menü editörü, kullanıcı yönetimi, salon bölgeleri, işletme ayarları) + **E2E Playwright smoke suite**. Active-plan'de sadece API katmanı (Sprint 0-3) ele alındı; Socket.IO, Web UI, E2E **hiç plan'a girmedi** — active-plan Phase 2 vizyonu charter'ın yarısı bile değil. Charter Phase 3 kapsamı = Sipariş akışı + Mutfak ekranı (KDS) + Ödeme + Print Agent + Raporlar. Active-plan'de "Sprint 4 KDS + POST /payments" yazılı — bu Phase 3 kapsamı, drift. ADR-008 amendment "Sprint 4 KDS" referansları aynı drift'i taşıyor. **Aksiyon:** Sprint 3b kapanışından sonra Phase 2 plan tamamen yeniden yapılandırılır: charter kalan iş (Categories full CRUD + Socket.IO + Web UI + E2E) explicit sprint'lere bölünür. KDS + POST /payments Phase 3 Sprint 1'e taşınır, ADR-008 amendment referansları güncellenir. 2026-04-27 Sprint 3b plan revizyonu sırasında tespit.
  - **Migration §14.1.B Phase-conditional enforcement (ADR-003 §14.1.B.3, Amendment 2026-04-27):** 002-004 (ve gelecek 005) migration'larında `CREATE INDEX` CONCURRENTLY'siz; §14.1.B kuralı **değişmedi**, aktivasyonu Phase 4 prod cutover öncesine koşullandırıldı (Phase 0-3 dev ortamı, prod traffic yok → lock-blocking riski gerçek değil).
    - **Aktivasyon milestone:** Phase 4 prod cutover hazırlığı blocker'ı.
    - **Üç iş — sıra + bağımlılık:**
      1. TS migration infrastructure PR (`ts-node` + ESM uyum + tsconfig + migrate script flag) — tek başına merge edilebilir.
      2. Migration runner değişim değerlendirmesi (`umzug`/`dbmate`/`goose`) — #1 alternatifi VEYA paralel inceleme; karar Phase 4 başı.
      3. 002-005 re-create — opsiyon (a) yeni TS forward migration `DROP + CREATE INDEX CONCURRENTLY`, opsiyon (b) runner #2 ile yeniden çalıştırma; karar Phase 4 başında.
    - **db-migration-guard CI check:** §15.5 regex check (CREATE INDEX without CONCURRENTLY → BLOCKER) Phase 4 ile aktive olur; bugün runtime gate yok.
    - **Atıf:** ADR-003 §14.1.B.3 (Phase-conditional enforcement), §15.5 (parser-level enforcement mekanizması).

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
- **Architect sub-agent uydurma cross-ref örüntüsü:** Architect sub-agent çağrıldığında, var olmayan ADR/bölüm referansları + hayali şema kolonları üretebiliyor (3 vaka tespit edildi 2026-04-27 itibarıyla: (1) ADR-002 §6.5 — yok, ADR-002 §6→§7 atlıyor; (2) `audit_logs` şema kolon adları `action`/`resource_type`/`resource_id`/`ip_address` — hiçbiri gerçek şemada yok, gerçek kolonlar `event_type`/`entity_type`/`entity_id` + IP hiç yok; (3) ADR-001 multi-tenant ADR — yok, uydurma). **Mitigasyon:** Architect çıktısı dosyaya yazılmadan ÖNCE her cross-ref ve şema referansı doğrulanır (grep ile `decisions.md`'de bölüm varlığı + migration dosyalarında kolon varlığı). Architect prompt'una "var olmayan referans uydurma; emin değilsen 'doğrulanmamış' işaretle" notu eklenir. Implementer sub-agent için aynı: "ADR'de yazmayan kararı sessizce karar üretme — esnetme veya istisna gerekçesi gerekiyorsa explicit flag'le".

## 6. Kalite kontrol checklist (Claude.ai)

> Bu checklist **her stratejik karar, her Claude Code prompt yazımı, her ADR bölümü onayı** öncesi çalıştırılır. Gündelik sohbet mesajlarında (hazırlık, bağlam, açıklama soruları) değil.

- [ ] Kullanıcıyı abartılı övmedim mi, ciddi ton korundu mu
- [ ] Önerim kapsam kilidiyle (v5.0 MVP) uyumlu mu
- [ ] Stratejik karar veriyorsam alternatifleri de sundum mu
- [ ] "Yap" derken gerekçesini verdim mi
- [ ] Claude Code prompt'u yazdıysam disiplin kuralları içeriyor mu (diff göster, push'u hatırlat, context'i kontrol et, verbatim sunum zorunlu)
- [ ] Sabit kararlardan birini zedeleyen öneri yapıyor muyum
- [ ] Tool/terminoloji tutarsızlığı var mı, kontrol ettim mi
