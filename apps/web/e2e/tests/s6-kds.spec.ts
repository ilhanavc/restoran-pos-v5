/**
 * S6 — KDS (Kitchen Display) smoke (ADR-019 + ADR-020).
 *
 * Akış:
 *   1. Admin (API) dine_in sipariş yaratır — pide kalemli, MASA 1
 *   2. Backend POST hook: kitchen_print=true (Yemek) item → status='sent'
 *   3. Kitchen rolü UI'dan login → /kds — order kartı + pide görünür
 *   4. "Hazırlanıyor" → button kaybolur, sadece "Hazır" kalır (state preparing)
 *   5. "Hazır" → item line-through, data-status='ready'
 *
 * Auth: store/auth.ts Zustand `persist` kullanmıyor (in-memory). Dolayısıyla
 * storageState path'i app'i hydrate etmiyor — UI login zorunlu. Rate limit
 * (5/15dk/IP) E2E_BYPASS_LOGIN_LIMIT=1 ile bypass (e2e.yml + auth.ts).
 */

import { test, expect, request as pwRequest } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  KITCHEN_EMAIL,
  KITCHEN_PASSWORD,
  API_BASE_URL,
  TABLE_1_ID,
  PRODUCT_PIDE_ID,
} from '../helpers/test-data';

// Storage'ı sıfırla — UI login akışı.
test.use({ storageState: { cookies: [], origins: [] } });

// S6 retry kapalı: test side-effect (DB'de order yaratıyor); retry aynı
// TABLE_1_ID üzerinde 409 TABLE_ALREADY_OCCUPIED'a takılır.
test.describe.configure({ retries: 0 });

test.describe('S6 — KDS', () => {
  test('dine_in sipariş → KDS\'te görün → Hazırlanıyor → Hazır', async ({
    page,
  }) => {
    // 1. Admin login + dine_in order (API). Backend POST hook → pide
    //    (kitchen_print=true) status='sent' + kitchen.orderSent emit.
    const apiCtx = await pwRequest.newContext({ baseURL: API_BASE_URL });
    const adminLoginRes = await apiCtx.post('/auth/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(adminLoginRes.status(), 'admin login').toBe(200);
    const { accessToken: adminToken } = (await adminLoginRes.json()) as {
      accessToken: string;
    };

    const orderRes = await apiCtx.post('/orders', {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        tableId: TABLE_1_ID,
        orderType: 'dine_in',
        items: [{ productId: PRODUCT_PIDE_ID, quantity: 2 }],
      },
    });
    expect(orderRes.status(), 'POST /orders dine_in').toBe(201);
    await apiCtx.dispose();

    // 2. Kitchen UI login — Zustand auth in-memory.
    await page.goto('/login');
    await page.locator('#email').fill(KITCHEN_EMAIL);
    await page.locator('#password').fill(KITCHEN_PASSWORD);
    await page.getByRole('button', { name: /Giriş Yap/ }).click();
    // LoginPage success → /dashboard.
    await page.waitForURL(/\/dashboard$/, { timeout: 10_000 });

    // 3. KDS sayfasına git (kitchen rolü ProtectedRoute geçer).
    await page.goto('/kds');
    await expect(page).toHaveURL(/\/kds(\?.*)?$/, { timeout: 5_000 });

    // 4. Page yüklendi → ürün görünür.
    await expect(page.getByText('Karışık Pide')).toBeVisible({
      timeout: 15_000,
    });

    // Card kapsayıcı: pide içeren data-severity element.
    const card = page
      .locator('[data-severity]')
      .filter({ hasText: 'Karışık Pide' });
    await expect(card).toHaveCount(1);
    await expect(card.getByText(/Masa\s+MASA 1/i)).toBeVisible();

    // 5. "Hazırlanıyor" → button hidden (state='preparing').
    const preparingBtn = card.getByRole('button', { name: /^Hazırlanıyor$/ });
    await expect(preparingBtn).toBeVisible();
    await preparingBtn.click();
    await expect(preparingBtn).toBeHidden({ timeout: 10_000 });

    // 6. "Hazır" → data-status='ready', line-through.
    const readyBtn = card.getByRole('button', { name: /^Hazır$/ });
    await expect(readyBtn).toBeVisible();
    await readyBtn.click();

    const readyItem = card.locator('[data-status="ready"]');
    await expect(readyItem).toBeVisible({ timeout: 10_000 });
    await expect(readyItem).toHaveCount(1);
  });
});
