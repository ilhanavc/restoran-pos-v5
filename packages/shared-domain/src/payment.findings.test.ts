// Blok 1 audit findings — intentionally RED until bugs fixed.
// See docs/audit/01-shared-domain.md (Blok 1 HAT A — packages/shared-domain para çekirdeği).
//
// Bu dosyadaki testler DOĞRU/beklenen davranışı assert eder; bug yüzünden
// bugün FAIL olurlar. Fix sonrası bu dosya yeşile döner ve regresyon
// paketine geçer.
import { describe, expect, it } from 'vitest';
import type { MoneyCents } from '@restoran-pos/shared-types';
import { calculatePayableCents, canCloseOrder, validateCashTendered } from './payment.js';

describe('[SD-M-03] canCloseOrder must not silently approve close with non-finite totals', () => {
  it('rejects (or at least does not report ok:true for) NaN payableCents', () => {
    // Bugün: `paymentsTotalCents < NaN` VE `paymentsTotalCents > NaN` ikisi de
    // false (NaN karşılaştırması her zaman false) → hiçbir dal tetiklenmez →
    // fonksiyon {ok:true} döner. Gerçek bir sipariş NaN total_cents ile asla
    // kapanmamalı — invariant sessizce atlanıyor.
    const result = canCloseOrder({
      isFullyComped: false,
      payableCents: NaN as MoneyCents,
      paymentsTotalCents: 1000 as MoneyCents,
      paymentsCount: 1,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects NaN paymentsTotalCents', () => {
    const result = canCloseOrder({
      isFullyComped: false,
      payableCents: 1000 as MoneyCents,
      paymentsTotalCents: NaN as MoneyCents,
      paymentsCount: 1,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects undefined paymentsTotalCents (same root cause: undefined comparisons are always false)', () => {
    const result = canCloseOrder({
      isFullyComped: false,
      payableCents: 1000 as MoneyCents,
      paymentsTotalCents: undefined as unknown as MoneyCents,
      paymentsCount: 1,
    });
    expect(result.ok).toBe(false);
  });
});

describe('[SD-M-04] validateCashTendered must not silently approve a NaN tendered amount', () => {
  it('rejects NaN tenderedCents instead of returning ok:true with NaN change', () => {
    // Bugün: `NaN < amountCents` === false → guard atlanır → {ok:true,
    // changeCents: NaN} döner. Kasiyer ekranında "NaN ₺ para üstü" görülür
    // VE ödeme "ok" sayılabilir.
    const result = validateCashTendered({
      amountCents: 1500 as MoneyCents,
      tenderedCents: NaN as MoneyCents,
    });
    expect(result.ok).toBe(false);
  });
});

describe('[SD-M-05] calculatePayableCents must not let a negative comp amount inflate the payable', () => {
  it('rejects a negative compedAmountCents instead of silently increasing payable above total', () => {
    // Bugün: `-100 > 1000` === false → guard atlamaz → `1000 - (-100) = 1100`
    // döner. compedAmountCents totalCents'i AŞMIYOR ama İKRAM negatif, yani
    // müşteriden gerçek toplamdan FAZLA tahsilat istenir (sessiz fazla-tahsilat).
    expect(() =>
      calculatePayableCents({
        totalCents: 1000 as MoneyCents,
        compedAmountCents: -100 as MoneyCents,
      }),
    ).toThrow();
  });
});
