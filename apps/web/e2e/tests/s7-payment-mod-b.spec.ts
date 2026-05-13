/**
 * S7 — ADR-014 §10 Karar 10.4 ("Masayı Kapat" Mod B) E2E.
 *
 * Sprint 13 PR-3 — `describe.skip` kaldırıldı (Session 62, 2026-05-13).
 *
 * Bu suite ADR-019 §1 5-senaryo smoke lock'u DIŞINDADIR. Payment-specific
 * ek suite olarak konumlanır — Sprint 9/9b S1-S5 (+ bonus S6 KDS) etkilenmez.
 *
 * Akış (tüm senaryolar ortak):
 *   1. Cashier storageState → /tables
 *   2. Dolu masa kartına click → TableActionsModal açılır
 *   3. "Hızlı Öde" tile click → QuickPaymentModal açılır
 *   4. useSplitState backend'den remaining_total_cents çeker
 *   5. Senaryo-spesifik doğrulama: Mod B "Masayı Kapat" görünür mü?
 *
 * Backend integration test'leri `apps/api/src/__tests__/orders-mod-b.test.ts`
 * altında 5 case ile mevcuttur — endpoint guard'ları orada doğrulanır.
 *
 * Senaryolar:
 *  1. ORDER_FULLY_PAID (MASA 2)    — total=10000, payment=10000 → Mod B görünür
 *     → click → toast "Masa kapatıldı" → modal kapanır
 *  2. ORDER_PARTIALLY_PAID (MASA 3)— total=10000, payment=5000 → Mod B gizli
 *  3. ORDER_UNPAID (MASA 4)        — total=10000, payment yok → Mod B gizli
 *
 * Test izolasyonu: her senaryo ayrı masa + ayrı order (seed-time idempotency).
 * Retry yok: senaryo 1 'paid' state'e yan etki yapar (status='paid' kalır),
 * retry aynı orderId'ye tekrar PATCH atınca 409 ORDER_INVARIANT_VIOLATED.
 */

import { test, expect } from '@playwright/test';
import {
  CASHIER_STORAGE_PATH,
  TABLE_2_ID,
  TABLE_3_ID,
  TABLE_4_ID,
} from '../helpers/test-data';

test.use({ storageState: CASHIER_STORAGE_PATH });

test.describe.configure({ retries: 0 });

test.describe('S7 — Mod B "Masayı Kapat"', () => {
  test('tam ödenmiş sipariş → "Masayı Kapat" görünür → click → success toast', async ({
    page,
  }) => {
    await page.goto('/tables');

    // Dolu masa kartı görünmelidir (seed'den geldi: MASA 2, status='occupied')
    const card = page.getByTestId(`table-card-${TABLE_2_ID}`);
    await expect(card).toBeVisible();

    // Kart click → TableActionsModal aç
    await card.click();

    // "Hızlı Öde" tile → QuickPaymentModal aç
    const quickPayTile = page.getByTestId('table-actions-quick-pay');
    await expect(quickPayTile).toBeVisible();
    await quickPayTile.click();

    // useSplitState backend'den remaining=0 çeker, Mod B btn görünür.
    // İlk render'da amountCents fallback ile remaining=total → btn gizli;
    // splitState yüklenince → btn görünür. Playwright auto-retry bekler.
    const closeBtn = page.getByTestId('quick-pay-close-table');
    await expect(closeBtn).toBeVisible({ timeout: 10000 });

    // Click → PATCH /orders/:id { status: 'paid' } → 200 → toast
    await closeBtn.click();

    // Success toast (i18n: payment.quick.tableClosedSuccess = "Masa kapatıldı")
    await expect(page.getByText('Masa kapatıldı')).toBeVisible({
      timeout: 5000,
    });

    // Modal kapanır (Mod B btn artık DOM'da değil)
    await expect(closeBtn).toBeHidden();
  });

  test('kısmi ödenmiş sipariş → "Masayı Kapat" gizli', async ({ page }) => {
    await page.goto('/tables');

    const card = page.getByTestId(`table-card-${TABLE_3_ID}`);
    await expect(card).toBeVisible();
    await card.click();

    const quickPayTile = page.getByTestId('table-actions-quick-pay');
    await expect(quickPayTile).toBeVisible();
    await quickPayTile.click();

    // QuickPaymentModal açıldı — splitState remaining=5000 → isFullyPaid=false
    // Mod B "Masayı Kapat" hiç render edilmez (ternary false branch).
    // 4-op grid (operation tile'ları) görünür olmalı.
    const closeBtn = page.getByTestId('quick-pay-close-table');
    await expect(closeBtn).toBeHidden();

    // Negatif assert tek başına yeterli değil — modal'ın gerçekten açıldığını
    // doğrula. QuickPaymentModal başlığı: payment.quick.title = "Hızlı Öde".
    await expect(
      page.getByRole('dialog').getByText('Hızlı Öde', { exact: false }),
    ).toBeVisible();
  });

  test('hiç ödeme yok → "Masayı Kapat" gizli', async ({ page }) => {
    await page.goto('/tables');

    const card = page.getByTestId(`table-card-${TABLE_4_ID}`);
    await expect(card).toBeVisible();
    await card.click();

    const quickPayTile = page.getByTestId('table-actions-quick-pay');
    await expect(quickPayTile).toBeVisible();
    await quickPayTile.click();

    // splitState remaining=10000 (payment yok) → isFullyPaid=false → Mod B gizli
    const closeBtn = page.getByTestId('quick-pay-close-table');
    await expect(closeBtn).toBeHidden();

    await expect(
      page.getByRole('dialog').getByText('Hızlı Öde', { exact: false }),
    ).toBeVisible();
  });
});
