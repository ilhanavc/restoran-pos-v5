# Aktif Plan — Phase 1: Core Domain + Auth

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince tamamen yenilenir.

## Faz: 1 (Core Domain + Auth + DB Repository Katmanı)

Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap" bölümü. Phase 1 sonunda Phase 2'ye (Sipariş + Masa + Menü UI) geçilir.

## Hafta: 1 / 4

### Hafta 1-2 hedefi (cümle)

`packages/shared-types` (zod şemaları) + `packages/shared-domain` (saf hesap fonksiyonları, TDD %85+) + `packages/db` repository katmanı (Kysely) tamamlanır. Hafta 2 sonunda auth-dışı domain hesabı tam test edilir, hafta 3-4'te `apps/api` üzerinde JWT/RTR auth endpoint'leri ayağa kalkar.

### Görevler (sırayla)

#### 9. `packages/shared-types` — Zod şemaları
- **Durum**: ✅ **Tamamlandı (2026-04-25, Session 22, commit `43bf030` + DoD fix `c65334e`)**
- **DoD fix (Session 22 kapanışı):** `generated.ts` enum uyumsuzluğu tespit edildi — `payment.ts` `comp` kaldırıldı, `001_fix_enum_values.sql` migration yazıldı (`order_status` +3 değer, `payment_type` +transfer, `payment_scope` rename full/item/partial). Typecheck + 75 test hâlâ yeşil.
- **Yürütücü**: `implementer` sub-agent
- **Bağımlılık**: ADR-001 §3 (paket isimlendirme), ADR-003 §4-9 (DB şeması), `packages/db/src/generated.ts` (kysely-codegen referansı)
- **Çıktı**:
  - `packages/shared-types/src/auth.ts` — `LoginRequestSchema`, `LoginResponseSchema`, `TokenPairSchema`, `RefreshRequestSchema`
  - `packages/shared-types/src/user.ts` — `UserRoleEnum` (`admin`/`cashier`/`waiter`/`kitchen`), `UserPublicSchema` (DB satırından `password_hash` çıkarılmış), `UserCreateSchema`
  - `packages/shared-types/src/table.ts` — `TableStatusEnum`, `TableRowSchema`, `TablePublicSchema`
  - `packages/shared-types/src/menu.ts` — `CategorySchema`, `ProductSchema`, `ProductVariantSchema`
  - `packages/shared-types/src/order.ts` — `OrderTypeEnum`, `OrderStatusEnum`, `OrderRowSchema`, `OrderItemSchema`, `OrderCreateRequestSchema` (Phase 2 için iskelet)
  - `packages/shared-types/src/payment.ts` — `PaymentTypeEnum`, `PaymentScopeEnum`, `PaymentSchema`, `PaymentItemSchema`
  - `packages/shared-types/src/audit.ts` — `AuditLogSchema`, sanitizer için tip
  - `packages/shared-types/src/money.ts` — `MoneyCentsSchema` (`z.number().int().nonnegative()`), branded type `Cents`
  - `packages/shared-types/src/index.ts` — barrel export
- **DoD**:
  - `pnpm --filter @restoran-pos/shared-types typecheck` temiz
  - `any` yok, `unknown` minimal ve gerekçeli
  - Her schema hem `Schema` hem `z.infer<typeof Schema>` type export eder
  - DB row schema'ları `packages/db/src/generated.ts` enum'larıyla bire bir uyumlu (string literal eşleşmesi)
  - `pnpm build` çıkışı `dist/` üretir, `apps/api` ve `apps/web` import edebilir (smoke import deneme)
  - Para alanları `*_cents: z.number().int()` — `.positive()` veya `.nonnegative()` domain semantiğine göre
  - Türkçe i18n-key kuralı: schema seviyesinde Türkçe mesaj YASAK (zod default İngilizce error mesajı kalır, UI katmanı çevirir)

#### 10. `packages/shared-domain` — Saf domain fonksiyonları (TDD)
- **Durum**: ✅ **Tamamlandı (2026-04-25, Session 22, commit `7f7b28c`)**
- **Yürütücü**: `implementer` sub-agent + `qa-engineer` (test ilk yaklaşım)
- **Bağımlılık**: Görev 9 (`shared-types` import edilir)
- **Kısıt**: SIFIR I/O, SIFIR DB bağımlılığı, SIFIR HTTP. Yalnız pure function. `Date.now()` parametre olarak geçirilir, doğrudan çağrılmaz.
- **Çıktı**:
  - `src/money.ts` — `addMoney(a, b)`, `subtractMoney(a, b)`, `multiplyMoney(a, factor)`, `formatMoney(cents, locale='tr-TR')` (`"₺123,45"`), `parseMoney('₺123,45')` (input alanı için). Tüm operasyonlar integer cent.
  - `src/order.ts` — `calculateItemSubtotal(item)`, `calculateOrderSubtotal(items[])`, `calculateOrderDiscount(subtotal, discount)`, `calculateOrderTotal(subtotal, discount, tax)`. İkram (`is_comp`) ve iptal (`is_cancelled`) item'ları toplama dahil edilmez (ADR-003 §10 kuralı).
  - `src/tax.ts` — `calculateVAT(subtotal_cents, rate_bps)` (rate basis points: 1000=%10, 2000=%20). KDV oranları: yemek %10, içecek/alkol %20 — kategori bazlı, `getCategoryVATRate(category)` helper. **Açık soru:** `docs/v3-reference/domain-rules.md`'den teyit, gerekirse İlhan'a sorulur (kapsam değişikliği DEĞİL, kuralın v5'teki yeri).
  - `src/table.ts` — `isTableOccupied(table)`, `canOpenOrderOnTable(table, currentOrders)`, `getTableStatusTransition(from, to)` — geçerli geçişleri (`available → occupied → cleaning → available`) doğrular.
  - `src/order-no.ts` — günlük `order_no` formatı için yardımcılar (DB sayaç üretir, burada sadece format/parse). `formatOrderNo(no)` → `"#0042"` gibi.
  - `src/validation.ts` — `assertPositiveCents`, `assertValidPhone(normalized)` (KVKK son-4 hane saklama kuralı domain-bağımsız fonksiyonu)
  - `tests/` — Vitest, %85+ coverage (statements + branches). Her dosyanın `*.test.ts` karşılığı.
- **DoD**:
  - `pnpm --filter @restoran-pos/shared-domain test` yeşil
  - `pnpm --filter @restoran-pos/shared-domain test -- --coverage` ≥ %85 statements, ≥ %85 branches
  - `pnpm --filter @restoran-pos/shared-domain typecheck` temiz
  - Hiçbir dosyada `import` üzerinden `pg`, `kysely`, `express`, `fs`, `crypto` (hash hariç pure ise olabilir) — ESLint kuralı veya manuel grep
  - Para asla float değil — runtime `Number.isInteger` assertion test'leri
  - Boundary cases: 0 TL, 1 kuruş, çok büyük tutar (overflow eşiği `Number.MAX_SAFE_INTEGER`)

#### 11. `packages/db` — Connection + Repository katmanı (auth-temelli scope)
- **Durum**: ✅ **Tamamlandı (2026-04-25, Session 23, worktree commit)**
- **Yürütücü**: `implementer` sub-agent + `db-migration-guard` review (sadece SQL ve role kullanımı için)
- **Bağımlılık**: Görev 9 (`shared-types`), `packages/db/src/generated.ts` (mevcut kysely tipi), ADR-002 (auth tabloları), ADR-003 §15 (4 rol matrisi)
- **Kısıt**: Bu görev SADECE auth + temel masa/kullanıcı repo'larını içerir. `orders`, `payments`, `print_jobs` repo'ları Phase 2'ye bırakılır.
- **Çıktı**:
  - `packages/db/src/connection.ts` — `createPool(config)` factory. `DATABASE_URL` env'i okur, `pg.Pool` döner. App role default; migrate script'inde `MIGRATOR_DATABASE_URL` ayrı.
  - `packages/db/src/kysely.ts` — `createKysely(pool)` → `Kysely<DB>` (DB tipi `generated.ts`'den)
  - `packages/db/src/repositories/users.ts` — `findByEmail(email)`, `findById(id)`, `create({ email, passwordHash, role, tenantId })`, `updatePassword(id, newHash)`, `softDelete(id)` — hepsi `tenant_id` parametresi alır (ADR-003 RLS kuralı).
  - `packages/db/src/repositories/refresh-tokens.ts` — `create({...familyId, parentId?, tokenHash: Buffer})`, `findByTokenHash(Buffer)`, `revokeByTokenHash(Buffer, reason)`, `revokeFamilyAll(familyId, reason)`, `deleteAllForUser`, `deleteExpired`. Token DB'de **SHA-256 hash (BYTEA)** olarak tutulur, plain text yasak (ADR-002 §4.2).
  - `packages/db/src/repositories/tables.ts` — `findAll(tenantId)`, `findById(tenantId, id)`, `findByStatus(tenantId, status)`, `updateStatus(tenantId, id, status)` (Phase 2 sipariş ekranı buna bağlanacak ama Phase 1'de smoke için yeter).
  - `packages/db/src/repositories/index.ts` — barrel export
  - `packages/db/src/errors.ts` — `RepositoryError`, `NotFoundError`, `ConflictError` (PG `23505 unique_violation` mapping). API katmanı bunları yakalar.
- **DoD**:
  - ✅ `pnpm --filter @restoran-pos/db typecheck` temiz (0 hata)
  - ✅ `pnpm --filter @restoran-pos/db test` — 11 test, `DATABASE_URL` yoksa skip (beklenen davranış)
  - ✅ Tüm query'ler kysely query builder üzerinden, raw SQL yalnız gerekli yerde (`sql<T>` template)
  - ✅ `tenant_id` parametresi her repo fonksiyonunda zorunlu
  - ✅ PG hata kodları `errors.ts` üzerinden domain hataya çevrilir
  - ✅ Pool tek instance, test'te dispose edilir
  - **Not:** Migration 002 (`refresh_tokens`) + 003 (`users.email`) eklendi. `tables.status` kolonu yok — derived status orders JOIN ile türetiliyor.
  - **ADR borcu (Görev 12 öncesi):** `tables.status` derived field'ı — semantik `orders.status='open'` yerine ADR-003 §14.2.B (`NOT IN ('paid','cancelled')`) ile hizalanacak. Orders modülü başlamadan önce `repositories/tables.ts` güncellenir.
  - **Migration 003 borcu (Phase 3):** `users_tenant_email_ci_idx` partial index değil — `email` nullable iken `lower(NULL)` index'e dahil edilmez (NULL'lar çakışmaz, iki NULL email aynı tenant'ta oluşabilir). Email NOT NULL yapıldığında (Phase 3) index `WHERE email IS NOT NULL` partial olarak yenilenecek.

#### 12. `apps/api` — Auth endpoint'leri + middleware
- **Durum**: ✅ **Tamamlandı (2026-04-25, Session 23, commit `e3c4a7f`)**
- **Yürütücü**: `implementer` sub-agent + `security-reviewer` zorunlu review
- **Bağımlılık**: Görev 9, 10, 11 hepsi tamam. ADR-002 §3-7 (token TTL, RTR, cookie ayarları, role matrix).
- **Çıktı**:
  - `apps/api/src/auth/jwt.ts` — `signAccessToken(payload, secret, ttl='30m')`, `verifyAccessToken(token, secret)`. HS256 (ADR-002 §3 — RS256 v5.1). Payload: `sub, tenant_id, role, jti, iat, exp, type` + `kid: "v1"`.
  - `apps/api/src/auth/password.ts` — `hashPassword(plain)` (bcrypt cost 12), `verifyPassword(plain, hash)`
  - `apps/api/src/auth/refresh.ts` — `issueRefreshToken(...)` (`crypto.randomBytes(32)` → base64url plain, SHA-256 Buffer hash → DB, family_id üret), `rotateRefreshToken(oldPlain)` (RTR: ADR-002 §4.3 — `revokeByTokenHash('rotated')`, reuse detection → `revokeFamilyAll('reuse_detected')`)
  - `apps/api/src/auth/cookie.ts` — `setRefreshCookie(res, plain)` (`HttpOnly`, `Secure` (prod), `SameSite=Strict`, `Path=/auth/refresh`, `Max-Age=30d`), `clearRefreshCookie(res)`
  - `apps/api/src/middleware/authenticate.ts` — `Authorization: Bearer` header → JWT verify → `req.user` set
  - `apps/api/src/middleware/authorize.ts` — `authorize(['admin', 'cashier'])` → role check, 403 dön
  - `apps/api/src/routes/auth.ts`:
    - `POST /auth/login` — body: `LoginRequestSchema`. response: `{ accessToken, user: UserPublic }` + Set-Cookie refresh. Rate limit: 5 deneme / 15dk / IP (express-rate-limit).
    - `POST /auth/refresh` — cookie'den refresh oku → rotate → yeni accessToken + yeni refresh cookie
    - `POST /auth/logout` — cookie'den refresh oku → DB'den sil → cookie clear
    - `GET /auth/me` — `authenticate` middleware sonrası `req.user` döner
  - `apps/api/src/routes/index.ts` — router barrel
  - `apps/api/src/index.ts` — Express app: helmet, cors (web origin whitelist), cookie-parser, json body, /health (mevcut), /auth router
  - `apps/api/.env.example` güncelle — `JWT_ACCESS_SECRET`, `JWT_REFRESH_PEPPER`, `BCRYPT_COST=12`, `WEB_ORIGIN`
- **DoD**:
  - `pnpm --filter @restoran-pos/api typecheck` temiz
  - `pnpm --filter @restoran-pos/api test` — integration test (supertest): login → me → refresh → logout zinciri yeşil
  - Manuel smoke: `curl -X POST /auth/login → 200` + cookie set + `curl /auth/me -H "Authorization: Bearer ..." → 200`
  - **`security-reviewer` onayı**:
    - JWT secret env'den okunuyor, hardcoded yok
    - Cookie flags doğru (`HttpOnly` + prod `Secure` + `SameSite=Strict`)
    - Password log'a yazılmıyor (logger filtresi)
    - Rate limit aktif
    - RTR token theft detection uygulanmış (eski refresh 2. kez gelirse tüm session invalidate)
    - Plaintext refresh token DB'de DEĞİL (hash)
    - Bcrypt cost ≥ 12
    - Error response'larında stack trace yok (prod)
  - `any` yasağına tam uyum
  - Tüm response/error mesajları i18n-key cinsinden değil — API katmanı `error.code` döner (`AUTH_INVALID_CREDENTIALS` gibi), Türkçe çeviri UI'da yapılır
  - **Açık borç:** Logout idempotent davranışı (token bulunamazsa no-op) ADR-002'de explicit değil — v5.1'de netleştirilecek. Mevcut davranış `revokeByTokenHash` `WHERE revoked_at IS NULL` filtresi sayesinde doğal no-op.

#### 13. Seed + manuel smoke + Phase 1 exit doğrulaması
- **Durum**: ✅ **Tamamlandı (2026-04-25, Session 24, commit `6d181e6`)** — fresh DB → migrate → seed (1 inserted) → seed (0 inserted, idempotent) → guard NODE_ENV=production blocked → 6 adım smoke (login → me → refresh+rotate → me → logout → 401-refresh) hepsi yeşil. 5 düzeltme: bcryptjs ESM import, pool çift-close, packages/db exports, apps/api `"type":"module"`, `apps/api/.env.example` TENANT_ID UUID v7, `000_init.sql` Pilot Restoran sızıntısı kaldırıldı.
- **Yürütücü**: `implementer` sub-agent
- **Bağımlılık**: Görev 9-12 hepsi ✅
- **Çıktı**:
  - `packages/db/src/seed.ts` — dev ortamı için: 1 tenant (kendi restoran), 1 admin user (`admin@local` + bcrypt hash'lenmiş `admin1234`), 5 örnek masa (1-5 numaralı, status `available`), 3 kategori (Yemek/İçecek/Tatlı), 5 ürün
  - `packages/db/package.json` — `"seed": "tsx src/seed.ts"` script'i
  - `docs/engineering/local-dev.md` — yeni dosya (veya mevcut güncelle): `pnpm install` → `docker compose up -d` → `pnpm --filter @restoran-pos/db migrate` → `pnpm --filter @restoran-pos/db seed` → `pnpm --filter @restoran-pos/api dev` adımları
  - Manuel smoke senaryosu (markdown checklist içinde adım adım): login → me → refresh → me (yeni token) → logout → me (401)
- **DoD**:
  - Seed idempotent (çalıştırılınca duplicate hatası vermez — `ON CONFLICT DO NOTHING` veya seed flag kontrolü)
  - Seed yalnız `NODE_ENV !== 'production'` veya `ALLOW_SEED=true` ile çalışır (ADR-003 dev-reset 4-guard pattern)
  - Smoke senaryosunun tüm adımları yeşil
  - Phase 1 exit kriterleri (aşağıdaki bölüm) tamamen ✅

### Sıradaki görev

- **Sprint 14 PR-5 ✅ TAMAMEN KAPANDI** (7/7 alt-PR + PR-6 + PR-7 cleanup). **Sprint 15 PR-1/2/3/4 ✅ KAPANDI** (range parametre feature backend → frontend → panel plumbing → CSV range). **Anomaly comp/void scope ✅ KAPANDI** — ADR-015 Amendment 3 Accepted + uygulandı (Session 61, PR #158, sha `6442822`). cancel-only kısıtı kaldırıldı; scope: cancel + comp (item-level, `order_items.is_comped`) + void (future-proof, `orders.status='void'`). Migration 035 (`order_items.updated_at` + trigger) prereq olarak yazıldı, db-migration-guard APPROVED. reports.test 11 → 17 anomaly test. **Sprint 13 s7-payment-mod-b.spec ✅ KAPANDI** (Session 62, 2026-05-13, PR #160, sha `359e9da`) — 3 e2e iskelet skip → 3 aktif test (ADR-014 §10.4 Mod B); seed.ts 3 order+payment fixture (TABLE_2/3/4 idempotent), TableCard 3-nokta dot data-testid, S2-S5 paritesi loginViaUI + spaNavigate + actionsBtn native DOM click (Sidebar backdrop bypass). 6 CI iter — körlemesine fix pahalı, sub-agent + main context paralel teşhis ile çözüldü. **Print Agent Phase 3 PR-1 ✅ KAPANDI** (Session 63, 2026-05-14, PR #162, sha `3e15dd9`) — ADR-004 §Phase 3 PR-1 scope kilidi: `apps/print-agent/` skeleton (5sn polling loop) + `packages/shared-types/print-agent.ts` 4 endpoint zod schema + cloud `GET /print/v1/jobs/next?wait=N` (mock auth X-Tenant-Id, atomik FOR UPDATE SKIP LOCKED) + integration test 2 case. Enum drift kararı X (DB enum esas, ADR §3 metni sonraki amendment'ta). **0 fix iter CI ilk geçişte** (Session 62 6 iter dersi tersine: net architect amendment + tam implementer brief). **Print Agent Phase 3 PR-2 ✅ KAPANDI** (Session 63, 2026-05-14, PR #164, sha `8d99b6e`) — ADR-004 §Amendment 1: state machine DB enum diline hizalandı (`queued→printing→success|failed→retry|cancelled`) + `attempts` kolonu sözleşmeli + idempotency kontratı. Migration 036 (`print_jobs.attempts INT NOT NULL DEFAULT 0` + CHECK 0..100, db-migration-guard APPROVED). `POST /print/v1/jobs/:id/result` endpoint (atomik UPDATE WHERE status='printing', 4 response — 200/200-no-op/400/404). 6 integration test (success / failed→retry / failed→cancelled / non-printing 400 / idempotent / 404). 1 fix iter (codegen JSDoc `COMMENT ON COLUMN` çıktısı, manuel edit eksiği). **Print Agent Phase 3 PR-3a ✅ KAPANDI** (Session 64, 2026-05-14, PR #166, sha `58fb6bc`) — ADR-004 §Amendment 2: gerçek JWT auth backbone. Migration 037 (`agents` tablosu, 8 kolon + UNIQUE + 2 partial index + 9 COMMENT, db-migration-guard APPROVED). `POST /agent/register` (apiKey bcrypt match + idempotent fingerprint + access+refresh JWT) + `POST /agent/refresh` (stateless rotation, revoked check). Yeni `requireAgentJwt` middleware (`apps/api/src/middleware/print-agent-auth.ts`). Mevcut 2 endpoint (PR-1 + PR-2) `X-Tenant-Id` mock auth'tan **Bearer JWT'ye migrate edildi** (hibrit auth yok, kapsam kilidi). 8 yeni integration test + 8 mevcut test auth migration. 30 dosya değişim (21 test buildApp deps'ine `agentSecret` zorunlu eklemesi). 2 fix iter: (1) table-level JSDoc codegen üretmez (sadece COMMENT ON COLUMN), (2) e2e.yml workflow'da `JWT_AGENT_SECRET` env eksik (API start fail). **Print Agent Phase 3 PR-3b ✅ KAPANDI** (Session 64, 2026-05-14, PR #168, sha `19c382d`) — Agent client tarafı end-to-end auth flow. `apps/print-agent/src/index.ts` baştan yazıldı (~270 satır): `register(cfg)` boot'ta apiKey+fingerprint POST → AgentSession (in-memory, file persist Phase 4+); `refresh(cfg, session)` token stale (5dk buffer) → POST refresh, fail → re-register fallback; `pollOnce(cfg, session)` `Authorization: Bearer ${accessToken}` (X-Tenant-Id kaldırıldı, 401 race → tek-shot refresh kurtarma); `reportResult` job sonrası dummy success POST. ENV değişikliği: `PRINT_AGENT_API_KEY` zorunlu + opsiyonel `PRINT_AGENT_DEVICE_FINGERPRINT`; `PRINT_AGENT_TENANT_ID` kaldırıldı. **0 fix iter CI ilk geçişte** (Session 63 PR-1 paterni teyit: küçük scope + tam brief = single-pass). 3 dosya değişim (+233/-36). +2 dep (`jsonwebtoken@9` + types). **Sırada: PR-4** (cloud render mutfak fişi şablonu, ESC/POS byte stream üreten template), sonra PR-5 (printer transport USB + TCP 9100), PR-6 (MSI installer + nssm Windows servisi).

**Sprint 13 ✅ TAM (Session 58 + 62 ile) + Sprint 14 backend ✅ KAPANDI (Session 58, 2026-05-11, 12 PR #127-#137).** Sprint 13 ADR-014 §10 Mod B test örtüsü (5 integration + 3 e2e iskelet skip → Session 62 PR #160 ile 3 e2e aktif: 3/3 PASS). Sprint 14 backend: ADR-015 Amendment 1 + ADR-021 ✅ Accepted, 5 yeni rapor endpoint (category-sales/anomalies cancel-only/user-performance/daily-close/snapshot) + CSV export 13/13 endpoint (?format=csv + UTF-8 BOM + ; delimiter + audit_logs entry + 100k row cap REPORT_TOO_LARGE). reports.test 12→93 (+81 test). Charter Phase 3 madde 5 (Raporlar) ✅ TAM. main HEAD `6442822` (**Session 61 KAPANDI 2026-05-13**, PR #158: ADR-015 Amendment 3 — anomaly comp/void scope + Migration 035 + 6 yeni test). Session 60 özeti: Sprint 14 PR-5 7/7 + Sprint 15 PR-1/2/3/4 (range feature) + ADR-015 Amendment 2 + 3 shadcn primitive. Session 61 özeti: ADR-015 Amendment 3 + Migration 035 (order_items.updated_at, 000_init drift cleanup) + anomalies.ts 3 sorgu birleşik + 6 yeni integration test + bir TS fix iteration.

**Phase 2 Sprint 1-11 ✅ KAPANDI (Session 54, 2026-05-07).** Sırasıyla: Sprint 1-3 (POST/GET endpoint'ler, ABAC, admin CRUD), Sprint 4-7 (areas + settings + Socket.IO), Sprint 8a-d (Web UI 7 ekran), Sprint 10 (Caller ID + müşteri yönetimi PR-8), **Sprint 11 (paket sipariş + sidebar fix + müşteri atama + hard delete + paid-only raporlar PR #102/#103/#104/#106)**. Charter Phase 2 exit kriterleri 4/4 sağlanmış (REST + Socket.IO + Web UI + ~~E2E~~) — yalnız Sprint 9 E2E eksik. **Açık PR: 0.** **Tüm test'ler:** 329/329 PASS, 0 skipped (Sprint 11 borç tamam).

### Phase 1.5 — Eksik policy + drift cleanup (forensic audit sonucu)

**Bağlam:** Phase 1 Exit Audit (Session 25) Forensic Verdict B (atlama): charter Phase 1 listesindeki "Menu/Payment/User entity ve policy'leri" maddesi `1292b7f` commit'inde active-plan brief'lerine geçmedi (sessiz daraltma). Audit Katman 2 ek bulgular: ESLint kural eksikliği (ADR-001 §2.2 drift), migration idempotency (CREATE ROLE cluster-level çakışma), ölü `eslint-disable` directives. Phase 1.5 paketi Phase 2'ye geçmeden önce bu eksiklerin tamamlanması.

**Görevler:**
1. `packages/shared-types/src/permissions.ts` (ADR-002 §6 role permission matrix) — ✅ commit `bc9cba1`
2. ESLint `no-restricted-imports` + gerçek lint scriptleri (ADR-001 §2.2) — ✅ commit `040521f`
   - **Yan ürün (İş #2.5):** ölü `eslint-disable` directives temizliği — ✅ commit `3c5458b`
3. Migration `CREATE ROLE` idempotency (DO/EXCEPTION pattern) — ✅ commit `3eb8481`
4. `packages/shared-domain/src/menu.ts` Menu policy + tests — ✅ commit `bf33fc5`
5. `packages/shared-domain/src/payment.ts` Payment policy + tests — ✅ commit `c27de1a`
6. `packages/shared-domain/src/user.ts` (domain) User policy + tests — ✅ **Tamamlandı (Phase 1.5 oturum 2)**
7. **`docs/v3-reference/domain-rules.md` + `.claude/memory/decisions.md` drift cleanup** — ✅ **Tamamlandı**
   - §10 prose: Phase 1.5 oturum 2'de tamamlandı
   - §9 CREATE TYPE drift: Session 28, PR #11 (`payment_scope {full,item,partial}`, `payment_type` +transfer)
8. `CHANGELOG.md` — ✅ **Tamamlandı (commit `9574cf9`)**
9. `docs/project-charter.md` + `docs/context-anchor.md` netleştirmeleri — ✅ **Tamamlandı (commit `a0e5eda`)**
10. (yer tutucu — yan ürün İş #2.5 burada zaten sayılı)
11. Phase 1.5 paketi toplu push — ✅ **Tamamlandı (commit `4765683`)**

**Sıralama notu:** İş #7 (drift cleanup) İş #6 (User policy) ÖNCESİ yapılır — User policy `domain-rules.md`'ye referans verecek, güncel görmesi lazım.

**Phase 2'ye geçiş öncesi (Phase 1.5 paketi dışı, ayrı):**
- Branch protection main'de aktif (force push yasak, PR zorunlu, CI yeşil olmadan merge yasak) — **Free yeterli (public repo); GitHub Pro gerekmiyor.** Pro yalnız private repo'da branch protection için, Codespaces, veya Advanced Security (CodeQL/secret scanning) istenirse anlamlı.
- ADR-004 Accepted (Print Agent) — ✅ commit `8fb7e1b`

### Phase 2 Sprint 0 — Altyapı Ön-İşleri (Phase 2 Sprint 1 endpoint'leri öncesi zorunlu)

**Kaynak:** `docs/audits/phase-1-exit-audit-final.md` Bölüm 4B + 4C. Phase 1 Exit Audit Katman 3 verdict'i: "Phase 2'ye geçilebilir AMA şu kalemler Phase 2 başında halledilmeli."

**Tahmini süre:** ~1 hafta. ADR önce, kod sonra disiplini.

**Zorunlu (🔴 ilk endpoint'ten önce):**

1. **Error taxonomy ADR** (`.claude/memory/decisions.md` ADR-006 veya §10.5 C6 + §11.10 forward-ref'lerini birleştiren ayrı ADR)
   - DB RAISE → Türkçe i18n-key mapping
   - `23505 unique_violation` → `CONFLICT` + retry pattern
   - Endpoint hata kodları sözleşmesi (ör. `AUTH_INVALID_CREDENTIALS`, `MENU_PRODUCT_NOT_FOUND`, `ORDER_INVARIANT_VIOLATED`)
   - Error envelope format: `{ error: { code, message_key, details? } }`
   - **Yürütücü:** `architect` sub-agent

2. **`apps/api/src/errors.ts` + `errorHandler` middleware**
   - `RepositoryError` / `NotFoundError` / `ConflictError` → HTTP status + error envelope mapping
   - `app.use(errorHandler)` (4-arg signature) — `app.ts`'e enjekte
   - `auth.ts`'deki inline try/catch + `console.error` blokları temizlenir, throw'a düşürülür
   - **Yürütücü:** `implementer` (ADR-006 sonrası)

3. **`writeAudit()` + AuditSanitizer impl** (`apps/api/src/audit/`)
   - ADR-003 §12.4 kontratının çalışan implementasyonu
   - Allow-list keys (`packages/shared-domain/src/audit/allowed-keys.ts`)
   - DB CHECK constraint zaten 000_init.sql'de — bu kod TS savunma katmanı
   - Unit test: nested PII fixture sanitize'da reddedilmeli
   - **Yürütücü:** `implementer` + `security-reviewer` zorunlu review

**Önerilen (🟡 ilk hafta içinde):**

4. **`validateBody(Schema)` middleware** (`apps/api/src/middleware/validate.ts`)
   - zod `.safeParse(req.body)` pattern'ini tek noktada toplar
   - Başarısız parse → `errorHandler`'a yönlendirir (Bölüm 1 envelope formatında)
   - `auth.ts:83` ve sonraki tüm endpoint'ler bunu kullanır

5. **Logger altyapısı (pino)** (`apps/api/src/logger.ts`)
   - `auth.ts:159` `// logger altyapısı Phase 1'de gelecek, şimdilik console.error` borcunu kapatır
   - Structured JSON log, prod'da level=info, dev'de level=debug
   - Request-id middleware ile birleştirme (opsiyonel)
   - PII filter zorunlu (telefon, password, token)

6. **ESLint float yasağı kuralı** (eslint config)
   - `no-restricted-syntax` veya benzeri: `parseFloat`, `Number()` literal float, `*_amount` (cents olmayan) kullanım yasak
   - P-06 pain-point enforce
   - `packages/shared-domain` ve `packages/db` tarafında zaten zod runtime check var; ESLint compile-time savunma

**DoD (Sprint 0 bitişi):**
- [x] ADR-006 (Error taxonomy ADR) **Accepted** (2026-04-26)
- [x] `pnpm --filter @restoran-pos/api typecheck` temiz
- [x] `pnpm --filter @restoran-pos/api test` yeşil (auth.test.ts hâlâ geçer + yeni middleware testleri)
- [x] `pnpm -r lint` yeşil (yeni ESLint kuralları dahil)
- [x] `auth.ts` console.error kullanmıyor (logger üzerinden)
- [x] `auth.ts` inline try/catch kalkmış (errorHandler'a delege)
- [x] writeAudit() integration test (DB'ye yazıyor, sanitizer çalışıyor)
- [x] Smoke senaryosu (login → me → refresh → logout) hâlâ 6/6 yeşil

**Phase 2 Sprint 0 ✅ KAPANDI (Session 27, 2026-04-26). Phase 2 Sprint 1 ✅ KAPANDI (Session 29, 2026-04-26, PR #15 squash `0242818`). Phase 2 Sprint 2 GET endpoint'leri ✅ KAPANDI (Session 30, 2026-04-26, PR #19 squash `c439944`). Phase 2 Sprint 3 sıradaki — Sprint 3a (ABAC unblock) + Sprint 3b (admin CRUD), detay aşağıda.**

### Phase 2 Sprint 3 — ABAC Unblock + Admin CRUD

**Bağlam:** ADR-008 §4 prerequisite'leri + charter "menu/users CRUD" maddesi. Sprint 3 toplu boyutu (~1500 satır) review cehennemi yaratacağı için **3a + 3b** alt-sprint'e bölündü. Sprint 3a önce (ABAC production-blocker), Sprint 3b sonra (yeni feature).

**Sprint 3 forward-ref tablosu:**

| Forward-ref | Hedef sprint | Gerekçe / Aksiyon |
|---|---|---|
| KDS endpoints + kitchen ABAC + station mapping ADR'si | **Phase 3 Sprint 1** | MVP zorunlu (mutfak siparişi görünürlüğü). KDS UI sözleşmesi + `order_items.station` mapping ADR'si Phase 3 Sprint 1 başında. ADR-008 amendment (2026-04-27) Sprint 4 referansları → **Phase 3 Sprint 1** (charter drift cleanup 2026-04-28 PR `chore/phase-2-drift-cleanup-sprint-4-9-plan` ile düzeltildi) |
| POST /payments + payment error registry kodları aktivasyonu (ADR-006 §5.2) | **Phase 3 Sprint 1** | Endpoint Phase 3 Sprint 1'de (charter Phase 3 kapsamı). Registry kodları (`PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_TYPE_INVALID`) ADR-006'da yazılı, kod entegrasyonu Phase 3 |
| Görev 17 status code kararı: `USER_LAST_ADMIN_PROTECTED` (409) + `USER_CANNOT_DELETE_SELF` (403) | ✅ ADR-002 §10 + ADR-006 §5.2 registry'de yazıldı (PR `chore/sprint-3-plan`) | RFC 9110 §15.5.10 (409 state conflict) + §15.5.4 (403 forbidden, actor=target ABAC). 422 reddedildi (parse semantic değil, runtime state) |
| Görev 18 öncesi: variant nested write + cascade soft delete kararı (ADR-009 veya ADR-003 amendment) | **Görev 18 öncesi (Sprint 3a kapanış sonrası)** | Variant write stratejisi (POST/PATCH /products nested vs ayrı endpoint) ve product soft delete'in variants'a etkisi tanımsız. order_items snapshot kuralı (ADR-003 §10) variant adını kopyaladığı için referansiyel risk yok ama write/list semantiği ADR'siz |

---

#### Sprint 3a — ABAC Unblock (migration 005 + POST hotfix + ABAC enable)

##### Görev 14. Migration 005 — `orders.waiter_user_id` kolonu ✅

- **Durum:** ✅ Tamamlandı (PR #24 squash `a12fdcb`, db-migration-guard 9/9 APPROVED)
- **Yürütücü:** `db-migration-guard` review → `implementer` (ADR-008 amendment 2026-04-27 ile FK semantiği netleşti, ek ADR gerekmez)
- **Bağımlılık:** ADR-008 §4 amendment Accepted ✅, ADR-003 §6 (orders tablosu), ADR-003 §6.5 (composite UNIQUE), `packages/db/src/generated.ts` regen
- **Çıktı:**
  - `packages/db/migrations/005_orders_add_waiter_user_id.sql`
    - `ALTER TABLE orders ADD COLUMN waiter_user_id UUID NULL`
    - **FK:** composite — `FOREIGN KEY (waiter_user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE SET NULL ON UPDATE NO ACTION` (ADR-008 §4.1 amendment)
    - **Index:** `CREATE INDEX orders_waiter_user_id_idx ON orders(tenant_id, waiter_user_id) WHERE waiter_user_id IS NOT NULL` (partial)
  - `packages/db/src/generated.ts` — `pnpm codegen` ile regen
  - `packages/shared-types/src/order.ts` — `OrderRowSchema.waiterUserId` zaten var (Sprint 1 drift); doğrula
- **DoD:**
  - Migration up + down test (rollback temiz)
  - `db-migration-guard` review ✅: composite FK §6.5 doğru, partial index gerekçesi, ON DELETE audit pattern hizalı
  - `pnpm --filter @restoran-pos/db migrate` yeşil (fresh DB)
  - `pnpm codegen` sonrası generated.ts diff sadece `Orders.waiter_user_id`
  - Mevcut `orders` satırları NULL ile geldi (backfill yok)

##### Görev 15. POST /orders hotfix — `waiter_user_id` set ✅

- **Durum:** ✅ Tamamlandı (PR #26 squash `1d3b6fd`, security-reviewer APPROVED, 4 rol matrisi test)
- **Yürütücü:** `implementer`
- **Bağımlılık:** Görev 14 ✅, ADR-008 §4 madde 1
- **Çıktı:**
  - `apps/api/src/routes/orders.ts` POST handler — `waiter_user_id: req.user.userId`
  - `apps/api/src/routes/orders.test.ts` — yeni assertion
- **DoD:**
  - Mevcut 16 POST integration test yeşil
  - +4 yeni test (4 rol matrisi)
  - Manuel smoke: login (waiter) → POST → DB satırında `waiter_user_id` doğru UUID

##### Görev 16. ABAC enable — waiter "kendi siparişi" filtresi ✅

- **Durum:** ✅ Tamamlandı (PR #29 squash `8936552`, security-reviewer APPROVED, 4 yeni ABAC test + IDOR regression + NULL davranış pin'i)
- **Yürütücü:** `implementer` + `security-reviewer` zorunlu review
- **Bağımlılık:** Görev 14, 15 ✅, ADR-008 §3
- **Çıktı:**
  - `apps/api/src/routes/orders.ts` GET handler — waiter rolü için `WHERE waiter_user_id = $userId` filtresi
  - `packages/shared-domain/src/permissions.ts` — ABAC kuralı yorum satırından kalkar
  - `apps/api/src/routes/orders.test.ts` — ABAC test bloğu
- **NULL davranışı kararı (varsayım değil, karar):**
  - `waiter_user_id IS NULL` satırlar waiter rolüne **görünmez** (filter `= $userId` NULL ile match etmez — SQL üç-değerli mantık)
  - NULL = "kimsenin değil"; waiter görmez, admin/cashier görür (filtresiz query)
  - Prod verisi yok, dev seed'inde waiter user yok → regression riski yok
- **DoD:**
  - Mevcut GET /orders testleri yeşil
  - +4 yeni ABAC test (waiter kendi/başkası/admin filtresiz/NULL davranışı)
  - `security-reviewer` review ✅: query-level filter, IDOR yok, NULL semantiği test'le doğrulanmış
  - Smoke: 2 farklı waiter user manuel cross-test

**Sprint 3a kapanış kriterleri (✅ KAPANDI 2026-04-27):**
- [x] Görev 14, 15, 16 hepsi ✅ (PR #24/#26/#29)
- [x] **Plan-dışı görevler eklendi (drift keşifleri, sınır kuralı ≤3 ile yönetildi):**
  - **Görev 15.5** — CI integration test gating (PR #27, squash `4792973`): ADR-001 §6.1 amendment + ci.yml postgres:17 service container + DATABASE_URL env + TZ=UTC pin + migrate step + turbo.json `tasks.test.env`. Sahte yeşil drift kapandı.
  - **Görev 15.6** — packages/db repo test fixture drift cleanup (PR #28, squash `cc7cb7d`): tenants INSERT eksikliği + afterAll pool.end() çift çağrı bug fix.
  - **Görev 15 alt-keşfi:** Sprint 1 borç fixture fix orders.test.ts (PR #25, squash `febc795`) — Görev 15 implementasyonu sırasında ortaya çıktı (orders.test.ts'e tenant_settings INSERT eksikliği, `populate_order_store_date` trigger için zorunlu), ayrı PR olarak çözüldü, Sprint 3a görevi değil.
- [x] CI yeşil — gerçek execution: 296 test (apps/api 56 + packages/db 11 + shared 229) skip 0 ([PR #29 run 24994139680](https://github.com/ilhanavc/restoran-pos-v5/actions/runs/24994139680))
- [x] PR squash merge sonrası context-anchor §2 güncel (PR #30, Session 34)
- [ ] **Sprint 3b başlamadan 3 blocker durumu:**
  - [x] ADR-002 §10 amendment ✅ merged (PR #22, squash `ec5eae9`) — User Lifecycle (last admin guard, self-delete guard, soft delete + token revoke, login filter, access risk window)
  - [ ] **Görev 18 ADR-X (variant nested write + cascade soft delete kararı)** yazılır + Accepted (Sprint 3b plan revizyonu PR #31'de architect mini-pass)
  - [ ] **`permissions.ts` plan-kod drift resolve** — Sprint 3b plan'ında Görev 17 `permissions.ts` "users.create/read/update/delete action'ları" referansları gözden geçirilir, mevcut `authorize()` middleware kararıyla uyarlanır (PR #31'de)

---

#### Sprint 3b — Admin CRUD (Users + Products/Variants)

> **Sıra notu:** Görev 17 ve 18 **birbirinden bağımsız**; ABAC unblock dışında karşılıklı bağımlılık yok. Önerilen sıra (Users → Products) RBAC pattern'inin Users'da oturtulup Products'da uygulanması içindir, **zorunlu değil**. Tek developer akışında sequential, paralel session mümkünse paralel.

##### Görev 17. Users CRUD (admin-only)

- **Durum:** ⏳ Sırada (Sprint 3a sonrası)
- **Yürütücü:** `implementer` + `security-reviewer` (ADR-002 §10 + ADR-006 §5.2 zaten kabul edildi PR `chore/sprint-3-plan` ile, ek ADR gerekmez)
- **Bağımlılık:** Sprint 3a ✅, ADR-002 §10 (User Lifecycle) Accepted ✅, `packages/shared-types/src/user.ts` (UserCreateSchema mevcut), `packages/db/src/repositories/users.ts` (mevcut, DELETE+update yöntemleri eksikse eklenir)
- **ADR-002 §10 kapsam özeti (referans):** Soft delete + son admin guard 409 + self-delete guard 403 + token revoke + login filter + access risk window 30dk + audit_logs entry. Detay decisions.md ADR-002 §10.1-10.9.
- **Çıktı:**
  - **Re-read önerisi (implementer brief'ine):** Görev 17 başlamadan ADR-002 §10 (User Lifecycle) + ADR-006 §5.2 registry yeni kodlar (`USER_LAST_ADMIN_PROTECTED` 409, `USER_CANNOT_DELETE_SELF` 403) re-read edilir. Implementasyon doğrudan ADR'ye refer eder.
  - `apps/api/src/routes/users.ts` — POST / GET (list + by-id) / PATCH / DELETE / PATCH password
  - `packages/shared-types/src/user.ts` — `UserUpdateSchema`, `UserListResponseSchema` (eksikse)
  - **NOT:** `permissions.ts` dosyası **yaratılmaz** — Sprint 0/1+ plan-kod drift olarak tespit edildi (context-anchor §2 borç). Mevcut `authorize()` middleware + JSDoc inline pattern (Görev 16 örneği) kullanılır.
  - `packages/db/src/repositories/users.ts` — `softDelete(id, tenantId)`, `update(...)`, `countActiveAdmins(tenantId)`
  - `apps/api/src/routes/users.test.ts` — tam CRUD + ABAC + lifecycle test
- **DoD:**
  - **20-25 integration test** (6 endpoint × 4 rol matrisi = 24 baseline + lifecycle senaryoları: son admin, self-delete, soft delete sonrası login, soft delete sonrası refresh fail, password change rate limit)
  - admin dışı tüm roller 403 (sadece kendi password değişimi 200)
  - Son admin koruması test'i: 1 admin'li tenant'ta DELETE → 409 `USER_LAST_ADMIN_PROTECTED`
  - Self-delete koruması: admin kendini silmeye çalışır → 403 `USER_CANNOT_DELETE_SELF`
  - Soft delete sonrası login deneme: 401 `AUTH_INVALID_CREDENTIALS`
  - Soft delete sonrası refresh: 401 `AUTH_REFRESH_INVALID` (family-wide revoke YOK)
  - Atomicity test: paralel 2 admin DELETE senaryosu — yalnız biri başarılı, diğeri 409
  - Password endpoint bcrypt cost 12 korunuyor
  - `security-reviewer` review ✅: password log filtresi, role escalation guard, son admin atomicity (transaction içinde count + delete + revoke + audit)
  - typecheck + lint + test yeşil

##### Görev 17.5. Migration 006 — `product_variants` tablosu (yeni — Görev 18 prerequisite)

- **Durum:** ⏳ Sırada (Sprint 3b plan revizyonu sonrası başlar)
- **Yürütücü:** `db-migration-guard` review → `implementer`
- **Bağımlılık:** ADR-003 §8.6 Accepted (Sprint 3b plan revizyonu PR'ı), 000_init.sql `products` tablosu mevcut, Sprint 0/1 schema-zod drift cleanup
- **Çıktı:**
  - `packages/db/migrations/006_add_product_variants.sql` — ADR-003 §8.6 prerequisite şeması (id/tenant_id/product_id/name/price_delta_cents/is_default/sort_order/deleted_at/timestamps + composite UNIQUE + composite FK ON DELETE RESTRICT + partial index)
  - `pnpm codegen` regen → `generated.ts` `ProductVariants` interface
  - `packages/shared-types/src/menu.ts` `ProductVariantSchema` drift cleanup: zod'a `tenantId`, `sortOrder`, `createdAt`, `updatedAt` eklenir. **Bu zod sync Görev 17.5 PR kapsamındadır, Görev 18 implementasyonuna taşmaz** (schema-only PR, tek bir scope).
- **DoD:**
  - Migration up + down test (forward-only ADR-001 §6.1.6)
  - `db-migration-guard` review ✅: composite FK + partial index + ADR-003 §6.5 composite UNIQUE + ON DELETE RESTRICT explicit
  - generated.ts diff sadece `ProductVariants` interface ekleme
  - typecheck + lint + test temiz (yeni test gerekmiyor, schema-only PR)
  - Görev 18 başlamadan merge zorunlu

##### Görev 18. Products/Variants CRUD (admin-only)

- **Durum:** ⏳ Sırada (ADR-003 §8.6 + Görev 17.5 migration 006 merged sonrası)
- **Yürütücü:** `implementer` + `security-reviewer` (admin-only auth, password etkilenmez)
- **Bağımlılık:** ADR-003 §8.6 Accepted ✅, Görev 17.5 migration 006 merged ✅, Sprint 3a ✅; **Görev 17'ye bağımlı DEĞİL**
- **✅ [RESOLVED 2026-04-28 PR #36] BLOCKER (Görev 18 öncesi):** ADR-003 §8.6 `price_delta_cents` semantik amendment — Görev 17.5 schema sync sırasında tespit (2026-04-28). **Resolve:** §8.6 Amendment 2026-04-28 ile signed INTEGER + negatif/sıfır/pozitif izinli netleştirildi (decisions.md §8.6 sonuna inline + changelog satırı). Görev 18 başlatılabilir.
- **ADR-003 §8.6 kapsam özeti (referans):**
  - **Variant write stratejisi:** nested (POST/PATCH /products body içinde `variants: []` array, transaction)
  - **Product soft delete cascade:** variants cascade soft delete (transaction)
  - **Variant lifecycle:** soft delete (defansif, v5.1 variant_id FK için)
  - **GET response:** nested variants (N+1 yasak — `WHERE product_id = ANY($1)` SELECT IN)
  - **PATCH semantiği:** `variants` body'de varsa declarative replace, yoksa dokunulmaz, `[]` = "tüm sil"
  - **`is_default` kuralı:** en fazla 1 + variants boş değilse en az 1 zorunlu; default silinince next-variant promote (en küçük sort_order)
- **Çıktı:**
  - `packages/db/src/repositories/products.ts` — CRUD (transaction-aware variant nested write)
  - `apps/api/src/routes/products.ts` — POST / GET / PATCH / DELETE
  - `apps/api/src/routes/products.test.ts`
  - `packages/shared-types/src/menu.ts` — `ProductCreateSchema`, `ProductUpdateSchema` (variants nested)
- **DoD:**
  - 14+ integration test (CRUD × 4 rol + nested variant senaryoları)
  - admin dışı 403
  - Variant transaction atomik (DB error halinde rollback)
  - Soft delete: product silinince variants ADR-003 §8.6 Karar 2 (cascade soft delete) — transaction içinde iki UPDATE
  - **N+1 query yasağı doğrulaması:** GET /products test'inde SELECT count assert (max 2 SQL: products + variants ANY)
  - **PATCH `variants: []` "tüm sil" davranışı** + UI confirm note (test'te explicit)
  - **`is_default` promote kuralı test'i:** default silinince next-variant default olur (en küçük sort_order)
  - **`is_default` validation test:** en fazla 1 true, variants boş değilse en az 1 zorunlu (422 VALIDATION_ERROR)
  - order_items snapshot regression test (ADR-003 §7)
  - typecheck + lint + test yeşil

**Sprint 3b kapanış kriterleri (✅ KAPANDI 2026-04-28):**
- [x] Görev 17, 17.5, 18 hepsi ✅ (PR #33 / #35 / #37)
- [x] ADR-003 §8.6 amendment merged ✅ (Sprint 3b plan revizyonu PR #31 + price_delta_cents amendment PR #36)
- [x] Migration 006 product_variants merged (Görev 17.5, PR #33 `f4d2f0e`)
- [x] **✅ BLOCKER RESOLVED (PR #36)**: ADR-003 §8.6 `price_delta_cents` semantik amendment merged (signed/negatif/range) — Görev 18 başlatılabilir
- [x] CI yeşil — gerçek execution doğrulanır (ADR-001 §6.1 gating aktif). PR #33/35/36/37 hepsi 2-3 check pass.
- [x] Görev 17 ve 18 ayrı PR'lar; Görev 17.5 migration ayrı küçük PR (PR #33/35/37)
- [x] permissions.ts plan-kod drift resolve ✅ (Sprint 3b plan revizyonu PR #31)
- [x] Phase 2 charter "Users CRUD + Menu CRUD" ✅ (Görev 17 + Görev 18, 70 yeni test 56→126)
- [x] **Active-plan-charter drift cleanup**: KDS + POST /payments → **Phase 3 Sprint 1** olarak yeniden numaralandırıldı (bu PR — `chore/phase-2-drift-cleanup-sprint-4-9-plan` 2026-04-28). ADR-008 amendment 7 satır güncellendi.


---

### Phase 2 Sprint 4 — Tables + Categories Full CRUD

**Bağlam:** Sprint 1-2'de POST/GET endpoint'leri yazıldı, PATCH/DELETE eksikti (charter Phase 2 line 161). Sprint 3b admin CRUD pattern'i (Görev 17/18) uygulanır.

**Tahmini süre:** 3-4 gün

##### Görev 19. PATCH/DELETE /tables (admin-only)
- **Yürütücü:** `implementer` + `security-reviewer`
- **Çıktı:** `apps/api/src/routes/tables.ts` PATCH (label/status/area_id), DELETE (soft delete) + 8+ test (4 rol × 2 endpoint)
- **DoD:** typecheck/lint/test yeşil, security-reviewer ✅, `tables.manage` action ADR-002 §6'da mevcut

##### Görev 20. PATCH/DELETE /menu/categories (admin-only)
- **Yürütücü:** `implementer` + `security-reviewer`
- **Çıktı:** `apps/api/src/routes/menu.ts` (veya `categories.ts`) PATCH (name/sortOrder), DELETE (soft delete + products cascade kararı)
- **ADR borcu:** Kategori soft delete'in products'a etkisi (ADR-003 mini amendment) — implementer brief'inde net karar gerekir
- **DoD:** 8+ test (4 rol × 2 endpoint), products bağımlılık testi

**Sprint 4 kapanış kriterleri (✅ KAPANDI 2026-04-29):**
- [x] Görev 19, 20 ✅ (PR #40 / #41)
- [x] CI yeşil — gerçek execution doğrulanır (PR #40 + #41 hepsi 2-3 check pass)
- [x] ADR-003 mini amendment (kategori cascade) merged — Amendment 2026-04-28b PR #41
- [x] typecheck + lint + test yeşil (153 test, 27 yeni: PATCH/DELETE × tables + categories)

---

### Phase 2 Sprint 5 — Salon Bölgeleri (Areas) Domain

**Bağlam:** Charter Phase 2'de "salon bölgeleri" UI maddesi var ama domain tanımsız. Önce schema + endpoint, sonra UI Sprint 8c'de.

**Tahmini süre:** 1 hafta

##### Görev 21. ADR-009 — Salon Bölgeleri (Areas) Domain
- **Yürütücü:** `architect` sub-agent
- **Çıktı:** `.claude/memory/decisions.md` ADR-009 — şema kararı (ayrı `areas` tablosu vs `tables.area_label TEXT`), masa-bölge ilişkisi, çoklu salon senaryosu (bahçe/iç/teras), v3 davranış teyidi
- **DoD:** ADR Accepted, cross-ref'ler doğrulanmış (uydurma yasak)

##### Görev 22. Migration 007 — areas tablosu + tables.area_id FK
- **Yürütücü:** `db-migration-guard` review → `implementer`
- **Bağımlılık:** Görev 21 (ADR-009) Accepted
- **Çıktı:** `packages/db/migrations/007_*.sql` (id/tenant_id/name/sort_order/deleted_at/timestamps + composite FK), generated.ts regen
- **DoD:** db-migration-guard 9/9 review, migration up + idempotency, generated.ts diff sadece `Areas` interface

##### Görev 23. /areas REST CRUD (admin-only)
- **Yürütücü:** `implementer` + `security-reviewer`
- **Çıktı:** `apps/api/src/routes/areas.ts` POST/GET/PATCH/DELETE; tables PATCH'e area_id alanı eklenir
- **DoD:** 12+ test (4 endpoint × 4 rol minus admin-only), `areas.manage` action ADR-002 §6 amendment

**Sprint 5 kapanış kriterleri (✅ KAPANDI 2026-04-29):**
- [x] ADR-009 Accepted (PR #43 `02836b7`), Görev 22 + 23 ✅ (PR #44 + #45)
- [x] Migration 007 merged + db-migration-guard PRE-WRITE APPROVED-A
- [x] CI yeşil — gerçek execution doğrulanır (PR #43/44/45 hepsi 2-3 check pass)
- [x] AreaService TEK transaction cascade NULL (ADR-009 Karar 5) + security-reviewer APPROVED
- [x] 22 yeni integration test (153 → 175 yeşil)

---

### Phase 2 Sprint 6 — İşletme Ayarları Endpoint

**Bağlam:** DB tablosu zaten var (000_init.sql `tenant_settings`); sadece endpoint eksik.

**Tahmini süre:** 2-3 gün

##### Görev 24. /settings GET + PATCH ✅
- **Durum:** ✅ Tamamlandı (PR #47 squash `a5052db`, Session 40, 2026-04-28)
- **Yürütücü:** `implementer` + `security-reviewer` APPROVED
- **Kapsam kilidi (Session 40 memory karar):** MVP yalnız `timezone` + `business_day_cutoff_hour` + read-only `tenant.name`. Fiş header / telefon / vergi no / KDV oranları / `tenant.name` PATCH → **v5.1 backlog** (migration 008 yazılmadı, mevcut `tenant_settings` şeması yeterli — 000_init.sql:128-143).
- **Çıktı:**
  - `apps/api/src/routes/settings.ts` — GET (admin/cashier read) + PATCH (admin only) + TEK transaction UPDATE+writeAudit
  - `packages/db/src/repositories/tenant-settings.ts` — findByTenantId (tenants JOIN) + update + mapPgError (validate_timezone trigger → SETTINGS_INVALID_TIMEZONE)
  - `packages/shared-types/src/settings.ts` — TenantSettingsSchema + TenantSettingsUpdateSchema (zod regex IANA tz + 0-23 cutoff refine)
  - `apps/api/src/__tests__/settings.test.ts` — 16 integration test (4 rol × 2 endpoint matrisi + tz validation + cutoff range + atomicity + i18n key)
- **ADR amendments:**
  - ADR-002 §6 — `tenant.settings.read` action (admin + cashier read split, write `tenant.settings` admin-only kaldı)
  - ADR-006 §5.2 — `SETTINGS_NOT_FOUND` (404 defansif), `SETTINGS_INVALID_TIMEZONE` (400, DB trigger çift savunma)

**Sprint 6 kapanış kriterleri (✅ KAPANDI 2026-04-28 Session 40):**
- [x] Görev 24 ✅ (PR #47, 16 yeni test 175→191)
- [x] CI yeşil — gerçek execution doğrulandı (ci 1m43s + migration-check pass)
- [x] security-reviewer APPROVED (11 özel kontrol, 0 BLOCKER, 1 CONCERN-B rate-limit follow-up)

---

### Phase 2 Sprint 7 — Socket.IO Realtime Altyapısı

**Bağlam:** Charter Phase 2 madde 2. Phase 3 KDS ve Phase 4 mobil buna bağlı, geç bırakılamaz.

**Tahmini süre:** 1 hafta

##### Görev 25. ADR-010 — Socket.IO Realtime Stratejisi
- **Yürütücü:** `architect` sub-agent
- **Çıktı:** ADR-010 — transport (WebSocket + polling fallback), JWT auth handshake, room/namespace stratejisi (per-tenant + per-role), reconnect davranışı, scale notu (MVP single instance, horizontal scale Redis adapter Phase 4+), error event envelope (ADR-006 §13 forward-ref kapatılır)
- **DoD:** ADR Accepted

##### Görev 26. Socket.IO server kurulumu
- **Yürütücü:** `implementer` + `security-reviewer` (auth handshake)
- **Çıktı:** `apps/api/src/realtime/` server kurulumu + auth middleware + room join (tenant + role)
- **DoD:** 4+ integration test (handshake auth, room scope, reconnect, unauthorized reject)

##### Görev 27. shared-types realtime event şemaları
- **Yürütücü:** `implementer`
- **Çıktı:** `packages/shared-types/src/realtime.ts` event payload zod şemaları (orders.created, tables.statusChanged — Phase 3 KDS için iskelet)
- **DoD:** typecheck temiz, schema export

**Sprint 7 kapanış kriterleri (✅ KAPANDI 2026-04-29 Session 41):**
- [x] ADR-010 Accepted (PR #49 squash `08b0402`, 10 karar + ADR-006 §8 forward-ref kapatıldı)
- [x] Görev 26 + 27 ✅ (PR #50 squash `8382166`, 9 dosya, 12 yeni test 191→203)
- [x] CI yeşil — gerçek execution doğrulandı (PR #49 CI 47s, PR #50 CI 1m22s + migration-check pass)
- [x] security-reviewer APPROVED-A → 2 CONCERN-A çözüldü (A1 emitToSocket helper + ESLint socket.emit selector, A2 atomik check+increment middleware'de)
- [x] Manuel smoke (test-fixture'la): handshake auth (geçerli + token yok + invalid + expired) + room scope (cross-tenant isolation) + reconnect (manuel disconnect → fresh token) — 12/12 yeşil
- [x] NPM dep: socket.io ^4.7 + socket.io-client ^4.7 (devDep). Redis adapter Phase 4+ rezervde (ADR-010 §5.3)

---

### Phase 2 Sprint 8a — Web UI Altyapı + Login + Dashboard

**Bağlam:** Charter Phase 2 madde 3'ün başlangıcı. ADR-011 web UI tasarım kuralları + ilk 2 ekran. Mobile için ayrı ADR (Phase 4'te).

**Tahmini süre:** 1.5 hafta

##### Görev 28. ADR-011 — Web UI Tasarım Kuralları
- **Yürütücü:** `architect` + `hci-reviewer` pre-review
- **Çıktı:** ADR-011 — component library (shadcn vs Headless UI vs Radix), Tailwind tema (POS dark mode + dokunmatik hedef boyut), state management (React Query + Zustand vs Redux Toolkit), form validation (react-hook-form + zod), routing (React Router), i18n entegrasyonu, HCI checklist atfı
- **DoD:** ADR Accepted, hci-reviewer pre-review notu

##### Görev 29. Login Ekranı
- **Yürütücü:** `implementer` + `hci-reviewer` + `turkish-ux-reviewer`
- **Çıktı:** `apps/web/src/routes/login` form + JWT cookie handling + error envelope → Türkçe i18n çeviri
- **DoD:** HCI checklist + Playwright unit smoke + Türkçe metin disiplini

##### Görev 30. Ana Sayfa (Kasiyer Dashboard)
- **Yürütücü:** `implementer` + `hci-reviewer` + `turkish-ux-reviewer`
- **Çıktı:** Kasiyer rolüne göre kart layout (aktif sipariş sayısı, masa doluluk, günlük ciro placeholder). **Müdür raporları Phase 3+** (kapsam dışı). Phase 3'te raporlar bağlanır.
- **DoD:** HCI checklist + Türkçe i18n + admin/cashier role view

**Sprint 8a kapanış kriterleri:**
- [ ] ADR-011 Accepted, Görev 29 + 30 ✅
- [ ] hci-reviewer ✅ + turkish-ux-reviewer ✅

---

### Phase 2 Sprint 8b — Web UI Masa Yönetimi

**Bağlam:** En kritik UI — yoğun saat iş akışı (HCI öncelik).

**Tahmini süre:** 1.5 hafta

##### Görev 31. Masa Grid Ekranı
- **Yürütücü:** `implementer` + `hci-reviewer` + `turkish-ux-reviewer`
- **Çıktı:** Tüm masalar status renk kodu (available/occupied/cleaning), area filter, masa tıkla → adisyon detay placeholder. **Realtime:** Socket.IO `tables.statusChanged` subscribe (Sprint 7 altyapısı)
- **DoD:** HCI + Türkçe + realtime smoke (manuel)

##### Görev 32. Masa CRUD Admin Paneli
- **Yürütücü:** `implementer` + `hci-reviewer` + `turkish-ux-reviewer`
- **Çıktı:** Yeni masa, düzenle, sil. Soft delete confirm modal + Türkçe metin
- **DoD:** HCI + Türkçe + Sprint 4 endpoint'leri kullanır

**Sprint 8b kapanış kriterleri:**
- [ ] Görev 31 + 32 ✅
- [ ] hci-reviewer ✅ + turkish-ux-reviewer ✅

---

### Phase 2 Sprint 8c — Web UI Tanımlamalar (Sidebar + Areas + Menü + Özellikler)

**Bağlam:** Admin ekranları. Sprint 5 (areas) + Sprint 4 (categories CRUD) + Sprint 3b (products/variants) endpoint'lerini kullanır. **ADR-012 (2026-04-30 Accepted)** ile "Özellikler" v3 paritesi reusable attribute groups domain'i olarak yeniden tanımlandı; Migration 006 (`product_variants`) **superseded**.

**Tahmini süre:** ~3 hafta (ADR-012 ile +1.5 hafta).

#### Tamamlanmış (Session 45-46)
- ✅ **PR-A** (Session 45, PR #61) — Sidebar V3 paritesi, Tanımlamalar parent + 3 placeholder
- ✅ **PR-B** (Session 45, PR #61) — Salon Bölgeleri admin sayfası (DiningAreasPage + CRUD + AreaCard)
- ✅ **PR-1** (Session 45, PR #59) — `area_id` exposure on GET /tables
- ✅ **PR-C** (Session 46, PR #63) — `POST /areas/:id/sync-tables` + UI "Uygula" butonu aktive (ADR-009 Amendment 2026-04-30)

#### Kalan görevler

##### Görev 33. Menü Tanımları sayfası (PR-D + PR-E)
- **PR-D:** Kategori paneli (sol sütun) — V3 paritesi (`MenuDefinitionsPage`). CRUD: ekle/düzenle/sil/sıralama.
- **PR-E:** Ürün grid (sağ panel) — Kategoriye filtreli ürün CRUD.
- **NOT:** `product_variants` (ADR-003 §8.6) **superseded by ADR-012** — bu sayfada **variant editör YOK**. PR-F3a'da ürün atama UI'sı bu sayfaya entegre edilir.
- **Yürütücü:** `implementer` + `hci-reviewer` + `turkish-ux-reviewer`
- **DoD:** HCI + Türkçe + V3 ekran paritesi

##### Görev 34. Özellikler — Attribute Groups Domain (PR-F1 + PR-F2 + PR-F3)
- **ADR:** ADR-012 (Accepted 2026-04-30) — 13 karar + 3 İlhan onayı (cap ±100 TL, idempotent assign 200 OK, snapshot MVP).

**PR-F1 — Backend Domain (ADR amendments + 4 migration + CRUD):**
- 4 migration: `008_attribute_groups`, `009_attribute_options`, `010_category_attribute_groups`, `011_product_attribute_groups`.
- ADR-002 §6 amendment: `attributes.read` (4 rol) + `attributes.manage` (admin).
- ADR-003 §8.6 "Superseded by ADR-012" notu (DROP migration v5.1 borç).
- ADR-006 §5 error code registry: 5 yeni kod.
- `packages/shared-types`: zod schemas.
- `apps/api/src/domain/attributes/`: 3 service (transaction cascade).
- `apps/api/src/routes/attribute-groups.ts`: 14 endpoint (idempotent assign 200 OK).
- **Yürütücü:** `db-migration-guard` (4 migration PRE-WRITE) → `implementer` + `security-reviewer`.

**PR-F2 — Admin UI (Özellikler sayfası, V3 paritesi):**
- `apps/web/src/features/admin/AttributeGroupsPage.tsx` — V3 `AttributeGroupsPage.jsx` paritesi.
- Drawer/Dialog edit (group + options inline, 3-way sync save).
- Sidebar "Özellikler" placeholder aktif.
- **Yürütücü:** `implementer` + `hci-reviewer` + `turkish-ux-reviewer`.

**PR-F3 — Ürün atama + snapshot:**
- **F3a (Sprint 8c):** Ürün atama UI — Menü Tanımları sayfasına "Atanmış Özellik Grupları" bölümü.
- **F3b (Sprint 8c):** Migration 012 — `order_item_attributes` snapshot tablosu.
- **F3c (Phase 3):** `AttributePickerModal` sipariş ekranında.

**Sprint 8c kapanış kriterleri:**
- [x] PR-A, PR-B, PR-1, PR-C ✅
- [x] ADR-012 Accepted ✅ (2026-04-30)
- [ ] Görev 33 (PR-D + PR-E) ✅
- [ ] Görev 34 (PR-F1 + PR-F2 + PR-F3a/b) ✅
- [ ] hci-reviewer ✅ + turkish-ux-reviewer ✅
- [ ] PR-F3c sözleşmesi Phase 3 charter'a eklenmiş

---

### Phase 2 Sprint 8d — Web UI Kullanıcı Yönetimi + İşletme Ayarları

**Bağlam:** Son 2 ekran. Sprint 3b (users) + Sprint 6 (settings) endpoint'lerini kullanır.

**Tahmini süre:** 1 hafta

##### Görev 35. Kullanıcı Yönetimi
- **Yürütücü:** `implementer` + `hci-reviewer` + `turkish-ux-reviewer`
- **Çıktı:** CRUD admin, son admin guard 409 → Türkçe error mesajı, password change (kendi şifresi)
- **DoD:** HCI + Türkçe + ADR-002 §10 lifecycle UI gösterim

##### Görev 36. İşletme Ayarları Formu
- **Yürütücü:** `implementer` + `hci-reviewer` + `turkish-ux-reviewer`
- **Çıktı:** KDV, restoran bilgileri, fiş header, business cutoff hour
- **DoD:** HCI + Türkçe + Sprint 6 endpoint kullanır

**Sprint 8d kapanış kriterleri:**
- [ ] Görev 35 + 36 ✅
- [ ] hci-reviewer ✅ + turkish-ux-reviewer ✅

---

### Phase 2 Sprint 9 — E2E Playwright Smoke Suite (✅ KAPANDI 2026-05-08, PR #108)

**Bağlam:** Charter Phase 2 madde 4 — exit kriteri (alt-kriter karşılandı).

**ADR:** [ADR-019 E2E Smoke Suite Stratejisi](../memory/decisions.md#adr-019) Accepted (Chromium-only + worker 1 + kysely direct seed + storageState + postgres service container reuse + visual regression Sprint 10+).

**Sprint 9 kapanış kriterleri:**
- [x] **Görev 37 ✅** — Playwright kurulumu (config + fixtures + global-setup + CI workflow)
- [x] **Görev 38 (S1) ✅** — Login → dashboard senaryosu (CI yeşil)
- [⏭] **Görev 38 (S2-S5)** — **Sprint 9b'ye ertelendi** (ADR-019 §1 amendment 2 2026-05-08); qa-engineer subagent locator'ları lokal UI keşfi olmadan yazmıştı, gerçek DOM uyuşmuyor — `pos_e2e` DB kurulumu + Playwright UI mode + Inspector ile yeniden yazılır
- [x] CI E2E workflow yeşil (Playwright Smoke Chromium 1m44s + ci 1m4s)
- [x] PR #108 squash merged (`ec0f3ff`)

**4 fix CI iterasyonu:**
- `b0e7a7a` Build workspace packages step (shared-types/domain/db dist fresh CI'da yok)
- `083e080` ESM globalSetup string path (`require.resolve` yok)
- `5d21346` vite.config preview.proxy (server.proxy dev-only)
- `bbbe945` + `777db9e` S5 spec saf scope + S2-S5 spec sil

**Tahmini süre:** 1 hafta (gerçek: 1 oturum + 4 CI fix iterasyonu, S2-S5 Sprint 9b'ye ertelendi)

##### Görev 37. Playwright Kurulumu (✅ tamamlandı)
- **Yürütücü:** `qa-engineer` + `implementer`
- **Çıktı:** `apps/web/e2e/` config, fixtures (seed kysely direct + auth.setup storageState), CI integration (`.github/workflows/e2e.yml`), postgres test container reuse (ADR-001 §6.1)
- **DoD:** CI yeşil ✅; visual regression Sprint 10+ (ADR-019 §6 — `toHaveScreenshot` kapalı)

##### Görev 38. Smoke Senaryosu (S1 ✅, S2-S5 → Sprint 9b)
- **Yürütücü:** `qa-engineer`
- **Çıktı:**
  1. ✅ **S1** — Login → dashboard (CI yeşil)
  2. ⏭️ S2 — Admin bölge oluştur → masa sync → bölge düzenle → bölge sil (ADR-019 §1 amendment 2026-05-08, v3 paritesi)
  3. ⏭️ S3 — Menü editörü kategori + ürün + variant CRUD
  4. ⏭️ S4 — Admin kullanıcı oluştur → hard delete → login fail (ADR-009 amendment 2026-05-05)
  5. ⏭️ S5 — İşletme ayarları timezone güncelle (KDV v5.1 backlog, ADR-019 §1 amendment)
- **DoD (S1):** ✅ S1 yeşil + CI'da bloklayıcı + baseline screenshot kapalı (Sprint 10+)
- **DoD (S2-S5):** Sprint 9b'de kapanır (lokal UI keşfi gerektirir)

### Phase 2 Sprint 9b — S2-S5 Smoke Senaryolar (✅ KAPANDI 2026-05-10)

**Bağlam:** Sprint 9 (PR #108) S2-S5 senaryolarının locator'ları lokal UI keşfi olmadan yazıldı, gerçek DOM uyuşmadı (9/9 fail 30s timeout). Bu sprint S2-S5'i gerçek TSX kaynak inceleme + tr.json metin eşleştirmesi ile yeniden yazdı.

**Yaklaşım (lokal `pos_e2e` DB yerine):** ADR-019 Amendment 3 (2026-05-10) UI login per test + scope-aware native click pattern; lokal Playwright Inspector yerine TSX kaynak inceleme + CI diagnostic (response body log) — root cause iterasyonu önemli ölçüde kısalttı.

**Tahmini süre:** 2-3 gün (gerçek: 1 oturum, 4 PR + ADR amendments)

##### Görev 38b. S2-S5 Locator Düzeltme + Spec Yeniden Yazım (✅ DONE)
- **Yürütücü:** main context (sub-agent yerine, Sprint 9 öğretisi)
- **Çıktılar:**
  - **PR-A** (PR #121, `62596a6`): ADR-019 Amendment 3 (Zustand persist drift → UI login per test) + `loginViaUI` + `spaNavigate` + `clickButtonByText` helper'lar + S5 (settings timezone)
  - **PR-B** (PR #122, `d18bbd2`): S2 (bölge CRUD) + scope-aware helper'lar (`clickButtonInScope`, `clickButtonInScopeByAriaLabel`) + AreaCard `data-testid` + root cause analizi (CI diagnostic ile)
  - **PR-C** (PR #123, `7972800`): ADR-019 Amendment 4 (S3 scope kategori CRUD only; ürün/variant Sprint 10+ smoke) + S3 (menü kategori) + `openRadixDropdown` helper (manuel pointerdown dispatch) + CategoryListItem `data-testid` + `clickMenuItemByText`
  - **PR-D** (PR #124, `3e71be3`): S4 (kullanıcı CRUD + login fail 401) + UsersPage row `data-testid`
- **DoD:** S2-S5 + S6 yeşil ✅ + ADR-019 §1 5/5 senaryo lock'u tam ✅ → Phase 2 mührü atılır ✅
- **Önemli ders:** Multi-item liste sayfalarında scope-aware click ZORUNLU (seed'den gelen item'larla karışmasın). Memory: `feedback_e2e_scope_aware_native_click.md`. Radix DropdownMenu için `pointerdown + pointerup + click` manual dispatch gerekli (force:true skips pointer events).

**Sprint 9b kapanış (2026-05-10):**
- [x] S1 ✅ (PR #108 Sprint 9'dan beri)
- [x] S2 ✅ (PR #122)
- [x] S3 ✅ (PR #123, daraltılmış kategori CRUD scope; ürün/variant Sprint 10+)
- [x] S4 ✅ (PR #124)
- [x] S5 ✅ (PR #121)
- [x] S6 ✅ (PR #119 Sprint 12'den, KDS smoke)
- [x] ADR-019 Amendment 3 (auth pattern UI login)
- [x] ADR-019 Amendment 4 (S3 scope dar smoke)
- [x] CI yeşil (Playwright Smoke + ci jobs hepsi pass)
- [x] **Phase 2 EXIT KRİTERİ KARŞILANDI** — `Phase 2 ✅ KAPANDI 2026-05-10`

### Phase 3 Sprint 12 — KDS UI + Kitchen Routing (ADR-020)

**Bağlam:** Charter Phase 3 ilk sprint'i. ADR-020 (Accepted 2026-05-08) — KDS UI + kitchen routing kararları kilitli (12 karar, 5 çözülmüş soru). Backend hazır: ADR-014 §8 mutfak ticket print + Migration 020 `order_items.status` enum + ADR-010 `tenant:N:role:kitchen` Socket.IO room.

**Kapsam kilidi (ADR-020):**
- ❌ Multi-station kitchen routing (v5.1 backlog)
- ❌ Sound notification (v5.1 backlog)
- ❌ Ürün-bazlı kitchen tag (kategori-level `kitchen_print` MVP)
- ❌ Kategori bazlı bekleme eşikleri (sabit 5/10dk MVP)
- ❌ Order-level toplu "Hazır" butonu (kalem-bazlı MVP)
- ❌ Admin KDS erişimi (kitchen-only MVP)

**Tahmini süre:** 1.5-2 hafta (6 görev)

##### Görev 39. ABAC + Permission (ADR-008 §4.2 rezerv kapanışı)
- **Yürütücü:** `implementer`
- **Çıktı:** `permissions.ts` (`kds.read`, `kds.itemStatusUpdate` action) + `permissions.test.ts` 4-rol matrix güncelleme + ADR-008 §4.2 amendment (rezerv → karar)
- **DoD:** kitchen + admin için iki action allow; cashier/waiter deny; matrix testi yeşil

##### Görev 40. Backend: GET /kds/orders + PATCH /orders/:orderId/items/:itemId/status
- **Yürütücü:** `implementer` + `qa-engineer`
- **Çıktı:**
  - `GET /kds/orders`: aktif (`sent|preparing|ready`) order'ları nested kalemler ile döner; FIFO; `kitchen_print=true` kategori filtresi
  - `PATCH /orders/:orderId/items/:itemId/status`: body `{ status: 'preparing'|'ready' }`, idempotent (aynı status 200 no-op), audit `event_type='order_item.status_changed'`, ABAC kitchen+admin
  - POST /orders Kaydet hook: `kitchen_print=true` kalemler `'sent'` set + `kitchen.orderSent` Socket.IO emit
- **DoD:** 8+ integration test (happy path, idempotent, RBAC, multi-tenant, kategori filtresi, audit, realtime smoke)

##### Görev 41. Web UI: /kds Sayfa
- **Yürütücü:** `implementer` + `hci-reviewer` + `turkish-ux-reviewer`
- **Çıktı:**
  - `/kds` route (`App.tsx`), kitchen+admin guard
  - `KdsPage.tsx` full-screen layout, 3-4 kolon kart grid (auto-flow)
  - `KdsOrderCard.tsx` masa/paket etiket + bekleme süresi (mm:ss live counter) + kalem listesi + 2 buton (Hazırlanıyor, Hazır)
  - Border state: `--neutral` (0-5dk) → `--warn` (5-10dk) → `--danger` (>10dk)
  - Sidebar "Mutfak" link (kitchen+admin only)
  - i18n key'ler: `kds.title`, `kds.empty`, `kds.button.preparing`, `kds.button.ready`, `kds.timer.minutes`
- **DoD:** HCI checklist (rush-hour, Fitts 64×64 buton, renk-bağımsız status) + Türkçe metinler i18n + 0 hardcoded string

##### Görev 42. Realtime Client (web)
- **Yürütücü:** `implementer`
- **Çıktı:** `useKitchenRealtime` hook (`tenant:N:role:kitchen` room subscribe, reconnect REST refetch — ADR-010 §5.2 pattern), `kitchen.orderSent` ve `kitchen.itemStatusChanged` event handler'lar (React Query cache invalidate)
- **DoD:** disconnect/reconnect smoke (manuel test): yeni sipariş push edilir + KDS auto-refresh; reconnect sonrası REST cold start

##### Görev 43. Integration + Smoke Test
- **Yürütücü:** `qa-engineer`
- **Çıktı:**
  - Görev 40 backend integration testleri (Görev 40 DoD'da listelendi)
  - E2E smoke S6 (Sprint 9b kapsamına eklenir): order kaydet → KDS'te `sent` görün → "Hazırlanıyor" → "Hazır" → masa ekranı işaret
- **DoD:** S6 yeşil + backend test 8+ yeşil

##### Görev 44. v3 Davranış Notu (READ-ONLY)
- **Yürütücü:** `implementer` (kısa)
- **Çıktı:** `D:\dev\restoran-pos-v3\client\src\components\kitchen\` veya muadili READ-ONLY incele, `docs/v3-reference/kds-behavior.md` (≤200 kelime özet — kart layout, status butonları, sıralama, ses davranışı v3'te varsa not düş). Kod kopyalama yasak.
- **DoD:** Doc dosyası mevcut + v5 implementasyonuyla farklar net

**Sprint 12 kapanış kriterleri (✅ KAPANDI 2026-05-09):**
- [x] Görev 39 ABAC permissions (PR #111) ✅
- [x] Görev 40a Migration 034 (PR #112) ✅
- [x] Görev 40b GET /kds/orders (PR #113) ✅
- [x] Görev 40c PATCH item status + takeaway hook (PR #114) ✅
- [x] Görev 40d/40e Tests + dine_in hook + io wiring (PR #115) ✅
- [x] Görev 41 Web UI /kds + 42 useKitchenRealtime (PR #118) ✅
- [x] Görev 43 Smoke S6 (PR #119) ✅
- [x] Görev 44 v3 davranış notu (PR #117) ✅
- [x] Backend 9 integration test yeşil (`kds.test.ts` 342/342)
- [x] Web UI HCI + Turkish UX + i18n gate (3 review, 3 FIX uygulandı)
- [x] CI yeşil (typecheck + lint + unit + integration + Playwright)
- [x] Bonus: prod io wiring fix (PR #116) — PR-2c'den beri kırık emit, ADR-020 K12 prod'da çalışmaya başladı
- [x] Manuel UI smoke S6 E2E ile otomatize: kitchen login → /kds → Hazırlanıyor → Hazır → status='ready'
- [x] PR'lar: 4 (PR-1 + PR-2a + PR-2b + PR-2c + PR-2d + PR-3a + PR-3b + PR-3c + PR-3d = 9 toplam)

### Phase 2 Sprint 10 — PR-8 Caller ID + Müşteri Yönetimi (ADR-016)

**Bağlam:** ADR-016 (Accepted, 2026-05-03). v3 paritesi caller ID + müşteri domain'i + .NET Caller Bridge.

**Sprint 10 kapanış kriterleri (✅ KAPANDI 2026-05-04, PR #99 + #100):**
- [x] **PR-8a** — Migration 027 + shared-types (customers, call-logs, bridge) + `phone.ts` helper + unit testleri (commit `ba3ba5d`)
- [x] **PR-8b** — Backend: `POST /bridge/caller-id/incoming` + Socket.IO emit + bypass + 13 endpoint + repo katmanı (commits `263bf2c`, `6bd80c0`, `828bfd7`)
- [x] **PR-8c** — Frontend: `IncomingCallProvider` + `IncomingCallPopup` + `CustomersPage` + `CustomerDetailPage` + Import/Export drawer (commits `08dfbcd`, `ab9228f`, `d3affbc`, `768549c`, `181d8f8`); ham telefon log yok ✅; blacklist kırmızı bg ✅
- [x] **PR-8d** — `apps/caller-bridge/` .NET 8 Worker Service + CIDShow C812A wrapper + appsettings (PR #100, commit `8e3e24b`)
- [x] **PR-8e** — Retention cron job (`call_logs` 30 gün + `audit_logs` 2 yıl) (commit `6a49204`)
- [~] **PR-8f** — V3 Excel/SQLite müşteri import CLI → **v5.1 backlog'a ertelendi** (aşağıda); `apps/api/scripts/import-v3-customers.ts` ad-hoc çözüm olarak kaldı, ama Sprint 10 kapsamı dışında ürünleştirilmiş CLI v5.1
- [x] PR #99 (PR-8a/b/c/e) merged 2026-05-04 (`d25a033`)
- [x] PR #100 (PR-8d) merged 2026-05-04 (`8e3e24b`)

**Sprint 10 sonrası açık eksikler (sprint kapanış denetimi 2026-05-04):**
- [x] **Test coverage** — PR #101 ile kapatıldı (19/19 backend integration + RBAC + multi-tenant + bypass + UNIQUE)
- [x] **DoD** — PR #101 (HCI + Turkish UX + integration tests + CHANGELOG)

---

### Phase 2 Sprint 11 — Paket Sipariş Akışı (ADR-017 + ADR-018)

**Bağlam:** ADR-017 (Accepted 2026-05-04, decisions.md L7256+) + ADR-018 (Accepted 2026-05-04, L7517+) — paket sipariş akışı, sipariş ekranı birleştirme. v3 paritesi.

**Sprint 11 kapanış kriterleri (kısmi ✅ — yarın kapatılacak, branch `feat/takeaway-flow`):**
- [x] **Backend** — Migration 028 takeaway_stage + planned_payment_type + delivery_address_snapshot + 2 CHECK + partial index (`5e87947`)
- [x] **Backend bug fix** — Migration 029 store_date trigger smallint cast (Migration 026'dan beri kırık production bug — orders insert tüm test ortamlarında 500) (`de6198a`)
- [x] **Backend repo + routes** — POST/GET/PATCH /orders takeaway endpoint'leri, audit, Socket.IO emit (`8cfd75c`, `4731f06`)
- [x] **Backend test** — 15/15 integration (POST happy + UNIQUE + RBAC + multi-tenant + stage transitions + delivered atomic payment + cancel)
- [x] **Frontend takeaway batch 1+2** — CustomerPickerModal, PaymentMethodModal, OpenTakeawayOrdersPanel, TakeawayOrderCard (v3 paritesi: gradient bg, sol şerit, 3-nokta menü Yazdır+İptal), api hooks, useOrderCart, i18n (`d92e220`, `66ef470`)
- [x] **Ekran birleştirme (ADR-018)** — `OrderScreenPage` paket+masa unified, orderType discriminator, route `/orders/new?type=takeaway` ve `/tables/:tableId/order` aynı component (`ee961a5`, `7c38589`)
- [x] **created_by_user_id + name** — paket items'a yazılır, AdisyonPanel'de turuncu chip parite (`cd10f1f`)
- [x] **AdisyonPanel v3-parity styling** — font/spacing/color (`1eb2375`)
- [x] **Card click** → mevcut paket siparişi düzenleme moduyla aç (`83092ef`)
- [x] **Printer ikonu** — accent renk fix (`388501f`)

**Yarın bitirilecek (WIP commit `e3ad77c`):**
- [ ] **PATCH /orders/:id/customer endpoint** — mevcut siparişe sonradan müşteri ata (admin/cashier RBAC, audit `order.customer_assigned`, Socket emit, 3+ test). `order_type` DEĞİŞMEZ (CHECK constraint izin veriyor: dine_in customer_id nullable).
- [ ] **Frontend assign mutation** — `useAssignCustomer` hook + OrderScreenPage Person icon → modal → mutation (mevcut sipariş için)
- [ ] **`order.customer.assignOnlyOnNew` toast'ı kaldır** — yerine gerçek PATCH ile mevcut siparişe atama
- [ ] **Geri butonu tıklama alanı** — header sol bölge tek tıklanabilir alan (geri ok + başlık + altyazı + aralarındaki boşluk dahil)
- [ ] **Default kategori** — açılışta "Tümü" yerine ilk gerçek kategori seçili (kısmen yapıldı; doğrulama gerek)
- [ ] **Sidebar header layout fix** — sol üstte turuncu logo sızıntı/çentik kaldırılacak, "Restoran POS" + X close hizalama (`apps/web/src/components/Sidebar.tsx`)
- [ ] **PR açma + merge** — `feat/takeaway-flow` → `main` (PR #102 hedef)
- [ ] **Frontend RTL test** — TakeawayOrderCard 3-nokta menü, CustomerPickerModal, PaymentMethodModal (Sprint 11 DoD)
- [ ] **CHANGELOG Session 53 entry** — yarınki kapanış sonrası

**Sprint 9 kapanış kriterleri:**
- [ ] Görev 37 + 38 ✅
- [ ] CI E2E job yeşil

---

### Phase 2 Exit Kriterleri (✅ MÜHÜRLENDİ 2026-05-10)

Sprint 9 + 9b sonunda:
- [x] Tüm REST endpoint'ler tam CRUD: auth, users, menu/categories, tables, areas, products/variants, settings (Sprint 1-6, 3b) — kümülatif PR'lar
- [x] Socket.IO altyapısı çalışıyor: handshake auth + room scope + reconnect (Sprint 7 PR #50) + Sprint 12 PR-3a prod io wiring fix (PR #116)
- [x] 7 Web UI ekranı çalışıyor: login, dashboard, masalar, menü editörü, kullanıcılar, salon bölgeleri, ayarlar (Sprint 8a-d) + bonus mutfak ekranı (Sprint 12 KDS PR #118)
- [x] HCI checklist tüm UI'larda ✅ (`hci-reviewer` onayı, Sprint 12 KDS dahil)
- [x] Türkçe metin disiplini ✅ (`turkish-ux-reviewer` + `i18n-key-checker` onayı, 0 hardcoded string)
- [x] Playwright smoke suite 5/5 yeşil + CI'da çalışıyor (Sprint 9 S1 + Sprint 9b S2-S5) + bonus S6 KDS (Sprint 12)
- [x] ADR-009 (areas), ADR-010 (Socket.IO), ADR-011 (Web UI), ADR-019 (E2E), ADR-020 (KDS) hepsi Accepted
- [x] CI yeşil (lint + typecheck + unit + integration + E2E Playwright)
- [x] Manuel UI smoke: Sprint 9b S2-S5 ve Sprint 12 S6 ile otomatize edildi (manuel adımlara gerek azaldı)

**Phase 2 EXIT MÜHRÜ:** 2026-05-10 (Sprint 9b kapanışı, ADR-019 §1 5/5 senaryo lock'u + Phase 3 KDS bonus ile).

**Tahmini takvim:** ~10 hafta. Charter Phase 2 hedef 5 hafta — gerçek sapma 2× (Sprint 3a/3b retrospektif "takvim gerçekçilik" dersi referansı). Charter total 23 hafta hedef sabit kalır; sapma `docs/retrospectives/` belgelerinde görünür.

---

**Erteleme kabul (Sprint 0 dışı, Phase 2 içinde uygun yerde):**
- Genel API rate limiter (sadece login'de var, diğer mutating endpoint'lerde Phase 2 ortasında)
- ~~Socket.IO altyapısı~~ → **Sprint 7 (yukarıda)**
- Daily-closeout ADR (Phase 4 implementasyonu yakınında)
- KVKK veri haritası (prod öncesi şart, MVP'de değil)
- PITR ADR (Phase 4)

### Açık sorular

1. **KDV oranları (Görev 10)**: ✅ **Karar (2026-04-25)**: Sabit %10/%20, v3 ile aynı. `shared-domain/tax.ts` içinde kategori bazlı sabit mapping. Tenant-config v5.1.

2. **Seed şifresi (Görev 13)**: ✅ **Karar (2026-04-25)**: Sabit `admin1234` dev ortamı için kabul edildi. Seed dosyasında comment ile "prod'a gitmez" açıkça belirtilecek. `NODE_ENV !== 'production'` guard zorunlu.

### Phase 0 tamamlananlar (arşiv özeti)

Phase 0 (8 görev, 2 hafta, 2026-04-22 → 2026-04-25) tamamlandı. Görev 1 charter onayı (`72e00c5`), görev 2 v3-reference 5 dosya (`modules.md`, `domain-rules.md`, `printer-notes.md`, `data-model.md`, `pain-points.md`), görev 3-5 üç ADR (ADR-001 monorepo + ADR-002 auth + ADR-003 DB şema, hepsi Accepted), görev 6 monorepo iskeleti + CI (`98f4563`), görev 7 docker-compose + kysely-codegen 17 tablo (`6fb7299`), görev 8 hello endpoint (`043e225` + `f6a26dd`). 14 tablo + 7 enum + 4 DB rolü + AuditSanitizer kontratı + birleşik cron + RTR token modeli kararlaştırıldı. Detaylı session log'ları için: `.claude/memory/scratchpad.md` ve git log.

### Phase 1 exit kriterleri

Hafta 4 sonunda:
- [x] Görevler 9-13 hepsi ✅ (DoD checklist'leri tam) — Görev 13 dahil, smoke 6/6 yeşil (commit `6d181e6`)
- [x] `packages/shared-types` build çıktısı tüm app'lerce import edilebilir (Görev 9 DoD)
- [x] `packages/shared-domain` test coverage ≥ %85 (statements + branches) (Görev 10 DoD)
- [x] `packages/db` repo katmanı (users, refresh_tokens, tables) integration test yeşil (Görev 11 — `DATABASE_URL` yoksa skip; `db-migration-guard` review tamam)
- [x] `apps/api` auth endpoint'leri (login/refresh/logout/me) çalışıyor + security-reviewer ✅ (Görev 12, commit `e3c4a7f`)
- [x] Seed script çalışıyor, dev ortamı `pnpm install` → seed → login akışı dokümante (Görev 13 — `seed.ts` + `docs/engineering/local-dev.md`)
- [x] CI yeşil — `6d181e6` push sonrası GitHub Actions: CI workflow ✅ (run 24938360853, 38s) + Migration Check ✅ (run 24938360868, 42s)
- [x] ADR-004 (Print Agent Mimarisi) **Draft** statüsünde başlatıldı — `.claude/memory/decisions.md` Session 24 (2026-04-25) Draft eklendi (architect sub-agent). Phase 2 başında architect Accepted'a çevirecek.

**Görev 13 yerel test durumu (Session 24, fresh DB):**
- ✅ `pnpm --filter @restoran-pos/db typecheck` temiz (0 hata)
- ✅ Guard: `NODE_ENV=production pnpm seed` → exit 1, `[seed] blocked: NODE_ENV=production and ALLOW_SEED!==true`
- ✅ Live seed: 1. çalışma `tenants:1, settings:1, users:1, tables:5, cats:3, products:5 inserted` — DB row counts doğrulandı
- ✅ Idempotency: 2. çalışma tüm sayaçlar `0 inserted`
- ✅ Smoke 6/6: login (200, accessToken + cookie) → me (200, tenantId UUID v7) → refresh (200, **token rotated**) → me (200) → logout (200) → refresh-after-logout (401 `AUTH_REFRESH_INVALID`)

### Phase 2'ye geçiş şartı

Phase 1 exit kriterleri **tamamen ✅** olmadan Phase 2'ye girilmez. Phase 2 kapsamı: Sipariş + Masa + Menü domain implementasyonu + web UI ekranları (kasiyer/garson temel akışlar). Phase 2 başında ADR-004 (Print Agent) Accepted edilir.

---

## ADR İzleme

**Phase 0'da kabul edilenler:**
- ADR-001 — Monorepo yapısı + paket isimlendirme (Accepted, 2026-04-25)
- ADR-002 — Auth stratejisi (JWT + RTR + role matrix) (Accepted, 2026-04-25)
- ADR-003 — DB şema ilkeleri (UUID v7 / TIMESTAMPTZ / tenant_id / soft delete / audit / migration) (Accepted, 2026-04-25)

**Phase 2 başında Accepted'a alındı:**
- **ADR-004 — Print Agent Mimarisi** (Accepted, 2026-04-25 Session 25, Phase 2 başı gate): Draft (Session 24) → Accepted. `architect` sub-agent 8 açık soruyu kullanıcı öncelik hiyerarşisine + kapsam kilidine uygun yanıtladı. Kararlar: HTTP long-polling **5sn sabit** transport, MSI installer + `nssm` Windows servisi (`@vercel/pkg` + WiX), MVP yalnız mutfak fişi şablonu (müşteri fişi v5.1 backlog, X/Z Phase 5+ backlog), MVP 1:1 Agent↔printer (secondary printer routing v5.1 backlog), Auth: `POST /print/agent/register` + `/refresh` + `GET /print/jobs/next` + `POST /print/jobs/:id/result`, JWT TTL 1 saat / refresh 30 gün, revoke akışı `agents.revoked_at`, payload size 64 KB hard limit (`PRINT_PAYLOAD_TOO_LARGE` 400), semver + `/print/v1/` URL versioning + breaking change'da `/v2/` paralel + 6 ay deprecation. Phase 2 API katmanı `print_jobs` INSERT akışına yeşil ışık; Agent kodu (`apps/print-agent/` + `packages/shared-types/print-agent.ts`) hâlâ Phase 4+ — bu pass'ta dosya YARATILMADI (kapsam kilidi).

**Phase 1'de potansiyel ek ADR'ler (gerekirse):**
- ADR-006 — Hata taksonomi + API error contract (forward-ref `decisions.md` §10.5.2 C6 + §11.10 madde-18). API'de `error.code` standardı + DB `RAISE EXCEPTION` → domain error mapping. **Accepted 2026-04-26** (Sprint 0 Madde 1). §5.2 registry genişletildi: `RESOURCE_NOT_FOUND` fallback eklendi (2026-04-26, chore commit).
- ADR-007 (rezerv) — Rate limiting + brute-force koruması. Görev 12 login endpoint için yeterli olabilir; eğer global politika kararı gerekiyorsa ayrı ADR.

**ADR borçları (Phase 1'de KAPATILMAZ, takip için)**:
- v3→v5 takeaway/delivery backfill ADR (Phase 5)
- v5.1 admin uncomp akışı ADR
- v5.1 refund ADR
- KVKK DSAR akış ADR (v5.1)
- PITR/backup stratejisi (Phase 5 hazırlığı, ops doc olabilir)
- **v5.1 Password Reset email akışı ADR-X** — ADR-011 §11.2 Karar B (yönetici aracılı) MVP için yeterli; gerçek email-based reset SMTP altyapısı (Hetzner Postfix veya AWS SES) + reset_tokens tablosu + `POST /auth/forgot-password` + `POST /auth/reset-password` endpoint'leri + rate-limit + email enumeration koruması gerektirir. Tetik: pilot sonrası kullanıcı feedback'i veya >1 tenant.

## Sprint 8 öncesi denetim — v5.1 backlog (audit DÜŞÜK bulgular)

`docs/audits/2026-04-29-pre-sprint-8-backend-audit.md`'den çıkan 4 düşük öncelikli bulgu **bilinçli olarak v5.1'e ertelendi** (kapsam kilidi gereği). Sprint 8 başlamadan önce KAPATILMAZ — Web UI'yı geciktirir, ADR/yapısal karar gerektirir, ya da yeni dependency.

1. **`permissions.ts` merkezi ABAC (audit DÜŞÜK #5)** — 3+ ABAC kural noktası birikince refactor. Şu an `authorize()` middleware + inline conditional pattern. Tetik: Sprint 4 KDS kitchen-routed + v5.1 ABAC genişlemeleri. ADR gerekir. (Anchor §2 borç notu da var.)

2. **`writeAudit` helper soyutlama (audit DÜŞÜK #7)** — 17 çağrı, event-builder pattern büyük design kararı. Mevcut pattern (her route'ta `writeAudit(trx, {eventType, ...})`) çalışır. Refactor: builder fluent API veya event-class tabanlı. ADR + arka plan gerekli.

3. **Property-based test (fast-check) (audit DÜŞÜK #8)** — domain fonksiyonları için (money, tax, order calc). Yeni dependency + yeni test stratejisi. Mevcut: 132 unit test (1.9 expect/it ratio). Sprint 8+ mavi gökyüzü iş. ADR gerekir.

4. **`idParamSchema.strict()` mode (security-reviewer DÜŞÜK)** — extra params reddedilirse sub-resource gizli typo'lar yakalanır. Mevcut sub-resource route'lar zaten kendi şemasını veriyor (`tables.ts` `/:id/area` için ayrı schema). Risk minimal, defansif derinlik. Tek satır + 2 test güncellemesi (PR #1 merge sonrası).

5. **PR-8f — V3 müşteri import CLI ürünleştirme (Sprint 10 ertelemesi)** — Sprint 10 (PR-8) kapsamında `apps/api/scripts/import-v3-customers.ts` ad-hoc tek-seferlik script olarak yazıldı (1394 müşteri, tek transaction inline INSERT). Ürünleştirilmiş CLI (CLI flag'leri + dry-run + tenant seçimi + idempotency + dokümantasyon + multi-tenant onboarding kullanımı) v5.1'e ertelendi. Tetik: 2. tenant onboard'u veya kullanıcının "tekrar çalıştırma" talebi.

6. **PR-8 backend + frontend test coverage** — Sprint 10 kapanışında integration test (10 endpoint), frontend RTL (CustomerForm + IncomingCallPopup 3 state + blacklist snapshot), Playwright E2E (caller:incoming → popup → yeni müşteri) eksik kaldı. ADR-016 Karar 9 test stratejisi v5.1'de hayata geçirilmek üzere ertelendi (ya da Sprint 11 başında borç olarak çözülür).

## Notlar

- **Plan Mode (Shift+Tab) zorunlu**: Görev 9-12 birden fazla dosya etkiliyor → her görev başında Plan Mode'da çalışılır.
- **Worktree disiplini**: Her görev için ayrı git worktree (Görev 6'daki implementer pattern'i). Ana branch'e yalnız PR/merge ile dokunulur.
- **Sub-agent zorunluluğu**: Görev 12 (auth) `security-reviewer` onayı olmadan merge YOK. Görev 11 (DB) `db-migration-guard` SQL review.
- **Türkçe metin disiplini**: Görev 9 (zod), Görev 10 (domain), Görev 11 (DB) — bu katmanlarda kullanıcıya görünen Türkçe metin **yok**. Türkçe yalnız UI katmanında (Phase 2). API error'ları `error.code` döner, çeviri UI'da.
- **v3 referans erişimi**: Görev 10 (KDV) için `D:\dev\restoran-pos-v3\` READ-ONLY. Kod kopyala-yapıştır YASAK — yalnız davranışsal bilgi.
- **Para = integer cent** (mutlak kural): Görev 9-10-11-12 her katmanda denetlenir. Float yakalanırsa PR reddedilir.
- **`any` yasağı**: TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` aktif. Her görevde tipler tam.
