/**
 * Playwright globalSetup (ADR-019 §3-4).
 *
 * Sıra:
 *   1. DB seed (truncateAndSeed) — tenant + admin/cashier + minimum menü
 *   2. Auth state üretimi — admin + cashier `.auth/*.json`
 *
 * Hata varsa fail-fast: test koşusu hiç başlamaz.
 */

import { truncateAndSeed } from './fixtures/seed';
import { buildAuthStates } from './fixtures/auth.setup';
import { DATABASE_URL } from './helpers/test-data';

export default async function globalSetup(): Promise<void> {
  console.log('[e2e] global-setup: seeding DB...');
  await truncateAndSeed(DATABASE_URL);

  console.log('[e2e] global-setup: building auth states...');
  await buildAuthStates();

  console.log('[e2e] global-setup: done.');
}
