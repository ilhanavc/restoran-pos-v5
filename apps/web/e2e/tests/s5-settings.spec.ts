/**
 * S5 — Admin timezone güncelle (ADR-019 §1 amendment 2026-05-08).
 *
 * KDV alanı v5.1 backlog — bu testte YOK.
 * PATCH /settings yalnız `timezone` kabul eder (apps/api/src/routes/settings.ts).
 *
 * Route: /settings (SettingsPage)
 * Form alanları:
 *   #tenant-name — read-only
 *   #timezone    — select (TIMEZONE_OPTIONS: Europe/Istanbul, Europe/Berlin, vb.)
 *
 * Senaryo:
 *   1. Admin storageState → /settings
 *   2. Mevcut timezone okunur (seed: "Europe/Istanbul")
 *   3. "Europe/Berlin" seç
 *   4. Kaydet → başarı tostu
 *   5. Reload → "Europe/Berlin" persist
 *   6. Geri al → "Europe/Istanbul" → kaydet (cleanup)
 */

import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE_PATH } from '../helpers/test-data';

test.use({ storageState: ADMIN_STORAGE_PATH });

const TZ_DEFAULT = 'Europe/Istanbul';
const TZ_ALTERNATE = 'Europe/Berlin';

test.describe('S5 — Timezone ayarı güncelleme', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    // Form yüklenene kadar bekle — tenant-name read-only alanı gösterge
    await expect(page.locator('#tenant-name')).toBeVisible({ timeout: 10000 });
  });

  test('timezone değiştirir, kaydeder, reload sonrası persist görür', async ({
    page,
  }) => {
    // Mevcut değeri oku
    const tzSelect = page.locator('#timezone');
    await expect(tzSelect).toBeVisible();
    const currentValue = await tzSelect.inputValue();

    // Alternatif TZ seç (mevcut değilse Europe/Berlin, mevcutsa Istanbul)
    const targetTz =
      currentValue === TZ_DEFAULT ? TZ_ALTERNATE : TZ_DEFAULT;

    await tzSelect.selectOption(targetTz);

    // Kaydet butonu aktif olmalı (isDirty=true)
    const saveBtn = page.getByRole('button', { name: /Kaydet|Kaydet/i });
    await expect(saveBtn).toBeEnabled({ timeout: 3000 });
    await saveBtn.click();

    // Başarı tostu
    await expect(page.getByText(/başarıyla kaydedildi|başarı|güncellendi/i)).toBeVisible({
      timeout: 8000,
    });

    // Reload → değer kalıcı mı?
    await page.reload();
    await expect(page.locator('#tenant-name')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#timezone')).toHaveValue(targetTz);

    // Cleanup — orijinal değere geri al
    await page.locator('#timezone').selectOption(currentValue);
    const saveBtnClean = page.getByRole('button', { name: /Kaydet/i });
    if (await saveBtnClean.isEnabled()) {
      await saveBtnClean.click();
      await expect(
        page.getByText(/başarıyla kaydedildi|başarı|güncellendi/i),
      ).toBeVisible({ timeout: 8000 });
    }
  });

  test('tenant-name alanı read-only ve düzenlenemez', async ({ page }) => {
    const tenantNameInput = page.locator('#tenant-name');
    await expect(tenantNameInput).toBeVisible();
    // disabled veya readOnly olmalı
    const isDisabled = await tenantNameInput.isDisabled();
    const readOnly = await tenantNameInput.getAttribute('readonly');
    expect(isDisabled || readOnly !== null).toBe(true);
  });

  test('KDV alanı sayfada bulunmaz (v5.1 backlog)', async ({ page }) => {
    // ADR-019 §1 amendment — KDV/tax rate alanı bu sayfada olmamalı
    await expect(page.getByText(/KDV|kdv|vergi oranı|tax rate/i)).not.toBeVisible();
  });
});
