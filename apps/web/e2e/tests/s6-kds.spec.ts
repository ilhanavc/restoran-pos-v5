/**
 * S6 — KDS (Kitchen Display) smoke (ADR-019 + ADR-020).
 *
 * Akış:
 *   1. Admin (API üzerinden) dine_in sipariş yaratır — pide kalemli, MASA 1
 *   2. Backend POST hook: kitchen_print=true (Yemek) item → status='sent'
 *   3. Kitchen rolü /kds sayfasına gider — order kartı + pide görünür
 *   4. "Hazırlanıyor" → button kaybolur, sadece "Hazır" kalır (state preparing)
 *   5. "Hazır" → item line-through, data-status='ready'
 *
 * Pre-condition: globalSetup seed kitchen kullanıcısı + Yemek/İçecek
 * kitchen_print kategorileri seed eder (PR-3d).
 */

import { test, expect, request as pwRequest } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  KITCHEN_STORAGE_PATH,
  API_BASE_URL,
  TABLE_1_ID,
  PRODUCT_PIDE_ID,
} from '../helpers/test-data';

test.use({ storageState: KITCHEN_STORAGE_PATH });

test.describe('S6 — KDS', () => {
  test('dine_in sipariş → KDS\'te görün → Hazırlanıyor → Hazır', async ({
    page,
  }) => {
    // 1. Admin token al + dine_in order yarat (Karışık Pide × 2, MASA 1).
    //    Backend POST hook (orders.ts) → kitchen_print=true items'a status='sent'
    //    set + kitchen.orderSent emit.
    const apiCtx = await pwRequest.newContext({ baseURL: API_BASE_URL });

    const loginRes = await apiCtx.post('/auth/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loginRes.status(), 'admin login').toBe(200);
    const loginJson = (await loginRes.json()) as { accessToken: string };

    const orderRes = await apiCtx.post('/orders', {
      headers: {
        Authorization: `Bearer ${loginJson.accessToken}`,
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

    // 2. Kitchen olarak /kds. storageState ile yetki var; route gardı geçer.
    await page.goto('/kds');

    // 3. Sipariş kartı + pide görünür. data-severity attribute KDS card root.
    const card = page.locator('[data-severity]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText('Karışık Pide')).toBeVisible();
    // Header "Masa MASA 1" — t('kds.card.tablePrefix', { code: 'MASA 1' }).
    await expect(card.getByText(/Masa\s+MASA 1/i)).toBeVisible();

    // 4. "Hazırlanıyor" → button kaybolur (state='preparing').
    const preparingBtn = card.getByRole('button', { name: /^Hazırlanıyor$/ });
    await expect(preparingBtn).toBeVisible();
    await preparingBtn.click();
    await expect(preparingBtn).toBeHidden({ timeout: 10_000 });

    // 5. "Hazır" → item line-through, data-status='ready'.
    const readyBtn = card.getByRole('button', { name: /^Hazır$/ });
    await expect(readyBtn).toBeVisible();
    await readyBtn.click();

    const readyItem = card.locator('[data-status="ready"]');
    await expect(readyItem).toBeVisible({ timeout: 10_000 });
    await expect(readyItem).toHaveCount(1);
  });
});
