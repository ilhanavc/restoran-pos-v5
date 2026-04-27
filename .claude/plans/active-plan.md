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

- **Phase 2 Sprint 3** (charter sırası, atlama yok) — Sprint **3a (ABAC unblock)** + Sprint **3b (admin CRUD)** olarak bölündü (toplu boyut ~1500 satır PR review yönetimi gerekçesiyle). Sıralama: 3a önce → 3b sonra. KDS endpoint'leri **Sprint 4'e ertelendi** (ADR-008 amendment 2026-04-27, FK semantiği netleştirme + drift cleanup). Detay aşağıda Sprint 3 bloğunda. Phase 2 Sprint 2 GET endpoint'leri ✅ KAPANDI (PR #19, `c439944`). Sprint 1 borçları PR #18'de zaten kapatıldı (migration 004 + 16 POST integration test).

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
| KDS endpoints + kitchen ABAC + station mapping ADR'si | Sprint 4 | MVP zorunlu (mutfak siparişi görünürlüğü). KDS UI sözleşmesi + `order_items.station` mapping ADR'si Sprint 4 başında. ADR-008 amendment (2026-04-27) ile §3.3 + §4.2 + §6 referansları "Sprint 3 KDS" → "Sprint 4 KDS" güncellendi |
| POST /payments + payment error registry kodları aktivasyonu (ADR-006 §5.2) | Sprint 4 | Endpoint Sprint 4'te. Registry kodları (`PAYMENT_AMOUNT_MISMATCH`, `PAYMENT_TYPE_INVALID`) ADR-006'da yazılı, kod entegrasyonu Sprint 4 |
| Görev 17 status code kararı: `USER_LAST_ADMIN_PROTECTED` (409) + `USER_CANNOT_DELETE_SELF` (403) | ✅ ADR-002 §10 + ADR-006 §5.2 registry'de yazıldı (PR `chore/sprint-3-plan`) | RFC 9110 §15.5.10 (409 state conflict) + §15.5.4 (403 forbidden, actor=target ABAC). 422 reddedildi (parse semantic değil, runtime state) |
| Görev 18 öncesi: variant nested write + cascade soft delete kararı (ADR-009 veya ADR-003 amendment) | **Görev 18 öncesi (Sprint 3a kapanış sonrası)** | Variant write stratejisi (POST/PATCH /products nested vs ayrı endpoint) ve product soft delete'in variants'a etkisi tanımsız. order_items snapshot kuralı (ADR-003 §10) variant adını kopyaladığı için referansiyel risk yok ama write/list semantiği ADR'siz |

---

#### Sprint 3a — ABAC Unblock (migration 005 + POST hotfix + ABAC enable)

##### Görev 14. Migration 005 — `orders.waiter_user_id` kolonu

- **Durum:** ⏳ Sırada
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

##### Görev 15. POST /orders hotfix — `waiter_user_id` set

- **Durum:** ⏳ Sırada
- **Yürütücü:** `implementer`
- **Bağımlılık:** Görev 14 ✅, ADR-008 §4 madde 1
- **Çıktı:**
  - `apps/api/src/routes/orders.ts` POST handler — `waiter_user_id: req.user.userId`
  - `apps/api/src/routes/orders.test.ts` — yeni assertion
- **DoD:**
  - Mevcut 16 POST integration test yeşil
  - +4 yeni test (4 rol matrisi)
  - Manuel smoke: login (waiter) → POST → DB satırında `waiter_user_id` doğru UUID

##### Görev 16. ABAC enable — waiter "kendi siparişi" filtresi

- **Durum:** ⏳ Sırada
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

**Sprint 3a kapanış kriterleri:**
- [ ] Görev 14, 15, 16 hepsi ✅
- [ ] CI yeşil (lint + typecheck + test + migration check)
- [ ] PR squash merge sonrası context-anchor §2 güncel
- [ ] Sprint 3b başlamadan iki blocker kapanır:
  - [ ] **Görev 18 ADR-X (variant nested write + cascade soft delete)** yazılır + Accepted
  - [ ] context-anchor §2 'Açık stratejik borçlar' veya 'Şimdi neredeyiz' bölümüne aşağıdaki append-edit yapılır:
    1. Read `docs/context-anchor.md` → §2 (Şimdi neredeyiz) bölümünün son satırını bul
    2. O satırdan sonra şu bloğu ekle (Edit tool, append-after pattern):

  ```markdown
  **Sprint 3b başlamadan blocker (2026-MM-DD itibarıyla — Sprint 3a kapanış tarihi yazılır):**
  - Görev 18 ADR-X (variant nested write + cascade soft delete kararı) yazılır + Accepted
  - Architect sub-agent çağırılır; v3 reference (`docs/v3-reference/modules.md` menü bölümü) okunur
  - ADR Accepted olmadan Görev 18 implementer çağrılmaz
  ```

  Manuel yazma yok — Claude Code yukarıdaki Read+Edit'i mekanik uygular.

---

#### Sprint 3b — Admin CRUD (Users + Products/Variants)

> **Sıra notu:** Görev 17 ve 18 **birbirinden bağımsız**; ABAC unblock dışında karşılıklı bağımlılık yok. Önerilen sıra (Users → Products) RBAC pattern'inin Users'da oturtulup Products'da uygulanması içindir, **zorunlu değil**. Tek developer akışında sequential, paralel session mümkünse paralel.

##### Görev 17. Users CRUD (admin-only)

- **Durum:** ⏳ Sırada (Sprint 3a sonrası)
- **Yürütücü:** `implementer` + `security-reviewer` (ADR-002 §10 + ADR-006 §5.2 zaten kabul edildi PR `chore/sprint-3-plan` ile, ek ADR gerekmez)
- **Bağımlılık:** Sprint 3a ✅, ADR-002 §10 (User Lifecycle) Accepted ✅, `packages/shared-types/src/user.ts` (UserCreateSchema mevcut), `packages/db/src/repositories/users.ts` (mevcut, DELETE+update yöntemleri eksikse eklenir)
- **ADR-002 §10 kapsam özeti (referans):** Soft delete + son admin guard 409 + self-delete guard 403 + token revoke + login filter + access risk window 30dk + audit_logs entry. Detay decisions.md ADR-002 §10.1-10.9.
- **Çıktı:**
  - `apps/api/src/routes/users.ts` — POST / GET (list + by-id) / PATCH / DELETE / PATCH password
  - `packages/shared-types/src/user.ts` — `UserUpdateSchema`, `UserListResponseSchema` (eksikse)
  - `packages/shared-types/src/permissions.ts` — `users.create/read/update/delete` action'ları (eksikse)
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

##### Görev 18. Products/Variants CRUD (admin-only)

- **Durum:** ⏳ Sırada (Görev 18 ADR-X amendment merged sonrası)
- **Yürütücü:** `architect` (ADR-009 veya ADR-003 amendment) → `implementer`
- **Bağımlılık:** Görev 18 ADR-X Accepted, Sprint 3a ✅; **Görev 17'ye bağımlı DEĞİL**
- **Çıktı:**
  - `packages/db/src/repositories/products.ts` — CRUD (transaction-aware variant nested write)
  - `apps/api/src/routes/products.ts` — POST / GET / PATCH / DELETE
  - `apps/api/src/routes/products.test.ts`
  - `packages/shared-types/src/menu.ts` — `ProductCreateSchema`, `ProductUpdateSchema`
- **DoD:**
  - 14+ integration test (CRUD × 4 rol + nested variant senaryoları)
  - admin dışı 403
  - Variant transaction atomik (DB error halinde rollback)
  - Soft delete: product silinince variants ADR-X kararına göre işaretlenir
  - order_items snapshot regression test (ADR-003 §10)
  - typecheck + lint + test yeşil

**Sprint 3b kapanış kriterleri:**
- [ ] Görev 17, 18 hepsi ✅
- [ ] Görev 18 ADR-X merged
- [ ] CI yeşil
- [ ] Görev 17 ve 18 ayrı PR'lar (her biri ~500-700 satır, review yönetilebilir)
- [ ] Phase 2 charter "Users CRUD + Menu CRUD" ✅
- [ ] Active-plan "sıradaki görev" → Sprint 4 (POST /payments + KDS endpoints + station mapping ADR)


**Erteleme kabul (Sprint 0 dışı, Phase 2 içinde uygun yerde):**
- Genel API rate limiter (sadece login'de var, diğer mutating endpoint'lerde Phase 2 ortasında)
- Socket.IO altyapısı (ilk realtime endpoint'le — KDS veya order push)
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

## Notlar

- **Plan Mode (Shift+Tab) zorunlu**: Görev 9-12 birden fazla dosya etkiliyor → her görev başında Plan Mode'da çalışılır.
- **Worktree disiplini**: Her görev için ayrı git worktree (Görev 6'daki implementer pattern'i). Ana branch'e yalnız PR/merge ile dokunulur.
- **Sub-agent zorunluluğu**: Görev 12 (auth) `security-reviewer` onayı olmadan merge YOK. Görev 11 (DB) `db-migration-guard` SQL review.
- **Türkçe metin disiplini**: Görev 9 (zod), Görev 10 (domain), Görev 11 (DB) — bu katmanlarda kullanıcıya görünen Türkçe metin **yok**. Türkçe yalnız UI katmanında (Phase 2). API error'ları `error.code` döner, çeviri UI'da.
- **v3 referans erişimi**: Görev 10 (KDV) için `D:\dev\restoran-pos-v3\` READ-ONLY. Kod kopyala-yapıştır YASAK — yalnız davranışsal bilgi.
- **Para = integer cent** (mutlak kural): Görev 9-10-11-12 her katmanda denetlenir. Float yakalanırsa PR reddedilir.
- **`any` yasağı**: TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` aktif. Her görevde tipler tam.
