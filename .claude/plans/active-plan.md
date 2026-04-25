# Aktif Plan — Phase 1: Core Domain + Auth

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince tamamen yenilenir.

## Faz: 1 (Core Domain + Auth + DB Repository Katmanı)

Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap" bölümü. Phase 1 sonunda Phase 2'ye (Sipariş + Masa + Menü UI) geçilir.

## Hafta: 1 / 4

### Hafta 1-2 hedefi (cümle)

`packages/shared-types` (zod şemaları) + `packages/shared-domain` (saf hesap fonksiyonları, TDD %85+) + `packages/db` repository katmanı (Kysely) tamamlanır. Hafta 2 sonunda auth-dışı domain hesabı tam test edilir, hafta 3-4'te `apps/api` üzerinde JWT/RTR auth endpoint'leri ayağa kalkar.

### Görevler (sırayla)

#### 9. `packages/shared-types` — Zod şemaları
- **Durum**: ✅ **Tamamlandı (2026-04-25, Session 22, commit `43bf030`)**
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
- **Durum**: ⏳ Beklemede
- **Yürütücü**: `implementer` sub-agent + `db-migration-guard` review (sadece SQL ve role kullanımı için)
- **Bağımlılık**: Görev 9 (`shared-types`), `packages/db/src/generated.ts` (mevcut kysely tipi), ADR-002 (auth tabloları), ADR-003 §15 (4 rol matrisi)
- **Kısıt**: Bu görev SADECE auth + temel masa/kullanıcı repo'larını içerir. `orders`, `payments`, `print_jobs` repo'ları Phase 2'ye bırakılır.
- **Çıktı**:
  - `packages/db/src/connection.ts` — `createPool(config)` factory. `DATABASE_URL` env'i okur, `pg.Pool` döner. App role default; migrate script'inde `MIGRATOR_DATABASE_URL` ayrı.
  - `packages/db/src/kysely.ts` — `createKysely(pool)` → `Kysely<DB>` (DB tipi `generated.ts`'den)
  - `packages/db/src/repositories/users.ts` — `findByEmail(email)`, `findById(id)`, `create({ email, passwordHash, role, tenantId })`, `updatePassword(id, newHash)`, `softDelete(id)` — hepsi `tenant_id` parametresi alır (ADR-003 RLS kuralı).
  - `packages/db/src/repositories/refresh-tokens.ts` — `create({ userId, tokenHash, expiresAt })`, `findByTokenHash(tokenHash)`, `deleteByTokenHash(tokenHash)`, `deleteAllForUser(userId)`, `deleteExpired()` (cron için, Phase 1'de manuel test). Token DB'de `bcrypt`/`argon2` HASH olarak tutulur, plain text yasak (ADR-002 §RTR).
  - `packages/db/src/repositories/tables.ts` — `findAll(tenantId)`, `findById(tenantId, id)`, `findByStatus(tenantId, status)`, `updateStatus(tenantId, id, status)` (Phase 2 sipariş ekranı buna bağlanacak ama Phase 1'de smoke için yeter).
  - `packages/db/src/repositories/index.ts` — barrel export
  - `packages/db/src/errors.ts` — `RepositoryError`, `NotFoundError`, `ConflictError` (PG `23505 unique_violation` mapping). API katmanı bunları yakalar.
- **DoD**:
  - `pnpm --filter @restoran-pos/db typecheck` temiz
  - `pnpm --filter @restoran-pos/db test` — integration test (testcontainers veya local PG): her repo için 1 happy + 1 error path
  - Tüm query'ler kysely query builder üzerinden, raw SQL yalnız gerekli yerde (`sql<T>` template ve gerekçesi yorumda)
  - `tenant_id` parametresi her repo fonksiyonunda zorunlu (RLS henüz aktif değil ama API kontratı şimdiden uyumlu)
  - PG hata kodları `errors.ts` üzerinden domain hataya çevrilir, raw `pg` hatası API'ye sızmaz
  - Pool tek instance (singleton pattern app içinde), test'te dispose edilir

#### 12. `apps/api` — Auth endpoint'leri + middleware
- **Durum**: ⏳ Beklemede
- **Yürütücü**: `implementer` sub-agent + `security-reviewer` zorunlu review
- **Bağımlılık**: Görev 9, 10, 11 hepsi tamam. ADR-002 §3-7 (token TTL, RTR, cookie ayarları, role matrix).
- **Çıktı**:
  - `apps/api/src/auth/jwt.ts` — `signAccessToken(payload, secret, ttl='15m')`, `verifyAccessToken(token, secret)`. HS256 (ADR-002 §3 — RS256 v5.1).
  - `apps/api/src/auth/password.ts` — `hashPassword(plain)` (bcrypt cost 12), `verifyPassword(plain, hash)`
  - `apps/api/src/auth/refresh.ts` — `issueRefreshToken(userId)` (random 256-bit, hash et, DB'ye yaz, plain'i cookie'ye), `rotateRefreshToken(oldPlain)` (RTR: eskiyi sil + yenisini ver, eski 2. kez gelirse `deleteAllForUser` — token theft detection)
  - `apps/api/src/auth/cookie.ts` — `setRefreshCookie(res, plain)` (`HttpOnly`, `Secure` (prod), `SameSite=Strict`, `Path=/auth`, `Max-Age=7d`), `clearRefreshCookie(res)`
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

#### 13. Seed + manuel smoke + Phase 1 exit doğrulaması
- **Durum**: ⏳ Beklemede
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

- **Görev 9** — `packages/shared-types` zod şemaları. `implementer` sub-agent worktree açar, ADR-003 §4-9 + `generated.ts` referans alır.

### Açık sorular

1. **KDV oranları (Görev 10)**: ✅ **Karar (2026-04-25)**: Sabit %10/%20, v3 ile aynı. `shared-domain/tax.ts` içinde kategori bazlı sabit mapping. Tenant-config v5.1.

2. **Seed şifresi (Görev 13)**: ✅ **Karar (2026-04-25)**: Sabit `admin1234` dev ortamı için kabul edildi. Seed dosyasında comment ile "prod'a gitmez" açıkça belirtilecek. `NODE_ENV !== 'production'` guard zorunlu.

### Phase 0 tamamlananlar (arşiv özeti)

Phase 0 (8 görev, 2 hafta, 2026-04-22 → 2026-04-25) tamamlandı. Görev 1 charter onayı (`72e00c5`), görev 2 v3-reference 5 dosya (`modules.md`, `domain-rules.md`, `printer-notes.md`, `data-model.md`, `pain-points.md`), görev 3-5 üç ADR (ADR-001 monorepo + ADR-002 auth + ADR-003 DB şema, hepsi Accepted), görev 6 monorepo iskeleti + CI (`98f4563`), görev 7 docker-compose + kysely-codegen 17 tablo (`6fb7299`), görev 8 hello endpoint (`043e225` + `f6a26dd`). 14 tablo + 7 enum + 4 DB rolü + AuditSanitizer kontratı + birleşik cron + RTR token modeli kararlaştırıldı. Detaylı session log'ları için: `.claude/memory/scratchpad.md` ve git log.

### Phase 1 exit kriterleri

Hafta 4 sonunda:
- [ ] Görevler 9-13 hepsi ✅ (DoD checklist'leri tam)
- [ ] `packages/shared-types` build çıktısı tüm app'lerce import edilebilir
- [ ] `packages/shared-domain` test coverage ≥ %85 (statements + branches)
- [ ] `packages/db` repo katmanı (users, refresh_tokens, tables) integration test yeşil
- [ ] `apps/api` auth endpoint'leri (login/refresh/logout/me) çalışıyor + security-reviewer ✅
- [ ] Seed script çalışıyor, dev ortamı `pnpm install` → seed → login akışı dokümante
- [ ] CI yeşil (typecheck + test + migration-check tüm workflow'lar)
- [ ] ADR-004 (Print Agent Mimarisi) **Draft** statüsünde başlatıldı (Phase 2'de Accepted olacak — bu bir başlatma kriteri, kapatma değil)

### Phase 2'ye geçiş şartı

Phase 1 exit kriterleri **tamamen ✅** olmadan Phase 2'ye girilmez. Phase 2 kapsamı: Sipariş + Masa + Menü domain implementasyonu + web UI ekranları (kasiyer/garson temel akışlar). Phase 2 başında ADR-004 (Print Agent) Accepted edilir.

---

## ADR İzleme

**Phase 0'da kabul edilenler:**
- ADR-001 — Monorepo yapısı + paket isimlendirme (Accepted, 2026-04-25)
- ADR-002 — Auth stratejisi (JWT + RTR + role matrix) (Accepted, 2026-04-25)
- ADR-003 — DB şema ilkeleri (UUID v7 / TIMESTAMPTZ / tenant_id / soft delete / audit / migration) (Accepted, 2026-04-25)

**Phase 1'de yazılacaklar:**
- **ADR-004 — Print Agent Mimarisi** (Phase 1 hafta 3-4 başlatılır, Phase 2 başında Accepted): Cloud API → print job queue → Print Agent (Windows servisi) → ESC/POS. Template cloud'da render, byte stream Agent'a. v3 StoreBridge ölü, kod taşıma yok — yalnızca `printer-notes.md` + `pain-points.md` domain notları referans.

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
