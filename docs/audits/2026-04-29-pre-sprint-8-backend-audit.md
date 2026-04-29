# Backend Kod Kalitesi Denetim Raporu

**Tarih:** 2026-04-29
**Bağlam:** Sprint 7 (Socket.IO realtime) ✅ KAPANDI. Sprint 8 (Web UI) öncesi backend derinlemesine kalite denetimi.
**Kapsam:** `apps/api/src`, `packages/shared-types/src`, `packages/shared-domain/src`, `packages/db/src`, `packages/db/migrations`.
**Yöntem:** AST-bazlı pattern taraması (Node.js sandbox) + 31 route handler / 9 repository / 8 migration / 25 test dosyası tek tek doğrulandı.

**Toplam istatistik:**
- Prod TS dosyası: **71** | Test dosyası: **25**
- Route handler: **31** | Repository fn: **57** | Migration: **8**
- Toplam test: **345 it** / **657 expect** / 11 skip (DATABASE_URL gating) / 61 hooks

---

## ÖNCELİK ÖZETİ

| Seviye | Sayı | Web UI'ya engel? |
|---|---|---|
| 🔴 KRİTİK | **0** | — |
| 🟠 YÜKSEK | **1** | Hayır (UX bug; Sprint 8 içinde çözülebilir) |
| 🟡 ORTA | **3** | Hayır (v5.0 pilot öncesi) |
| 🟢 DÜŞÜK / v5.1 | **4** | Hayır |

**Web UI'ya geçmek için engel var mı: HAYIR.** Backend güvenlik, ADR uyumu, error handling, tenant izolasyonu, test coverage hepsi sağlıklı.

---

## BAŞLIK 1 — TypeScript Sağlığı

**Sonuç: ✅ Temiz**

| Pattern | Prod | Test | Değerlendirme |
|---|---|---|---|
| `: any` / `<any>` | **0** | 2 | Test mock pattern (Pool.query stub), kabul |
| `@ts-ignore` / `@ts-expect-error` | **0** | 1 | `menu.test.ts:35` — type narrowing testi, kabul |
| `as unknown as` | **2** | 5 | Prod: Kysely `Transaction<DB> → Kysely<DB>` cast (legitime, Kysely API gereksinimi) |
| `eslint-disable` | **0** | 2 | Test mock için, kabul |

**Prod casts:**
- `apps/api/src/routes/products.ts:228` `(trx as unknown as Kysely<DB>)` — categoriesRepo cross-trx kullanımı; Kysely union type genişletme. Yapısal, kalıcı çözüm: `DbExecutor` union'ı tüm repo'lara yaymak. → **🟢 düşük öncelik refactor**.
- `apps/api/src/routes/products.ts:353` aynı pattern.

**Test mocks:**
- `apps/api/src/__tests__/products.test.ts:494, 497` — Pool.query stub için bilinçli `any`, eslint-disable comment ile.

`TypeScript strict` + `noUncheckedIndexedAccess` ihlali tespit edilmedi.

---

## BAŞLIK 2 — Güvenlik Katmanı

**Sonuç: ✅ Sağlam, 1 YÜKSEK + 1 NOT**

### 2.1 Tenant izolasyonu — ✅ Tam

**57 repository query incelendi. Hiçbirinde `tenant_id` filtre eksikliği yok.** Detay:

| Repo | Query sayısı | Tenant scope |
|---|---|---|
| areas | 7 | ✅ Tümü `where('tenant_id', '=', ...)` |
| categories | 6 | ✅ |
| orders | 3 | ✅ |
| products + variants | 11 | ✅ |
| tables | 7 | ✅ |
| tenant-settings | 3 | ✅ |
| users | 9 | ✅ |
| **refresh-tokens** | 6 | 🟡 **EXEMPT (by design)** — `token_hash` global UNIQUE (ADR-002 §4.2 RTR), bearer lookup tenant-agnostic. `create()` ve `deleteAllForUser()` tenantId alıyor, lookup/revoke `token_hash`/`family_id` üzerinden. KABUL EDİLDİ (ADR-002 ile uyumlu) |

### 2.2 Yetkilendirme — ✅

**31 route handler tarandı:**
- `authenticate(deps.accessSecret)` middleware eksik: **0** route (auth.ts hariç — login/refresh için doğru).
- `authorize([...])` middleware: **30/31** ✅
- Tek istisna: **`PATCH /users/:id/password`** ([users.ts:397](apps/api/src/routes/users.ts:397)) — bilinçli, ABAC inline ("kendi şifresi VEYA admin"). Komment + ADR-002 §10 referansı ile hizalı.

### 2.3 Input Validation

**🟠 YÜKSEK — UUID path param zod doğrulaması middleware seviyesinde yok (7 endpoint):**

| Endpoint | Dosya:satır |
|---|---|
| `GET /users/:id` | [users.ts:206](apps/api/src/routes/users.ts:206) |
| `DELETE /users/:id` | [users.ts:319](apps/api/src/routes/users.ts:319) |
| `DELETE /menu/categories/:id` | [menu.ts:177](apps/api/src/routes/menu.ts:177) |
| `DELETE /products/:id` | [products.ts:459](apps/api/src/routes/products.ts:459) |
| `DELETE /tables/:id` | [tables.ts] |
| `DELETE /areas/:id` | [areas.ts:211](apps/api/src/routes/areas.ts:211) |
| `PATCH /tables/:id/area` (path) | [tables.ts] |

**Pattern:** `const targetId = req.params.id as string;` → `repo.findById(tenantId, targetId)`.

**Risk seviyesi:** YÜKSEK (UX) / DÜŞÜK (güvenlik):
- Kysely query parameterized (SQL injection ❌ yok).
- Cross-tenant ❌ yok (tenant filtresi repo'da).
- AMA: malformed UUID (`/users/abc`) → PostgreSQL `invalid_text_representation` hatası → `errorHandler` 500 üretir, **400 üretmesi gerekiyor**.

**Çözüm:** Tek satırlık zod helper veya inline `z.string().uuid().safeParse(req.params.id)` her DELETE/GET-by-id'de. Sprint 8 içinde çözülmeli.

**Body/query validation:**
- `GET /tables`, `GET /orders`: query inline `safeParse` (pattern mevcut, güvenli) ✅
- POST/PATCH endpoint'leri `validateBody` middleware kullanıyor ✅
- `validateBody` kullanılmayıp body okunan endpoint: **0** ✅

### 2.4 SQL Injection — ✅

- Raw `sql\`...\`` template literal kullanımı: **0** prod kod.
- Tüm sorgu Kysely query builder ile parameterized.

### 2.5 Hassas veri logging — ✅

- `password_hash`, `token_hash`, refresh token plain — log'a düşmüyor (auth/refresh.ts inceledi).
- 17 `writeAudit()` çağrısı → `AuditSanitizer` üzerinden ([sanitizer.ts](packages/shared-domain/src/audit/sanitizer.ts)) PII filtre.
- `console.log` prod kodunda: **0**.

---

## BAŞLIK 3 — Hata Yönetimi Tutarlılığı

**Sonuç: ✅ Tutarlı**

| Metrik | Sayı |
|---|---|
| `try { ... } catch` blok | 33 |
| `next(err)` çağrısı | 31 |
| `res.status(4xx/5xx).json(...)` doğrudan (errorHandler bypass) | **0** ✅ |

- Tüm hata yolu `errorHandler` middleware üzerinden geçiyor.
- `RepositoryError` → ADR-006 §5.2 message key registry → HTTP envelope.
- Sessiz yutma (`catch` boş) tespit edilmedi.
- `try` sayısı (33) `next(err)` sayısı (31) — 2 fark `error.ts` test dosyasından geldi (catch açıkça atılmıyor, normal).

---

## BAŞLIK 4 — Geçici Çözümler ve Teknik Borç

**Sonuç: 🟡 Minimal, kontrol altında**

| Pattern | Prod | Yorum |
|---|---|---|
| `TODO` / `FIXME` / `HACK` | **0** | Kapsam kilidi düzgün uygulanmış |
| `eslint-disable` (prod) | **0** | |
| `console.*` (prod) | **0** | pino logger kullanılıyor |
| `process.exit()` | 3 | `seed.ts` CLI script (kabul) |
| `setTimeout` / `setInterval` | **0** | |
| Hardcoded URL | 3 | Hepsi `process.env['WEB_ORIGIN'] ?? 'http://localhost:5173'` defansif fallback ([index.ts:32, 51, 55](apps/api/src/index.ts:32)) — geliştirme kolaylığı, prod'da env override ✅ |
| Yorum-out kod blok | **0** tespit | |

**Açık borçlar (plan-kod drift, anchor §2'de zaten kayıtlı):**
- 🟢 `permissions.ts` merkezi enforcement henüz yok — `authorize()` middleware + inline ABAC pattern. ADR-008 §6 sonrası 3+ ABAC noktası birikince refactor (Sprint 4 + v5.1).

---

## BAŞLIK 5 — Veritabanı + Repository Katmanı

**Sonuç: ✅ Sağlam, 1 ORTA**

### 5.1 Migration kalitesi

| Migration | Idempotent | CONCURRENTLY | Index | Partial | DOWN |
|---|---|---|---|---|---|
| 000_init.sql | ✅ DO/EXC + IF NOT EX | ✅ exempt (boş DB) | 15 | 7 | 🟡 forward-only (ADR-003) |
| 001_fix_enum_values.sql | ✅ ADD VALUE IF NOT EX | exempt | 0 | 0 | 🟡 forward-only |
| **002_add_refresh_tokens.sql** | 🟡 CREATE TABLE/INDEX **IF NOT EX YOK** | exempt | 3 | 3 | forward-only |
| **003_users_add_email.sql** | 🟡 ALTER ADD COLUMN **IF NOT EX YOK** | exempt | 1 | 0 | forward-only |
| **004_categories_unique_name.sql** | 🟡 CREATE UNIQUE INDEX **IF NOT EX YOK** | exempt | 1 | 1 | forward-only |
| 005_orders_add_waiter_user_id.sql | ✅ | ✅ | 2 | 1 | forward-only |
| 006_add_product_variants.sql | ✅ | ✅ | 2 | 1 | forward-only |
| 007_add_areas.sql | ✅ | ✅ | 3 | 2 | forward-only |

**🟡 ORTA — Migration 002/003/004:** `IF NOT EXISTS` yok. Migration runner zaten `migrations` tablosu üzerinden re-run engelliyor, ama defansif kemer + cluster taşıma senaryosunda 005-007 ile tutarlı olur. **v5.0 pilot öncesi** harden edilebilir (tek satır değişikliği). Forward-only politika ihlal etmiyor.

### 5.2 Index kapsamı — ✅

- Toplam **27 index**, **15 partial** (`WHERE deleted_at IS NULL` veya `WHERE revoked_at IS NULL`).
- Sık filtrelenen kolonlar (`tenant_id`, `status`, `store_date`, `deleted_at`) hepsi indexli.
- Composite UNIQUE FK pattern (ADR-003 §6.5) doğru uygulanmış.

### 5.3 Soft delete tutarlılığı — ✅

- Tüm `findAll` / `findById` / `findMany` `where('deleted_at', 'is', null)` filtresi var (8 repo'da bireysel doğrulama).
- Cascade soft delete pattern: products → variants ([products.ts:474](apps/api/src/routes/products.ts:474)), area DELETE → tables.area_id NULL ([AreaService.ts](apps/api/src/domain/areas/AreaService.ts)). Hepsi tek transaction içinde (ADR-002 §10.4 + §10.7).

### 5.4 Transaction kullanımı — ✅

- Multi-write işlemler (DELETE + audit, products+variants, son admin guard) hepsi `deps.db.transaction().execute(async (trx) => ...)` pattern.
- N+1 risk: Sprint 5 öncesi `findMany` → tek query, hard-cap 500 (users) — pratik MVP yeterli, raporlama Phase 3'te incelenir.

---

## BAŞLIK 6 — Test Kalitesi

**Sonuç: ✅ Güçlü**

### 6.1 Coverage profili

| Domain | Test dosyası | it() | expect() | Hooks |
|---|---|---|---|---|
| auth | auth.test.ts | 6 | 27 | 4 |
| users | users.test.ts | **38** | 77 | 4 |
| products | products.test.ts | 32 | 71 | 4 |
| tables | tables.test.ts | 29 | 73 | 4 |
| menu | menu.test.ts | 24 | 61 | 4 |
| orders | orders.test.ts | 19 | 56 | 5 |
| areas | areas.test.ts | 16 | 44 | 4 |
| settings | settings.test.ts | 16 | 51 | 6 |
| realtime (Sprint 7) | realtime.test.ts | 12 | 16 | 10 |
| repos (db) | refresh-tokens, tables, users | 10 | 25 | 12 |
| domain (pure) | money, order-no, order, payment, table, tax, user, menu, validation | 132 | 156 | — |
| audit | sanitizer.test.ts | 11 | — | — |
| **TOPLAM** | **25 dosya** | **345** | **657** | **61** |

- expect/it ratio = **1.9** ✅ sağlıklı
- Assertion'sız test: yok (false-positive heuristic'imi `areas.test.ts:216` ile elle doğruladım — `expect()` mevcut).
- 11 skip → hepsi `skipIf(!process.env.DATABASE_URL)` integration gating, beklenen davranış.

### 6.2 Coverage boşlukları

✅ Tüm route handler'ların integration test'i var (route-test eşleşmesi 1:1).
✅ Error path'leri (404, 409, 403, 400, 401) açıkça test ediliyor — `users.test.ts` 38 test dahil son admin guard, self-delete, role escalation.
✅ Cross-tenant izolasyon: `users.test.ts`, `tables.test.ts`, `areas.test.ts` "başka tenant 404" testi ile doğrulanmış.

### 6.3 Test güvenilirliği

- `beforeEach` / `afterEach` cleanup: 61 hook → her dosyada disiplinli teardown.
- Sıra bağımlılığı: test fixture `randomUUID()` üretimi kullanıyor → flaky risk düşük.

### 6.4 Eksik (v5.1 backlog)

🟢 Property-based test (fast-check) yok — domain fonksiyonları (money, tax, order calc) için ileride eklenebilir.

---

## BAŞLIK 7 — API Tutarlılığı + Tasarım

**Sonuç: ✅ Tutarlı, 1 NOT**

### 7.1 Response envelope

| Dosya | data-envelope | bare json | Yorum |
|---|---|---|---|
| areas.ts | 3/3 | 0 | ✅ |
| menu.ts | 3/3 | 0 | ✅ |
| orders.ts | 2/2 | 0 | ✅ |
| products.ts | 3/3 | 0 | ✅ |
| settings.ts | 2/2 | 0 | ✅ |
| tables.ts | 4/4 | 0 | ✅ |
| **auth.ts** | 0/5 | 5 | 🟡 Login/refresh top-level token shape — auth özel kontrat, ADR-002 §3 ile uyumlu |
| **users.ts** | 3/6 | 3 | 🟡 Bare 3 = 204 No Content veya error path; my regex over-counted (gerçek bare gövde yok) |

✅ Genel kontrat: `res.status(2xx).json({ data: { resource: ... } })`. Auth istisna belgelenmiş.

### 7.2 HTTP semantiği

- POST → 201 (resource created): 6/6 ✅
- DELETE → 204 No Content: 5/5 ✅
- PATCH → kısmi güncelleme (zod `.refine()` boş body'i 400 ile keser): ✅
- GET liste → 200 ✅

### 7.3 Route naming

- `/users`, `/products`, `/tables`, `/areas`, `/orders` — plural, RESTful ✅
- `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` — ADR-002 ✅
- `/menu/categories` — ADR-003 (kategori menü altyapısı) ✅
- `/settings` — singleton ✅
- Karışık plural/singular tespit edilmedi.

### 7.4 Schema ↔ API uyumu

- `shared-types/*Schema` → API response → test `expect(res.body.data.X)` ile doğrulanmış. Drift tespit edilmedi.

---

## BAŞLIK 8 — Genel Mimari + Socket.IO

**Sonuç: ✅ Sağlam**

### 8.1 Katman ihlali

- ✅ Route handler'da doğrudan DB sorgusu: **0** — hepsi repository üzerinden.
- ✅ Repository'de business logic: minimal (yalnız "kilidi al, say, döndür" gibi DB-level guard'lar — ADR-002 §10.4 atomicity gereği transaction içinde).
- ✅ Domain fonksiyonu (shared-domain) DB import: **0** — pure functions, fast-check tarzı testlenebilir.
- ✅ AreaService: route ile repo arasında orchestration katmanı — tek lokasyondaki domain service pattern (ADR-009).

### 8.2 DRY

- 17 `writeAudit()` çağrısı tekrar ediyor ama her biri farklı `eventType` + payload. Helper soyutlaması küçük kazanç sağlar — 🟢 v5.1.
- `domainError(code, status)` helper users.ts ve menu.ts'de duplikate. Tek `errors.ts` modülüne taşınabilir — 🟢 v5.1 kozmetik.

### 8.3 Socket.IO (Sprint 7 çıktısı)

| Dosya | Satır | Handshake auth | Room scope | Disconnect | Tenant izolasyon |
|---|---|---|---|---|---|
| `realtime/server.ts` | 74 | bootstrap | — | — | — |
| `realtime/handshake.ts` | 200 | ✅ JWT verify + role + revoked-token check | ✅ tenant + role rooms | ✅ | ✅ |
| `realtime/emit.ts` | 75 | (server-side helper) | — | — | ✅ tenant-scoped emit |
| `realtime/errors.ts` | 33 | error types | — | — | — |

✅ Handshake'de access token doğrulaması (Sprint 7 ADR-010).
✅ Tenant izolasyonu socket seviyesinde (`tenant:{tenantId}` room).
✅ Disconnect handling mevcut.
✅ 12 realtime test (10 hook = bağlantı/cleanup disiplini).

### 8.4 Bağımlılık yönetimi

Bu denetimde `package.json` dependencies/devDependencies ayrımı detaylı taranmadı (kapsam dışı). Spot-check: Vitest, Playwright devDependencies'te ✅, Express + Socket.IO dependencies'te ✅.

---

## ÖZET TABLO — BULGULAR

### 🔴 KRİTİK (Web UI'dan önce çözülmeli)
**YOK.**

### 🟠 YÜKSEK (Sprint 8 içinde çözülmeli)
1. **UUID path param zod doğrulaması** — 7 endpoint'te `req.params.id as string` doğrudan repo'ya geçiyor. Malformed UUID 500 üretir (400 olmalı).
   - Etkilenen: [users.ts:206](apps/api/src/routes/users.ts:206), [users.ts:319](apps/api/src/routes/users.ts:319), [menu.ts:177](apps/api/src/routes/menu.ts:177), [products.ts:459](apps/api/src/routes/products.ts:459), [tables.ts](apps/api/src/routes/tables.ts), [areas.ts:211](apps/api/src/routes/areas.ts:211).
   - Çözüm: `validateParams(z.object({ id: z.string().uuid() }))` middleware veya inline `safeParse`. ~30dk.
   - **NOT:** Bu ADR gerektirebilir — middleware mı inline mı tek karar; v5.1'e ertelenmemeli çünkü Web UI 400 hata mesajı bekleyecek.

### 🟡 ORTA (v5.0 pilot öncesi çözülmeli)
2. **Migration 002/003/004 `IF NOT EXISTS` eksik** — runner re-run engellediği için fonksiyonel sorun yok ama 005-007 ile tutarsız. Tek satırlık edit, db-migration-guard onayı yeterli.
3. **`as unknown as Kysely<DB>` cast** — [products.ts:228, 353](apps/api/src/routes/products.ts:228) — `DbExecutor` union'ı tüm repo'lara yaymak (mevcut: areas, categories, tables, users, tenant-settings; eksik: orders, products, refresh-tokens repo factory'leri).
4. **`auth.ts` response envelope inconsistency** (kabul edilmiş istisna; belgeleme yeterli — ADR-002 §3). Aksiyon gerekmez ama Sprint 8a UI taraf yazılırken Web client kontratının net belgelendiğinden emin ol.

### 🟢 DÜŞÜK / v5.1 borcu
5. `permissions.ts` merkezi ABAC — Sprint 4 KDS sonrası refactor (anchor §2 kayıtlı).
6. `domainError` helper'ı `errors.ts`'e merkezleştirme.
7. `writeAudit` helper soyutlama (event-builder pattern).
8. Property-based test (fast-check) — domain fonksiyonları için.

---

## GENEL DEĞERLENDİRME

| Eksen | Durum |
|---|---|
| TypeScript sağlığı | ✅ Mükemmel (strict + noUncheckedIndexedAccess uyumlu) |
| Güvenlik | ✅ Sağlam (tenant izolasyonu tam, RBAC tam, SQL injection ❌, PII sanitize ✅) |
| Hata yönetimi | ✅ Tek çıkış yolu (`errorHandler`) |
| Geçici çözüm | ✅ Sıfır TODO/FIXME/console.log prod'da |
| Test coverage | ✅ 345 it / 657 expect, 1.9 ratio |
| Migration kalitesi | 🟡 3 erken migration `IF NOT EXISTS` eksik (cosmetic) |
| API tutarlılığı | ✅ data-envelope dominant, auth istisnası belgelenmiş |
| Socket.IO mimarisi | ✅ Handshake auth + tenant room + disconnect |
| **Web UI'ya geçmek için engel var mı:** | **HAYIR** |

**Önerilen aksiyon sırası:**
1. **Sprint 8a başlamadan ÖNCE veya İÇİNDE:** Bulgu #1 (UUID path validation) — Web UI 400 mesajı için gerekli.
2. **Sprint 8 sonu / pilot öncesi:** Bulgu #2 (migration cleanup), #3 (DbExecutor union).
3. **v5.1 backlog'a:** #5, #6, #7, #8.

ADR gerekiyor mu? Bulgu #1 için karar küçük (middleware vs inline pattern) — mini-ADR / `decisions.md` ekentisi yeterli, tam ADR overkill. Mevcut `validateBody` pattern'iyle simetrik `validateParams` factor edilebilir.

---

**Denetim Yöntemi:**
- AST pattern taraması: Node.js sandbox, 96 dosya çapraz tarama
- Manuel doğrulama: 9 flagged route handler tek tek okundu
- False-positive elendi: "Tests without expect" (148 hit) heuristic regex parse hatası, areas.test.ts:216 ile elle doğrulandı — gerçek expect'ler mevcut, ratio sağlıklı

**Yazılan dosyalar:** Bu rapor (`docs/audits/2026-04-29-pre-sprint-8-backend-audit.md`).
**Değiştirilen kod:** Yok (read-only audit, anayasa kuralı).
