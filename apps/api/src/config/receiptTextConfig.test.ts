import { afterEach, describe, expect, it } from 'vitest';
import {
  assertReceiptTextConfig,
  isReceiptTextEnabled,
  resolveReceiptTextEnabled,
} from './receiptTextConfig.js';

/** ADR-045 K9 kademe 3 — `RECEIPT_TEXT_ENABLED` kill-switch ayrıştırması. */

const original = process.env['RECEIPT_TEXT_ENABLED'];
afterEach(() => {
  if (original === undefined) delete process.env['RECEIPT_TEXT_ENABLED'];
  else process.env['RECEIPT_TEXT_ENABLED'] = original;
});

describe('resolveReceiptTextEnabled', () => {
  it('tanımsız / boş → AÇIK (varsayılan: özellik çalışır, kolonlar NULL iken zaten bugünkü fiş)', () => {
    expect(resolveReceiptTextEnabled(undefined)).toBe(true);
    expect(resolveReceiptTextEnabled('')).toBe(true);
    expect(resolveReceiptTextEnabled('   ')).toBe(true);
  });

  it('true / false (büyük-küçük harf ve boşluk duyarsız)', () => {
    expect(resolveReceiptTextEnabled('true')).toBe(true);
    expect(resolveReceiptTextEnabled('false')).toBe(false);
    expect(resolveReceiptTextEnabled(' FALSE ')).toBe(false);
  });

  it.each(['flase', '0', 'no', 'off', 'yes'])(
    '🔴 yazım hatası "%s" açılışta REDDEDİLİR (sessizce açık kalmaz)',
    (raw) => {
      expect(() => resolveReceiptTextEnabled(raw)).toThrow(/RECEIPT_TEXT_ENABLED/);
    },
  );
});

describe('isReceiptTextEnabled / assertReceiptTextConfig', () => {
  it('env okunur', () => {
    process.env['RECEIPT_TEXT_ENABLED'] = 'false';
    expect(isReceiptTextEnabled()).toBe(false);
    delete process.env['RECEIPT_TEXT_ENABLED'];
    expect(isReceiptTextEnabled()).toBe(true);
  });

  it('geçersiz env açılış doğrulamasını patlatır', () => {
    process.env['RECEIPT_TEXT_ENABLED'] = 'kapali';
    expect(() => assertReceiptTextConfig()).toThrow();
  });
});
