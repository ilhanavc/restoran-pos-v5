/**
 * S3 — Menü kategori CRUD smoke (ADR-019 §1 + Amendment 4 2026-05-10).
 *
 * Akış:
 *   1. Admin UI login
 *   2. SPA nav /tanimlamalar/menu-tanimlari
 *   3. "Yeni kategori" → drawer → name "S3 Test Kategori" → Kaydet (POST 201)
 *   4. Toast "Kategori oluşturuldu" + listede görünür
 *   5. 3-dot menü → "Düzenle" → drawer → name "S3 Renamed" → Kaydet (PATCH 200)
 *   6. Toast "Kategori güncellendi" + liste isim güncellenir
 *   7. 3-dot menü → "Kategoriyi sil" → confirm "Sil" (DELETE 204)
 *   8. Toast "Kategori silindi" + listeden kaybolur
 *
 * Scope kararı (Amendment 4): Ürün CRUD + variant CRUD Sprint 10+ E2E
 * backlog. Smoke essence kategori CRUD'da (drawer + Radix DropdownMenu +
 * DeleteDialog).
 *
 * Locator stratejisi:
 *   - Page: getByRole('heading', 'Menü Tanımları')
 *   - Stable id: #category-name (CategoryDrawer input)
 *   - Card scope: data-testid="category-item" + data-category-name
 *   - Card-içi 3-dot: clickButtonInScopeByAriaLabel (seed.ts 2 kategori yaratıyor)
 *   - DropdownMenu item'ları Portal'da: global click OK (tek dropdown açık)
 */

import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/test-data';
import {
  loginViaUI,
  spaNavigate,
  clickButtonByText,
  clickButtonInScopeByAriaLabel,
} from '../helpers/auth-login';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

test.describe('S3 — Menü kategori CRUD', () => {
  test('oluştur → düzenle → sil', async ({ page }) => {
    await loginViaUI(page, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    await spaNavigate(page, '/tanimlamalar/menu-tanimlari');
    await expect(page).toHaveURL(/\/menu-tanimlari$/, { timeout: 5_000 });
    await expect(
      page.getByRole('heading', { name: 'Menü Tanımları' }),
    ).toBeVisible({ timeout: 10_000 });

    // 3. Yeni kategori drawer
    await clickButtonByText(page, 'Yeni kategori');
    await expect(page.locator('#category-name')).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('#category-name').fill('S3 Test Kategori');

    const createReq = page.waitForResponse(
      (r) =>
        r.url().endsWith('/menu/categories') &&
        r.request().method() === 'POST',
    );
    await clickButtonByText(page, 'Kaydet');
    expect((await createReq).status()).toBe(201);

    // 4. Listede görünür (data-testid + data-category-name)
    const itemSelector =
      '[data-testid="category-item"][data-category-name="S3 Test Kategori"]';
    const item = page.locator(itemSelector);
    await expect(item).toBeVisible({ timeout: 10_000 });
    await expect(item).toHaveCount(1);

    // 5. 3-dot menü → Düzenle (card-scoped 3-dot, global menu item)
    await clickButtonInScopeByAriaLabel(
      page,
      itemSelector,
      'Kategori menüsünü aç',
    );
    await clickButtonByText(page, 'Düzenle'); // dropdown menu item Portal'da

    // Drawer edit mode — name override
    await expect(page.locator('#category-name')).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('#category-name').fill('S3 Renamed');

    const updateReq = page.waitForResponse(
      (r) =>
        r.url().includes('/menu/categories/') &&
        r.request().method() === 'PATCH',
    );
    await clickButtonByText(page, 'Kaydet');
    expect((await updateReq).status()).toBe(200);

    // 6. Liste güncellenmiş (data-category-name)
    const renamedSelector =
      '[data-testid="category-item"][data-category-name="S3 Renamed"]';
    const renamedItem = page.locator(renamedSelector);
    await expect(renamedItem).toBeVisible({ timeout: 10_000 });

    // 7. Sil — 3-dot scope-aware → "Kategoriyi sil" portal item → confirm "Sil"
    await clickButtonInScopeByAriaLabel(
      page,
      renamedSelector,
      'Kategori menüsünü aç',
    );
    await clickButtonByText(page, 'Kategoriyi sil');
    await expect(page.getByText('Kategori silinsin mi?')).toBeVisible({
      timeout: 10_000,
    });

    const deleteReq = page.waitForResponse(
      (r) =>
        r.url().includes('/menu/categories/') &&
        r.request().method() === 'DELETE',
    );
    await clickButtonByText(page, 'Sil');
    expect((await deleteReq).status()).toBe(204);

    // 8. Listeden kayboldu
    await expect(renamedItem).toBeHidden({ timeout: 10_000 });
  });
});
