# Proje Sağlık Taraması — 2026-04-26

> Tarih: 2026-04-26  
> Amaç: Claude.ai incelemesi için ham proje durumu raporu. Yorum/düzenleme yok.

---

## 1. Git Durumu

### git log --oneline -40
```
a983816 Merge branch 'main' of https://github.com/ilhanavc/restoran-pos-v5
259458f chore(anchor): Session 28 kapanışı — active-plan + context-anchor güncelle (#13)
7f0f86e Merge branch 'main' of https://github.com/ilhanavc/restoran-pos-v5
16ef298 chore(claude): .claude/agents + skills — commit untracked config files (#12)
1845e72 Merge branch 'main' of https://github.com/ilhanavc/restoran-pos-v5
5e2fe82 fix(adr): decisions.md §9 enum drift — payment_scope + payment_type (#11)
b255efa Merge branch 'main' of https://github.com/ilhanavc/restoran-pos-v5
e1c68b8 chore(anchor): Sprint 0 kapandı — DoD 8/8 + Phase 2 Sprint 1 sıradaki (#10)
dc1f4e9 chore(anchor): Sprint 0 kapandı — DoD 8/8 + Phase 2 Sprint 1 sıradaki
50ee279 Merge branch 'main' of https://github.com/ilhanavc/restoran-pos-v5
303763c feat(api): validateBody middleware + ESLint float ban (Sprint 0 Madde 4 & 6) (#9)
09fea96 feat(api): validateBody middleware + ESLint float ban (Sprint 0 Madde 4 & 6)
7bf1646 feat(logger): pino logger altyapısı — Sprint 0 Madde 5 (#8)
1fb1442 feat(audit): writeAudit() + AuditSanitizer — Sprint 0 Madde 3 (ADR-003 §12.4) (#7)
552ee91 chore(anchor): Sprint 0 Madde 1/1.5/2 tamamlandı, Madde 3 sıradaki
bc149bd feat(error-handler): ADR-006 error taxonomy — Sprint 0 Madde 2
861f03f chore(adr-006): §5.2 registry RESOURCE_NOT_FOUND fallback eklendi (#4)
d295b3b chore(anchor): ADR numarası atomik rezervasyon kuralı eklendi (#3)
afcc083 feat(adr): ADR-006 API Error Taxonomy + Error Envelope Contract (#2)
1ab6ff3 chore(anchor): branch protection confirmed active + Sprint 0 sıradaki güncelle (#1)
3a75c92 docs(audit): phase-1 exit audit final — katman 3
68fe9a9 docs(anchor+plan): Pro upgrade gereksiz — Free branch protection public repo'da yeterli
4765683 docs(session): Phase 1.5 oturum 2 kapanışı — paket TAMAM + push
a0e5eda docs(charter+anchor): Phase 1.5 reconciliation — Phase 1 'yedek altyapı' netleştirme + anchor §2 güncel
9574cf9 docs(changelog): Phase 0 finalization + Phase 1 + Phase 1.5 entries (Session 11-25)
b5a0277 docs(anchor): track demo seed password length debt
27a6484 fix(shared-types): align password min length with ADR-002 §8 (8 → 10)
a564d55 feat(shared-domain): User policy + tests (ADR-002 §1 §6 §8)
2526aa7 docs(drift): align domain-rules and ADR-003 §10 with current enum names + service location
66c50b9 docs(session): Phase 1.5 oturum 1 kapanışı — İş #1-#5 tamam
c27de1a feat(shared-domain): Payment policy + tests
bf33fc5 feat(shared-domain): Menu policy + tests
3eb8481 fix(db): migration CREATE ROLE idempotency
3c5458b chore(api): remove dead eslint-disable directives surfaced by ADR-001 §2.2 enforce
040521f chore(eslint): no-restricted-imports + real lint scripts (ADR-001 §2.2)
bc9cba1 feat(permissions): role permission matrix per ADR-002 §6
8fb7e1b docs(adr): ADR-004 Accepted — Print Agent Mimarisi (Phase 2 başı)
37b2d9a docs(context-anchor): §2 dedupe — 'Açık stratejik borçlar' iki kez tekrarlanıyordu
f0fd920 docs(session-24): closure — Phase 1 ✅, Phase 2'ye geçiş hazır
e2c967d docs(adr): ADR-004 Draft — Print Agent Mimarisi + Phase 1 exit ✅
```

### git status
```
On branch main
Your branch is ahead of 'origin/main' by 7 commits.
  (use "git push" to publish your local commits)

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.claude/worktrees/

nothing added to commit but untracked files present (use "git add" to track)
```

### git branch -a
```
* main
  worktree-agent-a51a1c5029927bb6f
  remotes/origin/HEAD -> origin/main
  remotes/origin/chore/adr-006-resource-not-found-fallback
  remotes/origin/chore/anchor-adr-numbering-rule
  remotes/origin/chore/anchor-sprint0-closed
  remotes/origin/chore/anchor-sprint0-madde2
  remotes/origin/chore/branch-protection-anchor-update
  remotes/origin/chore/commit-claude-config
  remotes/origin/chore/session28-close
  remotes/origin/feat/adr-005-error-taxonomy
  remotes/origin/feat/sprint0-error-handler
  remotes/origin/feat/sprint0-pino-logger
  remotes/origin/feat/sprint0-validate-body-eslint-float
  remotes/origin/feat/sprint0-write-audit
  remotes/origin/fix/decisions-enum-drift
  remotes/origin/main
  remotes/origin/worktree-agent-a51a1c5029927bb6f
```

---

## 2. Proje Yapısı

### ls -la (root)
```
total 273
drwxr-xr-x  .
drwxr-xr-x  ..
drwxr-xr-x  .claude
-rw-r--r--  .env.local
-rw-r--r--  .env.local.example
drwxr-xr-x  .git
drwxr-xr-x  .github
-rw-r--r--  .gitignore
-rw-r--r--  .npmrc
-rw-r--r--  .nvmrc
drwxr-xr-x  .turbo
-rw-r--r--  CHANGELOG.md
-rw-r--r--  CLAUDE.md
-rw-r--r--  GETTING-STARTED.md
-rw-r--r--  README.md
drwxr-xr-x  apps
-rw-r--r--  docker-compose.yml
drwxr-xr-x  docs
-rw-r--r--  eslint.config.js
drwxr-xr-x  node_modules
-rw-r--r--  package.json
drwxr-xr-x  packages
-rw-r--r--  pnpm-lock.yaml
-rw-r--r--  pnpm-workspace.yaml
-rw-r--r--  tsconfig.base.json
-rw-r--r--  turbo.json
```

### ls apps/
```
api
mobile
print-agent
web
```

### ls packages/
```
db
shared-domain
shared-types
shared-ui
```

### find apps/api/src -name "*.ts" | sort
```
apps/api/src/__tests__/auth.test.ts
apps/api/src/app.ts
apps/api/src/audit/writeAudit.test.ts
apps/api/src/audit/writeAudit.ts
apps/api/src/auth/cookie.ts
apps/api/src/auth/jwt.ts
apps/api/src/auth/password.ts
apps/api/src/auth/refresh.ts
apps/api/src/errors.test.ts
apps/api/src/errors.ts
apps/api/src/index.ts
apps/api/src/logger.ts
apps/api/src/middleware/authenticate.ts
apps/api/src/middleware/authorize.ts
apps/api/src/middleware/errorHandler.ts
apps/api/src/middleware/validate.ts
apps/api/src/routes/auth.ts
apps/api/src/routes/index.ts
```

### find packages/ -name "*.ts" | sort (node_modules hariç)
```
packages/db/src/connection.ts
packages/db/src/errors.ts
packages/db/src/generated.ts
packages/db/src/index.ts
packages/db/src/kysely.ts
packages/db/src/repositories/__tests__/refresh-tokens.test.ts
packages/db/src/repositories/__tests__/tables.test.ts
packages/db/src/repositories/__tests__/users.test.ts
packages/db/src/repositories/index.ts
packages/db/src/repositories/refresh-tokens.ts
packages/db/src/repositories/tables.ts
packages/db/src/repositories/users.ts
packages/db/src/seed.ts
packages/shared-domain/src/audit/allowed-keys.ts
packages/shared-domain/src/audit/deny-list.ts
packages/shared-domain/src/audit/index.ts
packages/shared-domain/src/audit/sanitizer.test.ts
packages/shared-domain/src/audit/sanitizer.ts
packages/shared-domain/src/audit/types.ts
packages/shared-domain/src/index.ts
packages/shared-domain/src/menu.test.ts
packages/shared-domain/src/menu.ts
packages/shared-domain/src/money.test.ts
packages/shared-domain/src/money.ts
packages/shared-domain/src/order-no.test.ts
packages/shared-domain/src/order-no.ts
packages/shared-domain/src/order.test.ts
packages/shared-domain/src/order.ts
packages/shared-domain/src/payment.test.ts
packages/shared-domain/src/payment.ts
packages/shared-domain/src/table.test.ts
packages/shared-domain/src/table.ts
packages/shared-domain/src/tax.test.ts
packages/shared-domain/src/tax.ts
packages/shared-domain/src/user.test.ts
packages/shared-domain/src/user.ts
packages/shared-domain/src/validation.test.ts
packages/shared-domain/src/validation.ts
packages/shared-domain/vitest.config.ts
packages/shared-types/dist/audit.d.ts
packages/shared-types/dist/auth.d.ts
packages/shared-types/dist/index.d.ts
packages/shared-types/dist/menu.d.ts
packages/shared-types/dist/money.d.ts
packages/shared-types/dist/order.d.ts
packages/shared-types/dist/payment.d.ts
packages/shared-types/dist/permissions.d.ts
packages/shared-types/dist/table.d.ts
packages/shared-types/dist/user.d.ts
packages/shared-types/src/audit.ts
packages/shared-types/src/auth.ts
packages/shared-types/src/index.ts
packages/shared-types/src/menu.ts
packages/shared-types/src/money.ts
packages/shared-types/src/order.ts
packages/shared-types/src/payment.ts
packages/shared-types/src/permissions.test.ts
packages/shared-types/src/permissions.ts
packages/shared-types/src/table.ts
packages/shared-types/src/user.ts
packages/shared-ui/src/index.ts
```

---

## 3. Migration Durumu

### ls packages/db/migrations/
```
NOT FOUND: apps/api/src/db/migrations/ (bu path yok)
GERÇEK KONUM: packages/db/migrations/

000_init.sql         (18319 bytes, 2026-04-26)
001_fix_enum_values.sql (931 bytes, 2026-04-25)
002_add_refresh_tokens.sql (2213 bytes, 2026-04-25)
003_users_add_email.sql (471 bytes, 2026-04-25)
```

### packages/db/migrations/001_fix_enum_values.sql
```sql
-- 001_fix_enum_values.sql
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'partially_served' AFTER 'sent_to_kitchen';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'billed' AFTER 'served';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'void' AFTER 'cancelled';
ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'transfer';
ALTER TYPE payment_scope RENAME VALUE 'full_order' TO 'full';
ALTER TYPE payment_scope RENAME VALUE 'split_item' TO 'item';
ALTER TYPE payment_scope RENAME VALUE 'equal_split' TO 'partial';
```

### packages/db/migrations/002_add_refresh_tokens.sql
```sql
CREATE TABLE refresh_tokens (
  id              UUID        PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id         UUID        NOT NULL,
  token_hash      BYTEA       NOT NULL,
  parent_id       UUID        NULL REFERENCES refresh_tokens(id),
  family_id       UUID        NOT NULL,
  device_label    TEXT        NULL,
  user_agent      TEXT        NULL,
  ip_address      INET        NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  last_used_at    TIMESTAMPTZ NULL,
  revoked_at      TIMESTAMPTZ NULL,
  revoked_reason  TEXT        NULL,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id),
  CONSTRAINT refresh_tokens_token_hash_uq UNIQUE (token_hash)
);
```

### packages/db/migrations/003_users_add_email.sql
```sql
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX users_tenant_email_ci_idx ON users (tenant_id, lower(email));
```

---

## 4. Mevcut Endpoint'ler

### find apps/api/src/routes -name "*.ts" | sort
```
apps/api/src/routes/auth.ts
apps/api/src/routes/index.ts
```

**Kayıtlı route'lar (app.ts'den):**
- `GET /health`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

**Başka route yok** — tables, menu, orders, users endpoint'leri henüz yazılmamış.

---

## 5. Middleware ve Altyapı

**Mevcut middleware:**
- `authenticate.ts` — Bearer token → req.user
- `authorize.ts` — Role-based access (UserRole[])
- `validate.ts` — zod schema → req.body
- `errorHandler.ts` — ADR-006 §2 merkezi error handler

**Altyapı:**
- `logger.ts` — pino, redact PII paths, safeErrSerializer
- `errors.ts` — ErrorEnvelope, AuthError, toHttpError, AUTH_MESSAGE_KEYS

---

## 6. Test Durumu

### pnpm test (tail -50)
```
@restoran-pos/shared-domain:test:  ✓ src/menu.test.ts (5 tests) 25ms
@restoran-pos/shared-domain:test:  ✓ src/user.test.ts (20 tests) 58ms
@restoran-pos/shared-domain:test:  ✓ src/tax.test.ts (12 tests) 39ms
@restoran-pos/shared-domain:test:  ✓ src/order.test.ts (12 tests) 29ms
@restoran-pos/shared-domain:test:  ✓ src/table.test.ts (12 tests) 41ms
@restoran-pos/shared-domain:test:  ✓ src/order-no.test.ts (10 tests) 64ms
@restoran-pos/shared-domain:test:  ✓ src/payment.test.ts (20 tests) 106ms
@restoran-pos/shared-domain:test:  ✓ src/validation.test.ts (13 tests) 92ms
@restoran-pos/shared-domain:test:  ✓ src/audit/sanitizer.test.ts (19 tests) 64ms
@restoran-pos/shared-domain:test:  ✓ src/money.test.ts (16 tests) 342ms
@restoran-pos/shared-domain:test: Test Files  10 passed (10)
@restoran-pos/shared-domain:test:       Tests  139 passed (139)

@restoran-pos/db:test:  ↓ src/repositories/__tests__/users.test.ts (4 tests | 4 skipped)
@restoran-pos/db:test:  ↓ src/repositories/__tests__/tables.test.ts (3 tests | 3 skipped)
@restoran-pos/db:test:  ↓ src/repositories/__tests__/refresh-tokens.test.ts (4 tests | 4 skipped)
@restoran-pos/db:test: Test Files  3 skipped (3)
@restoran-pos/db:test:       Tests  11 skipped (11)
(DATABASE_URL yoksa skip — beklenen davranış)

@restoran-pos/api:test:  ✓ src/errors.test.ts (7 tests) 32ms
@restoran-pos/api:test:  ↓ src/audit/writeAudit.test.ts (2 tests | 2 skipped)
@restoran-pos/api:test:  ↓ src/__tests__/auth.test.ts (6 tests | 6 skipped)
@restoran-pos/api:test: Test Files  1 passed | 2 skipped (3)
@restoran-pos/api:test:       Tests  7 passed | 8 skipped (15)
(DB gerektiren testler DATABASE_URL olmadan skip)

Tasks: 27 successful, 27 total
WARNING: no output files found for task @restoran-pos/db#build
WARNING: no output files found for task @restoran-pos/shared-domain#build
```

**Test dosyaları (proje kodu, node_modules hariç):**
```
apps/api/src/__tests__/auth.test.ts
apps/api/src/audit/writeAudit.test.ts
apps/api/src/errors.test.ts
packages/db/src/repositories/__tests__/refresh-tokens.test.ts
packages/db/src/repositories/__tests__/tables.test.ts
packages/db/src/repositories/__tests__/users.test.ts
packages/shared-domain/src/audit/sanitizer.test.ts
packages/shared-domain/src/menu.test.ts
packages/shared-domain/src/money.test.ts
packages/shared-domain/src/order-no.test.ts
packages/shared-domain/src/order.test.ts
packages/shared-domain/src/payment.test.ts
packages/shared-domain/src/table.test.ts
packages/shared-domain/src/tax.test.ts
packages/shared-domain/src/user.test.ts
packages/shared-domain/src/validation.test.ts
packages/shared-types/src/permissions.test.ts
```

---

## 7. Build Durumu

### pnpm build (tail -30)
```
@restoran-pos/api:build:     > tsc --noEmit   ✓ (typecheck, no errors)
@restoran-pos/print-agent:build: > tsc --noEmit  ✓
@restoran-pos/web:build:     > vite build
  dist/index.html                  0.40 kB │ gzip:  0.27 kB
  dist/assets/index-Cw587vwx.css   5.70 kB │ gzip:  1.69 kB
  dist/assets/index-CvY7AAVI.js  194.57 kB │ gzip: 62.35 kB
  ✓ built in 7.82s

Tasks:    8 successful, 8 total
Cached:   3 cached, 8 total
Time:     11.686s

WARNING: no output files found for @restoran-pos/api#build
WARNING: no output files found for @restoran-pos/mobile#build
WARNING: no output files found for @restoran-pos/print-agent#build
WARNING: no output files found for @restoran-pos/shared-ui#build
```

---

## 8. CI Durumu

### .github/workflows/ (3 dosya)

**ci.yml** — ana CI pipeline:
- Trigger: push to main, pull_request
- Steps: checkout → node (nvmrc) → pnpm → cache → install → audit-log guard → `pnpm turbo run typecheck lint test build`
- Audit log INSERT guard: `writeAudit.ts` dışında direct `INSERT INTO audit_logs` yasak

**migration-check.yml** — DB migration CI:
- Trigger: push/PR on `packages/db/**`
- Services: postgres:17
- Steps: migrate → codegen → `git diff --exit-code packages/db/src/generated.ts`

**setup-secrets.yml** — reusable workflow (secret masking)

---

## 9. Bağımlılık Durumu

### package.json (root)
```json
{
  "name": "restoran-pos-v5",
  "type": "module",
  "engines": { "node": ">=22.11.0 <23.0.0", "pnpm": ">=9.0.0 <10.0.0" },
  "packageManager": "pnpm@9.15.9",
  "scripts": { "build": "turbo run build", "typecheck": "turbo run typecheck", "lint": "turbo run lint", "test": "turbo run test", "dev": "turbo run dev" },
  "devDependencies": { "@eslint/js": "^9.18.0", "eslint": "^9.18.0", "turbo": "latest", "typescript": "^5.7.0", "typescript-eslint": "^8.20.0" }
}
```

### pnpm-workspace.yaml
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### apps/api/package.json — dependencies
```
express ^5.1.0, helmet ^8.0.0, cors ^2.8.5, cookie-parser ^1.4.7
jsonwebtoken ^9.0.2, bcryptjs ^2.4.3
pg ^8.13.0, kysely ^0.27.0
pino ^9.6.0, zod ^3.23.8
express-rate-limit ^7.4.1, dotenv ^16.5.0
@restoran-pos/db, @restoran-pos/shared-domain, @restoran-pos/shared-types (workspace)
```

---

## 10. Gözlemler (ham, yorum değil)

- `git status`: local main, origin'den **7 commit ileride** (squash merge diverge pattern, her PR sonrası oluşuyor)
- `000_init.sql` SECTION 3 ENUMS: `payment_scope AS ENUM ('full_order','split_item','equal_split')` — 001 migration bunları rename ediyor
- `001_fix_enum_values.sql`: `RENAME VALUE` kullanıyor; `decisions.md §9.3` "RENAME VALUE: yasak" diyor (çelişki)
- Aktif route sayısı: 5 (4 auth + 1 health). Tables/menu/orders endpoint yok
- DB testleri (11 adet) `DATABASE_URL` olmadan skip ediliyor
- API auth testleri (6 adet) `DATABASE_URL` olmadan skip ediliyor
- `turbo.json` `outputs` key eksik: 4 paket için "no output files found" WARNING
- `apps/mobile/`, `apps/print-agent/`, `packages/shared-ui/` dizinleri var ama içerik minimal (iskelet)
- `docs/engineering/active-plan.md` ve `docs/engineering/decisions.md` path'leri **yok** — gerçek konumlar `.claude/plans/active-plan.md` ve `.claude/memory/decisions.md`
