/**
 * S4 — Kullanıcı oluştur → hard delete → login fail (ADR-019 §1 + ADR-009 amendment 2026-05-05).
 *
 * Route: /users (UsersPage)
 * UserDrawer: #user-email, #user-name, #user-role, #user-password
 * DeleteUserDialog: onConfirm → DELETE /users/:id (hard delete, Migration 018)
 *
 * Senaryo:
 *   1. Admin storageState ile /users'a git
 *   2. Yeni kullanıcı oluştur (cashier, smoke-user@e2e.test)
 *   3. Listede görünmeli
 *   4. Hard delete — listede artık yok
 *   5. Yeni context (no storageState) → /login → silinen email + şifreyle dene → 401 toast
 *
 * NOT: Hard delete sonrası backend 401 dönmeli (kullanıcı DB'de yok).
 *      "Soft delete" akışı ADR-009 amendment ile kaldırıldı.
 */

import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE_PATH, ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/test-data';

const SMOKE_EMAIL = 'smoke-user@e2e.test';
const SMOKE_NAME = 'Smoke User';
const SMOKE_PASSWORD = 'SmokeUser123!';

test.describe('S4 — Kullanıcı hard delete + login fail', () => {
  test('kullanıcı oluşturur, listede görür, hard delete, login dener → 401', async ({
    browser,
  }) => {
    // --- Adım 1-4: Admin context ile kullanıcı oluştur + sil ---
    const adminContext = await browser.newContext({
      storageState: ADMIN_STORAGE_PATH,
    });
    const adminPage = await adminContext.newPage();

    await adminPage.goto('/users');
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 8000,
    });

    // Yeni kullanıcı butonu
    await adminPage.getByRole('button', { name: /Yeni Kullanıcı|Kullanıcı Ekle/i }).click();

    // UserDrawer açılmalı
    await expect(adminPage.locator('#user-email')).toBeVisible({ timeout: 5000 });

    await adminPage.locator('#user-email').fill(SMOKE_EMAIL);
    await adminPage.locator('#user-name').fill(SMOKE_NAME);

    // Rol seçimi: cashier
    await adminPage.locator('#user-role').selectOption('cashier');

    // Şifre (create mode'da zorunlu)
    await adminPage.locator('#user-password').fill(SMOKE_PASSWORD);

    // Submit
    await adminPage.getByRole('button', { name: /Oluştur|Kaydet/i }).last().click();

    // Başarı: kullanıcı listede görünmeli
    await expect(adminPage.getByText(SMOKE_EMAIL)).toBeVisible({ timeout: 8000 });

    // Hard delete — satırdaki Trash2 (aria-label=admin.users.actions.delete)
    const userRow = adminPage.getByText(SMOKE_EMAIL).locator('..').locator('..');
    await userRow.getByRole('button', { name: /Sil/i }).click();

    // DeleteUserDialog onay
    const confirmBtn = adminPage.getByRole('button', { name: /Onayla|Sil|Evet/i }).last();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Listede artık yok
    await expect(adminPage.getByText(SMOKE_EMAIL)).not.toBeVisible({ timeout: 8000 });

    await adminContext.close();

    // --- Adım 5: Yeni (boş) context ile login fail ---
    const freshContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const loginPage = await freshContext.newPage();

    await loginPage.goto('/login');
    await expect(loginPage.locator('#email')).toBeVisible({ timeout: 8000 });

    await loginPage.locator('#email').fill(SMOKE_EMAIL);
    await loginPage.locator('#password').fill(SMOKE_PASSWORD);
    await loginPage.getByRole('button', { name: /Giriş Yap/i }).click();

    // 401 → hata tostu
    await expect(
      loginPage.getByText(/E-posta veya şifre hatalı|Geçersiz|hatalı/i),
    ).toBeVisible({ timeout: 8000 });

    // Dashboard'a gitmemiş olmalı
    await expect(loginPage).toHaveURL(/\/login$/);

    await freshContext.close();
  });

  test('mevcut admin kendi kendini silemez (self-delete disabled)', async ({
    browser,
  }) => {
    const adminContext = await browser.newContext({
      storageState: ADMIN_STORAGE_PATH,
    });
    const adminPage = await adminContext.newPage();

    await adminPage.goto('/users');
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 8000,
    });

    // Admin kendi satırındaki Sil butonu disabled olmalı
    // UsersPage: isSelf=true → disabled={isSelf}
    const adminRow = adminPage.getByText(ADMIN_EMAIL).locator('..').locator('..');
    const selfDeleteBtn = adminRow.getByRole('button', { name: /Sil/i });
    await expect(selfDeleteBtn).toBeDisabled({ timeout: 5000 });

    await adminContext.close();
  });
});
