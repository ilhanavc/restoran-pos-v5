/**
 * S1 — Login senaryosu (ADR-019 §2).
 *
 * UI'dan login → /dashboard'a yönlendir. Bu test:
 *  - Hem altyapıyı validate eder (seed + API + web preview ayakta)
 *  - Hem S2-S5 senaryoları için locator pattern template'i sunar
 *
 * S1 storageState kullanmaz — login akışını bizzat test eder.
 */

import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/test-data';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('S1 — Login', () => {
  test('admin başarılı login → dashboard', async ({ page }) => {
    await page.goto('/login');

    // Form alanları — id'lerle bağlı (LoginPage.tsx).
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();

    await page.locator('#email').fill(ADMIN_EMAIL);
    await page.locator('#password').fill(ADMIN_PASSWORD);

    // Submit butonu i18n: 'auth.login.submit' = 'Giriş Yap'
    const submit = page.getByRole('button', { name: /Giriş Yap/ });
    await expect(submit).toBeEnabled();
    await submit.click();

    // /dashboard'a yönlenmeli (LoginPage navigate replace).
    await page.waitForURL(/\/dashboard$/);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('hatalı şifre → 401 → toast hata mesajı', async ({ page }) => {
    await page.goto('/login');

    await page.locator('#email').fill(ADMIN_EMAIL);
    await page.locator('#password').fill('YanlisSifre123!');

    await page.getByRole('button', { name: /Giriş Yap/ }).click();

    // Sonner toast role=status — "E-posta veya şifre hatalı"
    await expect(
      page.getByText(/E-posta veya şifre hatalı|Geçersiz/i),
    ).toBeVisible({ timeout: 5000 });

    // /dashboard'a gitmemiş olmalı
    await expect(page).toHaveURL(/\/login$/);
  });
});
