/**
 * S5 — Ayarlar timezone update (ADR-019 §1 + Amendment 2026-05-08).
 *
 * Akış:
 *   1. Admin UI login
 *   2. SPA nav /settings
 *   3. <select id="timezone"> Europe/Istanbul (seed default) → Europe/London
 *   4. "Kaydet" submit
 *   5. Toast "Ayarlar güncellendi" görünür
 *   6. Select hala Europe/London (mutation onSuccess invalidate sonrası)
 *
 * Locator stratejisi (gerçek DOM, ADR-019 Amendment 3):
 *   - SettingsPage `<select id="timezone">` stable id
 *   - Submit `<Button type="submit">` Türkçe metin "Kaydet" / "Kaydediliyor..."
 *   - Sonner toast getByText 'Ayarlar güncellendi'
 *
 * Auth: storageState empty → loginViaUI helper (ADR-019 Amendment 3).
 */

import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} from '../helpers/test-data';
import { loginViaUI, spaNavigate } from '../helpers/auth-login';

test.use({ storageState: { cookies: [], origins: [] } });

// Test side-effect (DB'de tenant_settings.timezone değişiyor); CI default
// retries:1 ikinci pass'te aynı değere setOption no-op (isDirty=false →
// Kaydet disabled), test fail. Single attempt yeterli.
test.describe.configure({ retries: 0 });

test.describe('S5 — Ayarlar timezone update', () => {
  test('Europe/Istanbul → Europe/London → toast + persist', async ({
    page,
  }) => {
    await loginViaUI(page, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    // /settings — SPA nav (Zustand state korunsun)
    await spaNavigate(page, '/settings');
    await expect(page).toHaveURL(/\/settings$/, { timeout: 5_000 });

    // Form yüklenene kadar bekle (settingsQuery.isSuccess && original)
    const tzSelect = page.locator('#timezone');
    await expect(tzSelect).toBeVisible({ timeout: 10_000 });
    await expect(tzSelect).toBeEnabled();

    // Seed default: Europe/Istanbul (seed.ts:99)
    await expect(tzSelect).toHaveValue('Europe/Istanbul');

    // Değiştir → isDirty=true → Kaydet enable
    await tzSelect.selectOption('Europe/London');

    const saveBtn = page.getByRole('button', { name: /^Kaydet$/ });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Sonner toast başarı mesajı (admin.settings.saveSuccess)
    await expect(page.getByText('Ayarlar güncellendi')).toBeVisible({
      timeout: 10_000,
    });

    // Select hala London (mutation onSuccess invalidate → refetch → isDirty=false)
    await expect(tzSelect).toHaveValue('Europe/London');
  });
});
