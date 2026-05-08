/**
 * E2E sabit test verileri (ADR-019 §3).
 *
 * DB reuse: aynı tenant_id + user UUID'leri her run'da. Idempotent seed
 * (TRUNCATE → INSERT) bu sabitlere dayanır. Env override mümkün ama
 * default'lar kasıtlı sabit — debugging predictable.
 */

export const TEST_TENANT_ID =
  process.env['E2E_TENANT_ID'] ?? '00000000-0000-7000-8000-000000000001';

export const ADMIN_USER_ID =
  process.env['E2E_ADMIN_USER_ID'] ?? '00000000-0000-7000-8000-0000000000a1';

export const CASHIER_USER_ID =
  process.env['E2E_CASHIER_USER_ID'] ?? '00000000-0000-7000-8000-0000000000a2';

export const ADMIN_EMAIL =
  process.env['E2E_ADMIN_EMAIL'] ?? 'admin@e2e.test';
export const ADMIN_PASSWORD =
  process.env['E2E_ADMIN_PASSWORD'] ?? 'AdminPass123!';

export const CASHIER_EMAIL =
  process.env['E2E_CASHIER_EMAIL'] ?? 'cashier@e2e.test';
export const CASHIER_PASSWORD =
  process.env['E2E_CASHIER_PASSWORD'] ?? 'CashierPass123!';

/**
 * API URL'i: API doğrudan endpoint çağrıları için (auth setup'ta storageState
 * yaratırken kullanılır). Web baseURL'inden ayrı, çünkü preview proxy yok.
 */
export const API_BASE_URL =
  process.env['E2E_API_URL'] ?? 'http://localhost:4001';

/**
 * Web baseURL — Playwright config kendi baseURL'ini bu env'den de okur.
 */
export const WEB_BASE_URL =
  process.env['E2E_BASE_URL'] ?? 'http://localhost:4173';

/**
 * DB connection string — global-setup seed için.
 *
 * Default: `pos_e2e` (ADR-019 §3.1). Lokal'da `pos_dev` truncate edilirse
 * dev verisi silinir — seed.ts guard fail-fast atar (CI dışı + pos_dev|pos_main).
 *
 * CI: workflow `DATABASE_URL=...pos_dev` set eder; CI=true olduğu için guard
 * by-pass eder (postgres service container ephemeral).
 *
 * İlk lokal kurulum: bkz. apps/web/e2e/README.md
 */
export const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/pos_e2e';

/** auth/storage dizinleri — gitignore'da. */
export const AUTH_DIR = './e2e/.auth';
export const ADMIN_STORAGE_PATH = `${AUTH_DIR}/admin.json`;
export const CASHIER_STORAGE_PATH = `${AUTH_DIR}/cashier.json`;

/** Sabit kategori/ürün UUID'leri (Sprint 10+ S2-S5 için stabil hedef). */
export const CATEGORY_FOOD_ID = '00000000-0000-7000-8000-000000000b21';
export const CATEGORY_DRINK_ID = '00000000-0000-7000-8000-000000000b22';

export const PRODUCT_PIDE_ID = '00000000-0000-7000-8000-000000000b31';
export const PRODUCT_AYRAN_ID = '00000000-0000-7000-8000-000000000b32';

export const AREA_INSIDE_ID = '00000000-0000-7000-8000-000000000b41';
export const TABLE_1_ID = '00000000-0000-7000-8000-000000000b51';
