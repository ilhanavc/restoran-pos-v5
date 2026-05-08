# E2E Smoke Suite (Sprint 9)

Playwright-tabanlı UI smoke testleri. Kapsam ve kararlar: [ADR-019](../../../.claude/memory/decisions.md#adr-019).

## Hızlı bakış

- **Framework**: Playwright (Chromium-only, MVP)
- **Worker**: 1 (paylaşılan postgres state)
- **Seed**: kysely direct → `truncateAndSeed` her run başında çalışır
- **Auth**: `globalSetup` admin + cashier `storageState.json` üretir; S1 hariç tüm senaryolar bunu kullanır

## Kasıtlı kapsam dışı (Sprint 10+)

- Visual regression (`toHaveScreenshot`) — ADR-019 §6
- WebKit/Firefox browser matrix — ADR-019 §5
- Parallel worker > 1 — ADR-019 §5

## Lokal kurulum (ilk seferinde tek sefer)

E2E **ayrı bir DB** kullanır (`pos_e2e`). `pos_dev` truncate edilirse dev verisi silinir → seed fail-fast atar (ADR-019 §3.1).

```bash
# 1) E2E DB oluştur
createdb pos_e2e

# 2) Migration'ları E2E DB'ye uygula
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pos_e2e \
  pnpm --filter @restoran-pos/db migrate

# 3) Playwright Chromium binary'sini indir
pnpm --filter @restoran-pos/web e2e:install
```

## Lokal koşum

API ve web preview ayrı portlarda ayağa kaldırılır (dev sunucularla çakışmasın):

```bash
# Terminal 1 — API (port 4001)
cd apps/api
PORT=4001 \
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pos_e2e \
JWT_ACCESS_SECRET=e2e-test-secret-min-32-characters-long-xx \
TENANT_ID=00000000-0000-7000-8000-000000000001 \
WEB_ORIGIN=http://localhost:4173 \
DISABLE_CRON=1 NODE_ENV=test \
pnpm dev

# Terminal 2 — Web preview (port 4173)
cd apps/web
pnpm build && pnpm exec vite preview --port 4173 --strictPort

# Terminal 3 — Smoke suite
cd apps/web
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pos_e2e pnpm e2e
```

Görsel debug: `pnpm e2e:headed` (browser açar) veya `pnpm e2e:debug` (Playwright Inspector).

Rapor: `pnpm e2e:report`.

## CI

`.github/workflows/e2e.yml` her PR'da çalışır. Postgres service container ephemeral olduğu için CI'de `pos_dev` ismi reuse edilir; guard CI=true olduğu için bypass eder.

## Klasör yapısı

```
apps/web/e2e/
├── README.md                  # bu dosya
├── global-setup.ts            # seed + storageState
├── fixtures/
│   ├── seed.ts                # kysely direct truncate + insert
│   └── auth.setup.ts          # API'den login, storageState yarat
├── helpers/
│   └── test-data.ts           # sabit UUID'ler, env override
└── tests/
    └── s1-login.spec.ts       # S1 (Sprint 9)
                               # S2-S5 (Görev 38) ayrı PR'da gelir
```

## Senaryo eklenmesi

Yeni senaryo → `tests/s{N}-{ad}.spec.ts`. Pattern S1'de tanımlı:
- `test.use({ storageState: ADMIN_STORAGE_PATH })` (login akışını atla)
- Locator önceliği: `id` > `getByRole` + accessible name > Türkçe text regex
- Hardcoded i18n string yerine `t('xxx')` çıktısına regex match (örn. `/Giriş Yap/`)

ADR-019 §1: smoke kapsamı 5 senaryo lock'lu. Yeni senaryo → ADR amendment + sprint planı satırı zorunlu.
