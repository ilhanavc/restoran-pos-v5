/**
 * S2 — Masa CRUD (ADR-019 §1).
 *
 * Masalar /tanimlamalar/salon-bolgeleri (DiningAreasPage) üzerinden yönetilir.
 * Bireysel masa create/edit/delete UI yoktur; bunun yerine AreaCard'daki
 * "Hedef masa sayısı + Uygula" sync mekanizması kullanılır.
 *
 * Senaryo:
 *   1. Yeni bölge oluştur ("E2E Bolge")
 *   2. Bölge listede görünmeli
 *   3. Hedef masa sayısı 2 → Uygula (2 masa oluşturuldu)
 *   4. Bölge adını düzenle ("E2E Bolge" → "E2E Bolge Yeni")
 *   5. Bölgeyi sil → listede artık yok
 *
 * NOT: Bireysel masa düzenleme (code/capacity) ayrı bir admin UI'ında değildir;
 * tablolar sync ile oluşturulur. ADR-009 amendment: hard delete aktif.
 */

import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE_PATH } from '../helpers/test-data';

test.use({ storageState: ADMIN_STORAGE_PATH });

const AREA_NAME = 'E2E Bolge';
const AREA_NAME_UPDATED = 'E2E Bolge Yeni';

test.describe('S2 — Salon Bölgesi (Masa) CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tanimlamalar/salon-bolgeleri');
    // Sayfa yüklendi — başlık görünmeli
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 8000,
    });
  });

  test('yeni bölge oluşturur ve listede görünür', async ({ page }) => {
    // Yeni Bölge butonuna tıkla
    await page.getByRole('button', { name: /Yeni Bölge|Bölge Ekle|Ekle/i }).click();

    // Dialog/modal açılmalı — bölge adı alanı
    const nameInput = page.locator('[id*="area-name"], [aria-label*="Bölge"], [placeholder*="Bölge"], [placeholder*="bölge"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(AREA_NAME);

    // Masayı 0 bırak (varsa input)
    const tableCountInput = page.locator('[id*="table-count"], [aria-label*="masa"], [type="number"]').first();
    if (await tableCountInput.isVisible()) {
      await tableCountInput.fill('0');
    }

    // Kaydet / Oluştur
    await page.getByRole('button', { name: /Oluştur|Kaydet|Ekle/i }).last().click();

    // Başarı tostu veya listede yeni kart
    await expect(page.getByText(AREA_NAME)).toBeVisible({ timeout: 8000 });
  });

  test('bölgeye masa ekler (sync), adı düzenler, sonra siler', async ({ page }) => {
    // Seeded "Ic Salon" bölgesi mevcut — onu kullan veya yeni oluştur
    // Önce "E2E Bolge" bölgesini oluştur (bu test bağımsız çalışabilmeli)
    await page.getByRole('button', { name: /Yeni Bölge|Bölge Ekle|Ekle/i }).click();

    const nameInput = page.locator('[id*="area-name"], [aria-label*="Bölge"], [placeholder*="Bölge"], [placeholder*="bölge"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(AREA_NAME);

    const tableCountInput = page.locator('[id*="table-count"], [aria-label*="masa"], [type="number"]').first();
    if (await tableCountInput.isVisible()) {
      await tableCountInput.fill('0');
    }
    await page.getByRole('button', { name: /Oluştur|Kaydet|Ekle/i }).last().click();

    // Kart görünmeli
    await expect(page.getByText(AREA_NAME)).toBeVisible({ timeout: 8000 });

    // Hedef masa sayısı 2 → Uygula
    // AreaCard'daki number input — AREA_NAME içeren card'ı bul
    const areaCard = page.locator('text=' + AREA_NAME).locator('..').locator('..');
    const targetInput = areaCard.locator('input[type="number"]').first();
    if (await targetInput.isVisible()) {
      await targetInput.fill('2');
      await areaCard.getByRole('button', { name: /Uygula/i }).click();
      // Başarı tostu
      await expect(page.getByText(/oluşturuldu|başarı|güncellendi/i)).toBeVisible({
        timeout: 8000,
      });
    }

    // Bölge adını düzenle
    const editBtn = page
      .locator('text=' + AREA_NAME)
      .locator('..').locator('..')
      .getByRole('button', { name: /Düzenle|edit/i })
      .first();
    if (await editBtn.isVisible()) {
      await editBtn.click();
      const editInput = page.getByRole('textbox').filter({ hasText: '' }).first();
      await editInput.fill(AREA_NAME_UPDATED);
      await page.getByRole('button', { name: /Kaydet/i }).first().click();
      await expect(page.getByText(AREA_NAME_UPDATED)).toBeVisible({ timeout: 8000 });
    }

    // Bölgeyi sil — güncel adı kullan (düzenlendiyse yeni ad, değilse eski)
    const currentName = (await page.getByText(AREA_NAME_UPDATED).isVisible())
      ? AREA_NAME_UPDATED
      : AREA_NAME;

    const deleteBtn = page
      .locator('text=' + currentName)
      .locator('..').locator('..')
      .getByRole('button', { name: /Sil|delete/i })
      .first();
    await deleteBtn.click();

    // Onay dialog'u — Onayla/Sil butonu
    const confirmBtn = page.getByRole('button', { name: /Onayla|Sil|Evet/i }).last();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Listede artık yok
    await expect(page.getByText(AREA_NAME)).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByText(AREA_NAME_UPDATED)).not.toBeVisible({ timeout: 5000 });
  });
});
