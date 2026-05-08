/**
 * S5 — Admin timezone güncelle (ADR-019 §1 amendment 2026-05-08).
 *
 * KDV alanı v5.1 backlog — PATCH /settings yalnız `timezone` kabul eder
 * (apps/api/src/routes/settings.ts:124).
 *
 * Route: /settings (SettingsPage)
 * Anchor locator: #timezone select (TIMEZONE_OPTIONS: Europe/Istanbul, Europe/Berlin)
 *
 * Senaryo (ADR-019 §1 saf scope):
 *   1. Admin storageState → /settings
 *   2. Mevcut timezone okunur (seed: "Europe/Istanbul")
 *   3. Alternatif TZ seç → kaydet → başarı tostu
 *   4. Reload → değer persist
 *   5. Geri al (cleanup)
 */

import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE_PATH } from '../helpers/test-data';

test.use({ storageState: ADMIN_STORAGE_PATH });

const TZ_DEFAULT = 'Europe/Istanbul';
const TZ_ALTERNATE = 'Europe/Berlin';

test.describe('S5 — Timezone ayarı güncelleme', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    // Form yüklenene kadar bekle — #timezone select anchor
    await expect(page.locator('#timezone')).toBeVisible({ timeout: 10000 });
  });

  test('timezone değiştirir, kaydeder, reload sonrası persist görür', async ({
    page,
  }) => {
    const tzSelect = page.locator('#timezone');
    const currentValue = await tzSelect.inputValue();

    const targetTz =
      currentValue === TZ_DEFAULT ? TZ_ALTERNATE : TZ_DEFAULT;

    await tzSelect.selectOption(targetTz);

    // Kaydet butonu aktif olmalı (isDirty=true)
    const saveBtn = page.getByRole('button', { name: /Kaydet/i });
    await expect(saveBtn).toBeEnabled({ timeout: 3000 });
    await saveBtn.click();

    // Başarı tostu
    await expect(
      page.getByText(/başarıyla kaydedildi|başarı|güncellendi/i),
    ).toBeVisible({ timeout: 8000 });

    // Reload → değer kalıcı mı?
    await page.reload();
    await expect(page.locator('#timezone')).toBeVisible({ timeout: 10000 });
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
});
