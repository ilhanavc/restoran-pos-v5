// Blok 1 audit findings — intentionally RED until bugs fixed.
// See docs/audit/01-shared-domain.md (Blok 1 HAT A — packages/shared-domain para çekirdeği).
//
// Bu dosyadaki testler DOĞRU/beklenen davranışı assert eder; bug yüzünden
// bugün FAIL olurlar. Fix sonrası bu dosya yeşile döner ve regresyon
// paketine geçer.
import { describe, expect, it } from 'vitest';
import type { MoneyCents } from '@restoran-pos/shared-types';
import { formatMoney, parseMoney, subtractMoney } from './money.js';

describe('[SD-M-01] parseMoney should be the inverse of formatMoney for grouped amounts', () => {
  it('round-trips a 1.234,56 TL amount (>=1000 TL triggers thousands grouping)', () => {
    const original = 123_456 as MoneyCents; // 1.234,56 TL
    const formatted = formatMoney(original);
    // Bugün formatted === "₺1.234,56"; parseMoney sadece İLK virgülü nokta
    // yapıp ilk noktayı ondalık ayracı sanıyor → binlik "1." kısmı whole
    // olarak okunuyor, kalan "234.56" kesiliyor → 123 döner (1000x veri kaybı).
    expect(parseMoney(formatted)).toBe(original);
  });

  it('parses an explicit Turkish-grouped string "1.234,56" as 123456 kuruş, not 123', () => {
    expect(parseMoney('1.234,56')).toBe(123_456);
  });

  it('parses a US-grouped string "1,234.56" as 123456 kuruş, not 123', () => {
    // formatMoney(cents, 'en-US') üretebileceği biçim; aynı kök neden
    // (yalnız ilk sınırlayıcı değiştiriliyor) her iki grup biçiminde de kırılır.
    expect(parseMoney('1,234.56')).toBe(123_456);
  });
});

describe('[SD-M-02] subtractMoney must not silently accept non-finite operands', () => {
  it('rejects NaN minuend instead of returning NaN (relational guard cannot see NaN)', () => {
    // Bugün: (NaN - 100) < 0 === false (NaN karşılaştırması her zaman false)
    // → RangeError guard'ı tetiklenmez → NaN sessizce MoneyCents olarak döner.
    expect(() => subtractMoney(NaN as MoneyCents, 100 as MoneyCents)).toThrow();
  });

  it('rejects NaN subtrahend instead of returning NaN', () => {
    expect(() => subtractMoney(100 as MoneyCents, NaN as MoneyCents)).toThrow();
  });
});
