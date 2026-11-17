import { describe, expect, it } from 'vitest';
import { DEFAULT_RECEIPT_TEXT, resolveReceiptText } from './receipt-text.js';

/** ADR-045 K3/K9 — fiş metni çözümleyicisi. */

const ON = { enabled: true } as const;

describe('resolveReceiptText', () => {
  it('iki kolon da NULL → bugünkü fiş (ek üst satır yok, GÖMÜLÜ kapanış)', () => {
    const r = resolveReceiptText({ headerLines: null, footerLines: null }, ON);
    expect(r.invalid).toBe(false);
    expect(r.text).toEqual({ header: [], footer: { kind: 'default' } });
    expect(r.text).toEqual(DEFAULT_RECEIPT_TEXT);
  });

  it('🔴 alt bilgi NULL ≠ boş dizi: NULL gömülü kapanışı, [] HİÇ kapanışı seçer', () => {
    const asNull = resolveReceiptText({ headerLines: null, footerLines: null }, ON);
    const asEmpty = resolveReceiptText({ headerLines: null, footerLines: [] }, ON);
    expect(asNull.text.footer).toEqual({ kind: 'default' });
    expect(asEmpty.text.footer).toEqual({ kind: 'custom', lines: [] });
    expect(asEmpty.text.footer).not.toEqual(asNull.text.footer);
  });

  it('özel üst ve alt satırlar aynen geçer', () => {
    const r = resolveReceiptText(
      {
        headerLines: ['Cumhuriyet Mah. No: 12', 'Tel: 0212 555 44 33'],
        footerLines: ['Yine bekleriz'],
      },
      ON,
    );
    expect(r.invalid).toBe(false);
    expect(r.text.header).toEqual(['Cumhuriyet Mah. No: 12', 'Tel: 0212 555 44 33']);
    expect(r.text.footer).toEqual({ kind: 'custom', lines: ['Yine bekleriz'] });
  });

  it('🔴 FAIL-OPEN: bozuk üst bilgi (ESC baytı) → varsayılan + invalid, throw YOK', () => {
    const r = resolveReceiptText(
      { headerLines: ['ok', 'kötü\u001b@'], footerLines: ['Yine bekleriz'] },
      ON,
    );
    expect(r.invalid).toBe(true);
    // İki alandan biri bozuksa İKİSİ de yok sayılır — yarım yapılandırma basılmaz.
    expect(r.text).toEqual(DEFAULT_RECEIPT_TEXT);
  });

  it('🔴 FAIL-OPEN: sınırı aşan alt bilgi (5 satır) → varsayılan + invalid', () => {
    const r = resolveReceiptText(
      { headerLines: null, footerLines: ['a', 'b', 'c', 'd', 'e'] },
      ON,
    );
    expect(r.invalid).toBe(true);
    expect(r.text).toEqual(DEFAULT_RECEIPT_TEXT);
  });

  it('kill-switch kapalı → kolonlar YOK SAYILIR (geçerli olsalar bile), invalid değil', () => {
    const r = resolveReceiptText(
      { headerLines: ['Adres'], footerLines: [] },
      { enabled: false },
    );
    expect(r.invalid).toBe(false);
    expect(r.text).toEqual(DEFAULT_RECEIPT_TEXT);
  });

  it('kill-switch kapalıyken bozuk değer de sessizce varsayılan (log gürültüsü yok)', () => {
    const r = resolveReceiptText(
      { headerLines: ['a\u0000b'], footerLines: null },
      { enabled: false },
    );
    expect(r.invalid).toBe(false);
    expect(r.text).toEqual(DEFAULT_RECEIPT_TEXT);
  });

  it('dönen varsayılan değiştirilemez (paylaşılan nesne bozulamaz)', () => {
    expect(Object.isFrozen(DEFAULT_RECEIPT_TEXT)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RECEIPT_TEXT.header)).toBe(true);
  });
});
