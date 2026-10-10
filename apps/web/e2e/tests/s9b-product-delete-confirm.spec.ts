/**
 * S9b — Ürün silme ONAY KAPISI (S138).
 *
 * 🔴 KAPSAM NOTU — bu "ürün CRUD E2E" DEĞİL.
 * ADR-019 Amd4 ürün/varyant CRUD E2E'sini bilinçli olarak backlog'a almıştı
 * (`s3-menu-categories.spec.ts` başlığına bkz.) ve o karar **duruyor**. Bu spec
 * yalnız şunu sınar: ürün silme artık `window.confirm` değil, uygulamanın
 * Dialog desenini kullanıyor ve **o kapı gerçekten kapı** (Vazgeç silmiyor).
 * Ürün oluşturma yalnız bir araç — silinecek izole bir kayıt üretmek için.
 *
 * ⚠️ NEDEN SEED ÜRÜNÜ KULLANILMIYOR: seed'de 2 ürün var ve `s6-kds` /
 * `s7-payment` sipariş kurarken onlara dayanıyor. Seed ürününü silmek bu
 * spec'in sırasına bağlı, kırılgan bir bağ yaratırdı. Kendi ürünümüzü yaratıp
 * kendimiz siliyoruz → sıradan bağımsız.
 *
 * ⚠️ Bu akış `window.confirm`'lü hâlde ÇALIŞMAZ: Playwright native dialog'u
 * otomatik **dismiss** eder, yani silme hiç olmaz. Negatif kontrolün
 * dayanağı budur (düzeltme sökülürse "Sil" vakası kırılır).
 */

import { test, expect } from '@playwright/test';

import { loginViaUI, spaNavigate } from '../helpers/auth-login';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/test-data';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

const MENU_PATH = '/tanimlamalar/menu-tanimlari';
const PRODUCT_NAME = 'S9b Silinecek Ürün';
const DIALOG_BODY = /silinsin mi\?/i;

test.describe('S9b — Ürün silme onay kapısı', () => {
  test('Vazgeç SİLMEZ → Sil siler', async ({ page }) => {
    await loginViaUI(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await spaNavigate(page, MENU_PATH);
    // ⚠️ Bu spec `clickButtonByText` helper'ını KULLANMAZ: o helper
    // `textContent.trim() === t` ile TAM eşleşme arar ve senkron çalışır →
    // ikon+metin taşıyan düğmelerde ve sayfa daha render olmadan kırılgan
    // (ikisini de ampirik yaşadık). Playwright'ın `getByRole` erişilebilir-ad
    // eşleştirmesi hem ikonu tolere eder hem auto-wait yapar.
    await expect(
      page.getByRole('heading', { name: 'Menü Tanımları' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Yeni ürün' })).toBeVisible();

    // ---- Silinecek ürünü yarat (araç adımı) ----------------------------
    // ⚠️ `page.waitForURL` BU AKIŞTA KULLANILMAZ: SPA pushState'te `load`
    // event'i yeniden ATEŞLENMEZ, waitForURL varsayılan olarak onu bekler ve
    // URL değişse bile zaman aşımına uğrar (ampirik olarak yaşandı). Onun
    // yerine hedef ekranın bir öğesini bekliyoruz — hem daha sağlam hem
    // gerçekten "ekran geldi mi" sorusunu ölçüyor.
    await page.getByRole('button', { name: 'Yeni ürün' }).click();
    await expect(page.locator('#product-name')).toBeVisible({
      timeout: 10_000,
    });

    await page.locator('#product-name').fill(PRODUCT_NAME);
    // Kategori seed'den gelir; ilk gerçek seçeneği al (index 0 placeholder).
    await page.locator('#product-category').selectOption({ index: 1 });
    // Varsayılan "Tam" porsiyonunun fiyat alanı — id dinamik (`variant-price-<tempId>`).
    await page.locator('input[id^="variant-price-"]').first().fill('12,50');

    await page.getByRole('button', { name: 'Kaydet' }).click();
    await expect(page.getByText(PRODUCT_NAME, { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // ---- Düzenleme ekranını aç -----------------------------------------
    await page.getByRole('button', { name: 'Ürünü düzenle' }).last().click();
    await expect(page.locator('#product-name')).toHaveValue(PRODUCT_NAME, {
      timeout: 10_000,
    });

    // ---- 1) VAZGEÇ: dialog açılır ama ürün SİLİNMEZ ---------------------
    await page.getByRole('button', { name: 'Ürünü sil' }).click();
    await expect(page.getByText(DIALOG_BODY)).toBeVisible();
    await page.getByRole('button', { name: 'Vazgeç' }).click();
    await expect(page.getByText(DIALOG_BODY)).toHaveCount(0);

    // Hâlâ editördeyiz ve ürün duruyor → onay kapısı gerçekten kapı.
    await expect(page.locator('#product-name')).toHaveValue(PRODUCT_NAME);

    // ---- 2) SİL: onaylanınca gerçekten siler ----------------------------
    await page.getByRole('button', { name: 'Ürünü sil' }).click();
    await expect(page.getByText(DIALOG_BODY)).toBeVisible();
    await page.locator('[data-testid="confirm-delete-product"]').click();

    // Listeye döner ve ürün artık görünmez.
    await expect(page.getByText(PRODUCT_NAME, { exact: false })).toHaveCount(
      0,
      { timeout: 10_000 },
    );
  });
});
