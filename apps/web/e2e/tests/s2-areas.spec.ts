/**
 * S2 — Salon Bölgeleri CRUD smoke (ADR-019 §1 + Amendment 2026-05-08).
 *
 * Akış:
 *   1. Admin UI login
 *   2. SPA nav /tanimlamalar/salon-bolgeleri
 *   3. "Yeni bölge" dialog → name "S2 Test Bölge" + initial=0 → "Oluştur"
 *   4. Toast "Bölge oluşturuldu" + AreaCard görünür
 *   5. Card target=2 → "Uygula" (POST /areas/:id/sync-tables 200)
 *   6. "Adı düzenle" → input clear + "S2 Renamed" → "Kaydet"
 *   7. Card target=0 → "Uygula" (delete önkoşul)
 *   8. "Bölgeyi sil" → confirm "Sil"
 *
 * Önemli: seed.ts İç Salon area + 1 tablo (TABLE_1) yaratıyor — S2 area'sı
 * 2.'si. Card-bound click'ler MUTLAKA scope-aware (clickButtonInScope)
 * olmalı; global `clickButtonByText` ilk match'i alır → İç Salon kartına
 * bastırır → S6'da TABLE_1 kaybolması bug'ına yol açar.
 *
 * Locator stratejisi:
 *   - Stable id: #newArea-name, #newArea-initial
 *   - Card scope: data-testid="area-card" + data-area-name="..."
 *   - Card-içi click'ler: clickButtonInScope (parent locator)
 *   - Top-level dialog click'ler: clickButtonByText (global OK)
 */

import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/test-data';
import {
  loginViaUI,
  spaNavigate,
  clickButtonByText,
  clickButtonInScope,
  clickButtonInScopeByAriaLabel,
} from '../helpers/auth-login';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

test.describe('S2 — Salon Bölgeleri CRUD', () => {
  test('oluştur → sync 2 masa → ad düzenle → boşalt → sil', async ({
    page,
  }) => {
    await loginViaUI(page, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    await spaNavigate(page, '/tanimlamalar/salon-bolgeleri');
    await expect(page).toHaveURL(/\/salon-bolgeleri$/, { timeout: 5_000 });
    await expect(
      page.getByRole('heading', { name: 'Salon Bölgeleri' }),
    ).toBeVisible({ timeout: 10_000 });

    // 3. Yeni bölge dialog (top-level button — global click OK)
    await clickButtonByText(page, 'Yeni bölge');
    await expect(page.locator('#newArea-name')).toBeVisible();
    await page.locator('#newArea-name').fill('S2 Test Bölge');
    await page.locator('#newArea-initial').fill('0');

    const createReq = page.waitForResponse(
      (r) => r.url().endsWith('/areas') && r.request().method() === 'POST',
    );
    await clickButtonByText(page, 'Oluştur');
    expect((await createReq).status()).toBe(201);

    // 4. Card görünür (data-testid + data-area-name)
    await expect(page.getByText('Bölge oluşturuldu')).toBeVisible({
      timeout: 10_000,
    });
    const cardSelector =
      '[data-testid="area-card"][data-area-name="S2 Test Bölge"]';
    const card = page.locator(cardSelector);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toHaveCount(1);

    // 5. Sync target=2 — card-scoped click (İç Salon ile karışmasın)
    await card
      .getByRole('spinbutton', { name: 'Hedef masa sayısı' })
      .fill('2');

    const syncReq1 = page.waitForResponse(
      (r) =>
        r.url().includes('/areas/') &&
        r.url().endsWith('/sync-tables') &&
        r.request().method() === 'POST',
    );
    await clickButtonInScope(page, cardSelector, 'Uygula');
    expect((await syncReq1).status()).toBe(200);

    // 6. Ad düzenle (Pencil icon-only — card-scoped aria-label)
    await clickButtonInScopeByAriaLabel(page, cardSelector, 'Adı düzenle');
    const editInput = card.locator('input[aria-label="Adı düzenle"]');
    await expect(editInput).toBeVisible({ timeout: 10_000 });
    await editInput.fill('S2 Renamed');

    const updateReq = page.waitForResponse(
      (r) =>
        r.url().includes('/areas/') && r.request().method() === 'PATCH',
    );
    await clickButtonInScope(page, cardSelector, 'Kaydet');
    expect((await updateReq).status()).toBe(200);
    await expect(page.getByText('Bölge adı güncellendi')).toBeVisible({
      timeout: 10_000,
    });

    // Renamed selector — yeni data-area-name
    const renamedCardSelector =
      '[data-testid="area-card"][data-area-name="S2 Renamed"]';
    const renamedCard = page.locator(renamedCardSelector);
    await expect(renamedCard).toBeVisible({ timeout: 10_000 });
    await expect(renamedCard).toHaveCount(1);

    // 7. Boşalt — target=0 (delete önkoşul; card-scoped click)
    await renamedCard
      .getByRole('spinbutton', { name: 'Hedef masa sayısı' })
      .fill('0');
    const syncReq2 = page.waitForResponse(
      (r) =>
        r.url().includes('/areas/') &&
        r.url().endsWith('/sync-tables') &&
        r.request().method() === 'POST',
    );
    await clickButtonInScope(page, renamedCardSelector, 'Uygula');
    expect((await syncReq2).status()).toBe(200);

    // 8. Sil (Trash icon-only — card-scoped aria-label)
    await clickButtonInScopeByAriaLabel(
      page,
      renamedCardSelector,
      'Bölgeyi sil',
    );
    await expect(page.getByText('Bölge silinsin mi?')).toBeVisible();

    const deleteReq = page.waitForResponse(
      (r) =>
        r.url().includes('/areas/') && r.request().method() === 'DELETE',
    );
    // Confirm dialog "Sil" top-level — global click OK
    await clickButtonByText(page, 'Sil');
    expect((await deleteReq).status()).toBe(204);
    await expect(page.getByText('Bölge kaldırıldı')).toBeVisible({
      timeout: 10_000,
    });
    await expect(renamedCard).toBeHidden({ timeout: 10_000 });
  });
});
