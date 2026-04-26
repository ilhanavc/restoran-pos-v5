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

- **Phase 1.5 paketi** (Session 25, devam ediyor) — eksik policy + drift cleanup. Tamamlandıktan sonra Phase 2'ye geçilir.

### Phase 1.5 — Eksik policy + drift cleanup (forensic audit sonucu)

**Bağlam:** Phase 1 Exit Audit (Session 25) Forensic Verdict B (atlama): charter Phase 1 listesindeki "Menu/Payment/User entity ve policy'leri" maddesi `1292b7f` commit'inde active-plan brief'lerine geçmedi (sessiz daraltma). Audit Katman 2 ek bulgular: ESLint kural eksikliği (ADR-001 §2.2 drift), migration idempotency (CREATE ROLE cluster-level çakışma), ölü `eslint-disable` directives. Phase 1.5 paketi Phase 2'ye geçmeden önce bu eksiklerin tamamlanması.

**Görevler:**
1. `packages/shared-types/src/permissions.ts` (ADR-002 §6 role permission matrix) — ✅ commit `bc9cba1`
2. ESLint `no-restricted-imports` + gerçek lint scriptleri (ADR-001 §2.2) — ✅ commit `040521f`
   - **Yan ürün (İş #2.5):** ölü `eslint-disable` directives temizliği — ✅ commit `3c5458b`
3. Migration `CREATE ROLE` idempotency (DO/EXCEPTION pattern) — ✅ commit `3eb8481`
4. `packages/shared-domain/src/menu.ts` Menu policy + tests — ✅ commit `bf33fc5`
5. `packages/shared-domain/src/payment.ts` Payment policy + tests — ✅ commit `c27de1a`
6. `packages/shared-domain/src/user.ts` (domain) User policy + tests — ⏳ (oturum 2)
7. **`docs/v3-reference/domain-rules.md` + `.claude/memory/decisions.md` ADR-003 §10 prose drift cleanup** — ⏳ (User policy'den ÖNCE):
   - `domain-rules.md` sat 41 `payment_scope` ve `payment_type` enum isimleri güncel hale (`{full, item, partial}` + `{cash, card, transfer}`)
   - ADR-003 §10 prose metni RENAME öncesi enum isimleri içeriyor (`full_order, split_item, equal_split`) — güncelle
   - ADR-003 §10.2.3 dosya yolu drift: `packages/shared-domain/src/orderComp.ts` → `apps/api/src/services/orderComp.ts` (Phase 2'de yazılacak)
   - Tek text-replace pass'i, doğrudan Edit (sub-agent değil), ~30 dk
8. `CHANGELOG.md` (Session 11-25 görevleri + ADR-004 + Phase 1.5 entries) — ⏳ (oturum 2)
9. `docs/project-charter.md` + `docs/context-anchor.md` netleştirmeleri (yedek altyapı yorumu, hibrit şifre reset notu, Phase 1.5 reconciliation, Phase 2 öncesi GitHub Pro + branch protection notu) — ⏳ (oturum 2)
10. (yer tutucu — yan ürün İş #2.5 burada zaten sayılı)
11. Phase 1.5 paketi toplu push — ⏳ (oturum 2 sonu)

**Sıralama notu:** İş #7 (drift cleanup) İş #6 (User policy) ÖNCESİ yapılır — User policy `domain-rules.md`'ye referans verecek, güncel görmesi lazım.

**Phase 2'ye geçiş öncesi (Phase 1.5 paketi dışı, ayrı):**
- Branch protection main'de aktif (force push yasak, PR zorunlu, CI yeşil olmadan merge yasak) — **Free yeterli (public repo); GitHub Pro gerekmiyor.** Pro yalnız private repo'da branch protection için, Codespaces, veya Advanced Security (CodeQL/secret scanning) istenirse anlamlı.
- ADR-004 Accepted (Print Agent) — ✅ commit `8fb7e1b`

### Phase 2 Sprint 0 — Altyapı Ön-İşleri (Phase 2 Sprint 1 endpoint'leri öncesi zorunlu)

**Kaynak:** `docs/audits/phase-1-exit-audit-final.md` Bölüm 4B + 4C. Phase 1 Exit Audit Katman 3 verdict'i: "Phase 2'ye geçilebilir AMA şu kalemler Phase 2 başında halledilmeli."

**Tahmini süre:** ~1 hafta. ADR önce, kod sonra disiplini.

**Zorunlu (🔴 ilk endpoint'ten önce):**

1. **Error taxonomy ADR** (`.claude/memory/decisions.md` ADR-005 veya §10.5 C6 + §11.10 forward-ref'lerini birleştiren ayrı ADR)
   - DB RAISE → Türkçe i18n-key mapping
   - `23505 unique_violation` → `CONFLICT` + retry pattern
   - Endpoint hata kodları sözleşmesi (ör. `AUTH_INVALID_CREDENTIALS`, `MENU_PRODUCT_NOT_FOUND`, `ORDER_INVARIANT_VIOLATED`)
   - Error envelope format: `{ error: { code, message_key, details? } }`
   - **Yürütücü:** `architect` sub-agent

2. **`apps/api/src/errors.ts` + `errorHandler` middleware**
   - `RepositoryError` / `NotFoundError` / `ConflictError` → HTTP status + error envelope mapping
   - `app.use(errorHandler)` (4-arg signature) — `app.ts`'e enjekte
   - `auth.ts`'deki inline try/catch + `console.error` blokları temizlenir, throw'a düşürülür
   - **Yürütücü:** `implementer` (ADR-005 sonrası)

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
- [ ] ADR-005 (veya muadili Error taxonomy ADR) **Accepted**
- [ ] `pnpm --filter @restoran-pos/api typecheck` temiz
- [ ] `pnpm --filter @restoran-pos/api test` yeşil (auth.test.ts hâlâ geçer + yeni middleware testleri)
- [ ] `pnpm -r lint` yeşil (yeni ESLint kuralları dahil)
- [ ] `auth.ts` console.error kullanmıyor (logger üzerinden)
- [ ] `auth.ts` inline try/catch kalkmış (errorHandler'a delege)
- [ ] writeAudit() integration test (DB'ye yazıyor, sanitizer çalışıyor)
- [ ] Smoke senaryosu (login → me → refresh → logout) hâlâ 6/6 yeşil

**Bu sprint kapanmadan Phase 2 Sprint 1 (POST /tables, POST /menu/categories, POST /orders) endpoint'leri yazılmaz.**

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
- ADR-005 — Hata taksonomi + API error contract (forward-ref `decisions.md` §10.5.2 C6 + §11.10 madde-18). API'de `error.code` standardı + DB `RAISE EXCEPTION` → domain error mapping. Görev 11-12'de ihtiyaç netleşir.
- ADR-006 — Rate limiting + brute-force koruması. Görev 12 login endpoint için yeterli olabilir; eğer global politika kararı gerekiyorsa ayrı ADR.

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
