/**
 * S3 — Menü editörü: kategori + ürün CRUD (ADR-019 §1).
 *
 * Route: /tanimlamalar/menu-tanimlari (MenuDefinitionsPage)
 * Ürün oluşturma: /tanimlamalar/menu-tanimlari/urun/yeni?kategori=<id>
 *
 * Senaryo:
 *   1. Yeni kategori oluştur ("Tatlilar")
 *   2. Listede görünmeli
 *   3. Kategori altına ürün ekle ("Sutlac", 50.00 TL)
 *   4. Ürün grid'de görünmeli
 *   5. Cleanup: ürünü sil → kategoriyi sil
 *
 * NOT: Variant (porsiyon) ekleme ProductEditorPage içinde yapılır.
 *      Cleanup'ta ürün silinmeden kategori silinirse MENU_CATEGORY_HAS_PRODUCTS
 *      hatası verir — önce ürün, sonra kategori sil.
 */

import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE_PATH } from '../helpers/test-data';

test.use({ storageState: ADMIN_STORAGE_PATH });

const CATEGORY_NAME = 'E2E Tatlilar';
const PRODUCT_NAME = 'E2E Sutlac';
const PRODUCT_PRICE = '50,00';

test.describe('S3 — Menü editörü: kategori + ürün CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tanimlamalar/menu-tanimlari');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 8000,
    });
  });

  test('yeni kategori oluşturur ve sol panelde görünür', async ({ page }) => {
    // Sol paneldeki "Yeni" / "Ekle" butonu
    await page.getByRole('button', { name: /Yeni|Ekle/i }).first().click();

    // Drawer açılmalı — category-name input
    const nameInput = page.locator('#category-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(CATEGORY_NAME);

    // Kaydet (drawer footer'daki submit)
    await page.getByRole('button', { name: /Kaydet/i }).last().click();

    // Başarı tostu veya kategorinin sol listede görünmesi
    await expect(page.getByText(CATEGORY_NAME)).toBeVisible({ timeout: 8000 });
  });

  test('kategori altına ürün ekler ve grid de görünür', async ({ page }) => {
    // Önce kategori oluştur
    await page.getByRole('button', { name: /Yeni|Ekle/i }).first().click();
    const nameInput = page.locator('#category-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(CATEGORY_NAME);
    await page.getByRole('button', { name: /Kaydet/i }).last().click();
    await expect(page.getByText(CATEGORY_NAME)).toBeVisible({ timeout: 8000 });

    // Kategori listesinde CATEGORY_NAME'e tıkla — sağ paneli filtrele
    await page.getByText(CATEGORY_NAME).first().click();

    // Sağ paneldeki "Yeni Ürün" butonu
    await page.getByRole('button', { name: /Yeni Ürün|Ürün Ekle/i }).click();

    // ProductEditorPage açılır (/tanimlamalar/menu-tanimlari/urun/yeni)
    await page.waitForURL(/\/urun\/yeni/);

    // Ürün adı
    const productNameInput = page.locator('#product-name, [id*="name"]').first();
    await expect(productNameInput).toBeVisible({ timeout: 5000 });
    await productNameInput.fill(PRODUCT_NAME);

    // Fiyat — variants bölümündeki ilk fiyat alanı
    const priceInput = page
      .locator('[id*="price"], [aria-label*="fiyat"], [aria-label*="Fiyat"], [placeholder*="0,00"]')
      .first();
    if (await priceInput.isVisible()) {
      await priceInput.fill(PRODUCT_PRICE);
    }

    // Kaydet
    await page.getByRole('button', { name: /Kaydet|Oluştur/i }).last().click();

    // Menü tanımları sayfasına dön
    await page.waitForURL(/\/menu-tanimlari$/);

    // Ürün sağ grid'de görünmeli
    await expect(page.getByText(PRODUCT_NAME)).toBeVisible({ timeout: 8000 });
  });

  test('ürünü siler sonra kategoriyi siler (cleanup)', async ({ page }) => {
    // Bu testin önceki test verilerini temizlemesi için:
    // Kategori yoksa bu test no-op geçer.
    const categoryVisible = await page.getByText(CATEGORY_NAME).isVisible();
    if (!categoryVisible) {
      // Kategori yok, temizlenecek bir şey yok
      return;
    }

    // Kategori listesinde CATEGORY_NAME'e tıkla
    await page.getByText(CATEGORY_NAME).first().click();

    // Sağ panelde ürün varsa sil
    const productCard = page.getByText(PRODUCT_NAME).first();
    const productVisible = await productCard.isVisible();
    if (productVisible) {
      // ProductCard üzerinde "Düzenle" → ProductEditorPage → Sil
      await productCard.click();
      // ProductCard tıklanınca edit sayfasına gider
      const editLink = page
        .locator('text=' + PRODUCT_NAME)
        .locator('..').locator('..')
        .getByRole('button', { name: /Düzenle/i })
        .first();
      if (await editLink.isVisible()) {
        await editLink.click();
        await page.waitForURL(/\/urun\//);
        // Sil butonu
        const deleteProductBtn = page.getByRole('button', { name: /Sil|Ürünü Sil/i });
        if (await deleteProductBtn.isVisible()) {
          await deleteProductBtn.click();
          // Onay
          await page.getByRole('button', { name: /Onayla|Sil|Evet/i }).last().click();
          await page.waitForURL(/\/menu-tanimlari$/);
        }
      }
    }

    // Kategoriyi sil — kategori listesindeki 3-nokta/trash menüsü
    const categoryItem = page.getByText(CATEGORY_NAME).first();
    await expect(categoryItem).toBeVisible({ timeout: 5000 });

    // CategoryListItem'daki Sil butonu
    const deleteCategoryBtn = page
      .locator('text=' + CATEGORY_NAME)
      .locator('..').locator('..')
      .getByRole('button', { name: /Sil/i })
      .first();
    await deleteCategoryBtn.click();

    // DeleteCategoryDialog onay
    const confirmBtn = page.getByRole('button', { name: /Onayla|Sil|Evet/i }).last();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Kategori listede artık yok
    await expect(page.getByText(CATEGORY_NAME)).not.toBeVisible({ timeout: 8000 });
  });
});
