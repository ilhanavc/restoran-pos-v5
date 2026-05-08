import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — Sprint 9 Görev 37 (ADR-019).
 *
 * - baseURL: env override; default vite preview (4173)
 * - workers: 1 (paralelizm yok — paylaşılan postgres state)
 * - chromium-only smoke (Sprint 9). Webkit/Firefox + visual reg → Sprint 10+
 * - storageState test-level: her spec kendi `.auth/*.json`'ı kullanır
 * - global-setup: DB seed + admin/cashier auth state üret
 */

const isCI = process.env['CI'] === 'true' || process.env['CI'] === '1';

export default defineConfig({
  testDir: './e2e/tests',
  // ESM mode (apps/web package.json "type": "module") — `require.resolve` yok.
  // Playwright 1.30+ globalSetup string path destekler; relative path yeterli.
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  reporter: isCI ? [['html', { open: 'never' }], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
