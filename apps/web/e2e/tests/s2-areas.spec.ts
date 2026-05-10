/**
 * S2 — Salon Bölgeleri CRUD smoke (ADR-019 §1 + Amendment 2026-05-08).
 *
 * Akış:
 *   1. Admin UI login
 *   2. SPA nav /tanimlamalar/salon-bolgeleri
 *   3. "Yeni bölge" dialog → name "S2 Test Bölge" + initial=0 → "Oluştur"
 *   4. Toast "Bölge oluşturuldu" + AreaCard görünür
 *   5. Card target=2 → "Uygula" → toast "2 masa eklendi"
 *   6. "Adı düzenle" → input clear + "S2 Renamed" → "Kaydet" → toast
 *   7. Card target=0 → "Uygula" (delete önkoşul; backend dolu masa varken
 *      delete reject)
 *   8. "Bölgeyi sil" → confirm "Sil" → toast "Bölge kaldırıldı" → card kayboldu
 *
 * Locator: stable id (#newArea-name, #newArea-initial), Türkçe getByRole
 * (newAreaButton/applyButton/deleteButton aria-label ya da text), card
 * scope getByText filter.
 *
 * Native click (clickButtonByText helper): Sidebar useLiveClock 1sn timer
 * Playwright stability check'i devre dışı bırakıyor.
 */

import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/test-data';
import {
  loginViaUI,
  spaNavigate,
  clickButtonByText,
  clickButtonByAriaLabel,
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

    // 3. Yeni bölge dialog (Sidebar useLiveClock 1sn timer; native click)
    await clickButtonByText(page, 'Yeni bölge');
    await expect(page.locator('#newArea-name')).toBeVisible();
    await page.locator('#newArea-name').fill('S2 Test Bölge');
    await page.locator('#newArea-initial').fill('0');

    const createReq = page.waitForResponse(
      (r) => r.url().endsWith('/areas') && r.request().method() === 'POST',
    );
    await clickButtonByText(page, 'Oluştur');
    expect((await createReq).status()).toBe(201);

    // 4. Card görünür
    await expect(page.getByText('Bölge oluşturuldu')).toBeVisible({
      timeout: 10_000,
    });
    const card = page.locator(
      '[data-testid="area-card"][data-area-name="S2 Test Bölge"]',
    );
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toHaveCount(1);

    // 5. Sync target=2
    const targetInput = card.getByRole('spinbutton', {
      name: 'Hedef masa sayısı',
    });
    await targetInput.fill('2');

    const syncReq1 = page.waitForResponse(
      (r) =>
        r.url().includes('/areas/') &&
        r.url().endsWith('/sync-tables') &&
        r.request().method() === 'POST',
    );
    await clickButtonByText(page, 'Uygula');
    expect((await syncReq1).status()).toBe(200);
    await expect(page.getByText('2 masa eklendi')).toBeVisible({
      timeout: 10_000,
    });
    await expect(card.getByText('Aktif masa: 2')).toBeVisible();

    // 6. Ad düzenle (Pencil icon-only button — aria-label native click)
    await clickButtonByAriaLabel(page, 'Adı düzenle');
    const editInput = card.getByRole('textbox', { name: 'Adı düzenle' });
    await editInput.fill('S2 Renamed');

    const updateReq = page.waitForResponse(
      (r) =>
        r.url().includes('/areas/') && r.request().method() === 'PATCH',
    );
    await clickButtonByText(page, 'Kaydet');
    expect((await updateReq).status()).toBe(200);
    await expect(page.getByText('Bölge adı güncellendi')).toBeVisible({
      timeout: 10_000,
    });

    // Yeniden adla card scope yenile
    const renamedCard = page.locator(
      '[data-testid="area-card"][data-area-name="S2 Renamed"]',
    );
    await expect(renamedCard).toBeVisible({ timeout: 10_000 });
    await expect(renamedCard).toHaveCount(1);

    // 7. Boşalt — target=0 (delete önkoşul)
    const targetInput2 = renamedCard.getByRole('spinbutton', {
      name: 'Hedef masa sayısı',
    });
    await targetInput2.fill('0');
    const syncReq2 = page.waitForResponse(
      (r) =>
        r.url().includes('/areas/') &&
        r.url().endsWith('/sync-tables') &&
        r.request().method() === 'POST',
    );
    await clickButtonByText(page, 'Uygula');
    expect((await syncReq2).status()).toBe(200);
    await expect(page.getByText('2 masa kaldırıldı')).toBeVisible({
      timeout: 10_000,
    });

    // 8. Sil (Trash icon-only — aria-label native click)
    await clickButtonByAriaLabel(page, 'Bölgeyi sil');
    await expect(page.getByText('Bölge silinsin mi?')).toBeVisible();

    const deleteReq = page.waitForResponse(
      (r) =>
        r.url().includes('/areas/') && r.request().method() === 'DELETE',
    );
    await clickButtonByText(page, 'Sil');
    expect((await deleteReq).status()).toBe(204);
    await expect(page.getByText('Bölge kaldırıldı')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('S2 Renamed', { exact: true })).toBeHidden({
      timeout: 10_000,
    });
  });
});
