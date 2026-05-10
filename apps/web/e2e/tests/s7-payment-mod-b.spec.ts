/**
 * S7 — ADR-014 §10 Karar 10.4 ("Masayı Kapat" Mod B) E2E iskeleti.
 *
 * **Sprint 13 — describe.skip ile devre dışı.**
 *
 * Bu suite ADR-019 §1 5-senaryo smoke lock'u DIŞINDADIR. Payment-specific
 * ek suite olarak konumlanmıştır — Sprint 9/9b S1-S5 (+ bonus S6 KDS)
 * etkilenmez.
 *
 * Skip nedeni: Sprint 9b dersi gereği locator'lar gerçek DOM'dan alınmalı
 * (lokal Playwright UI mode + Inspector). Sandbox körü körüne yazılan
 * locator'lar 30s timeout ile fail eder. Lokal UI keşfi sonrası `.skip`
 * kaldırılır ve seed fixture (tam ödenmiş hazır sipariş) eklenir.
 *
 * Backend integration test'leri `apps/api/src/__tests__/orders-mod-b.test.ts`
 * altında 5 case ile mevcuttur — endpoint guard'ları orada doğrulanır.
 *
 * Senaryolar (lokal UI keşfi sonrası açılacak):
 *  1. Tam ödenmiş sipariş → "Masayı Kapat" butonu görünür → click → success toast
 *  2. Kısmi ödenmiş sipariş → "Masayı Kapat" butonu gizli (isFullyPaid=false)
 *  3. Hiç ödeme yok → "Masayı Kapat" butonu gizli (isFullyPaid=false)
 */

import { test, expect } from '@playwright/test';

test.describe.skip('S7 — Mod B "Masayı Kapat" (Sprint 13, lokal UI keşfi sonrası açılacak)', () => {
  test('tam ödenmiş sipariş → "Masayı Kapat" butonu görünür → click → success toast', async ({
    page,
  }) => {
    // TODO Sprint 13b: lokal Playwright UI mode + Inspector ile locator çıkar.
    // Pre-condition: seed.ts'de tam ödenmiş bir order hazırlanmalı (orderId fixture'a yaz).
    // Adımlar:
    //  1. /orders/:id veya /tables/:tableId sayfasına git
    //  2. Ödeme modal'ını aç (3-nokta menü → "Ödeme")
    //  3. QuickPaymentModal'da mor "Masayı Kapat" butonunu bekle (isFullyPaid → görünür)
    //  4. Click → success toast (i18n key: 'payment.quick.tableClosedSuccess')
    //  5. Modal kapanır, masa boşalmış olur (table card 'available' state)
    expect(page).toBeTruthy();
  });

  test('kısmi ödenmiş sipariş → "Masayı Kapat" butonu gizli', async ({ page }) => {
    // TODO Sprint 13b: locator çıkar.
    // Pre-condition: seed.ts'de kısmi ödenmiş order (örn. total=10000, paid=5000).
    // Adımlar:
    //  1. Sipariş ödeme modal'ını aç
    //  2. "Masayı Kapat" butonu görünmemeli (isFullyPaid=false)
    //  3. Mod A "Öde" butonu görünmeli
    expect(page).toBeTruthy();
  });

  test('hiç ödeme yok → "Masayı Kapat" butonu gizli', async ({ page }) => {
    // TODO Sprint 13b: locator çıkar.
    // Pre-condition: seed.ts'de henüz ödenmemiş order (paid=0).
    // Adımlar:
    //  1. Sipariş ödeme modal'ını aç
    //  2. "Masayı Kapat" butonu görünmemeli
    //  3. Mod A "Öde" butonu görünmeli, kalan tutar = total
    expect(page).toBeTruthy();
  });
});
