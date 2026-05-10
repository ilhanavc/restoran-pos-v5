/**
 * S4 — Kullanıcı CRUD + login fail smoke (ADR-019 §1 Amendment 2026-05-08).
 *
 * Akış:
 *   1. Admin UI login
 *   2. SPA nav /users
 *   3. "Yeni kullanıcı" → drawer → email/name/role/password → "Oluştur"
 *      (POST /users 201)
 *   4. Toast "Kullanıcı oluşturuldu" + user row görünür (data-testid)
 *   5. Trash button (card-scoped aria-label "Sil") → confirm dialog
 *      → "Kalıcı sil" → DELETE /users/:id 204 (Migration 018 hard delete)
 *   6. Toast "Kullanıcı silindi" + row kayboldu
 *   7. POST /auth/login (silinen user creds) → 401 (revoke)
 *
 * Locator stratejisi:
 *   - Stable id: #user-email, #user-name, #user-role (select), #user-password
 *   - Row scope: [data-testid="user-row"][data-user-email="..."]
 *   - Card-içi click: clickButtonInScopeByAriaLabel (seed.ts 3 user yaratıyor)
 *   - Top-level dialog: clickButtonByText global
 */

import { test, expect, request as pwRequest } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE_URL } from '../helpers/test-data';
import {
  loginViaUI,
  spaNavigate,
  clickButtonByText,
  clickButtonInScopeByAriaLabel,
} from '../helpers/auth-login';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

const TEST_EMAIL = 's4-test-user@e2e.test';
const TEST_NAME = 'S4 Test';
const TEST_PASSWORD = 'TestPass1234';

test.describe('S4 — Kullanıcı CRUD + login fail', () => {
  test('oluştur → sil (hard) → silinen user login → 401', async ({ page }) => {
    await loginViaUI(page, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    await spaNavigate(page, '/users');
    await expect(page).toHaveURL(/\/users$/, { timeout: 5_000 });
    await expect(
      page.getByRole('heading', { name: 'Kullanıcılar' }),
    ).toBeVisible({ timeout: 10_000 });

    // 3. Yeni kullanıcı drawer (top-level — global click OK)
    await clickButtonByText(page, 'Yeni kullanıcı');
    await expect(page.locator('#user-email')).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('#user-email').fill(TEST_EMAIL);
    await page.locator('#user-name').fill(TEST_NAME);
    await page.locator('#user-role').selectOption('cashier');
    await page.locator('#user-password').fill(TEST_PASSWORD);

    const createReq = page.waitForResponse(
      (r) => r.url().endsWith('/users') && r.request().method() === 'POST',
    );
    await clickButtonByText(page, 'Oluştur');
    expect((await createReq).status()).toBe(201);
    await expect(page.getByText('Kullanıcı oluşturuldu')).toBeVisible({
      timeout: 10_000,
    });

    // 4. Row görünür (data-testid + data-user-email)
    const rowSelector = `[data-testid="user-row"][data-user-email="${TEST_EMAIL}"]`;
    const row = page.locator(rowSelector);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toHaveCount(1);

    // 5. Sil — Trash icon (card-scoped aria-label "Sil")
    await clickButtonInScopeByAriaLabel(page, rowSelector, 'Sil');
    await expect(page.getByText('Kullanıcıyı kalıcı sil')).toBeVisible({
      timeout: 10_000,
    });

    const deleteReq = page.waitForResponse(
      (r) => r.url().includes('/users/') && r.request().method() === 'DELETE',
    );
    // Confirm dialog "Kalıcı sil" — top-level, global click OK
    await clickButtonByText(page, 'Kalıcı sil');
    expect((await deleteReq).status()).toBe(204);
    await expect(page.getByText('Kullanıcı silindi')).toBeVisible({
      timeout: 10_000,
    });
    await expect(row).toBeHidden({ timeout: 10_000 });

    // 6. Silinen user login dener → 401 (Migration 018 hard delete; tüm
    //    refresh token'lar revoke + user satırı yok → invalid credentials).
    const apiCtx = await pwRequest.newContext({ baseURL: API_BASE_URL });
    const loginRes = await apiCtx.post('/auth/login', {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loginRes.status(), 'silinen user login').toBe(401);
    await apiCtx.dispose();
  });
});
