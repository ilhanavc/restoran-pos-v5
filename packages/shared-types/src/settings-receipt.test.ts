import { describe, expect, it } from 'vitest';
import {
  RECEIPT_TEXT_LIMITS,
  ReceiptFooterLinesSchema,
  ReceiptHeaderLinesSchema,
  ReceiptLineSchema,
} from './settings.js';

/**
 * ADR-045 K6 — fiş metni satır kuralları. İzin listesi POZİTİFTİR: test,
 * geçmesi gerekenleri de geçmemesi gerekenleri de açıkça sayar.
 */

const ok = (s: string): boolean => ReceiptLineSchema.safeParse(s).success;
const firstMessage = (s: string): string | undefined =>
  ReceiptLineSchema.safeParse(s).error?.issues[0]?.message;

describe('ReceiptLineSchema — kabul edilenler', () => {
  it.each([
    'Cumhuriyet Mah. Atatürk Cad. No: 12',
    'Tel: 0212 555 44 33',
    'AFİYET OLSUN - YİNE BEKLERİZ',
    'Vergi No: 1234567890 Kadıköy V.D.',
    'çğıöşü ÇĞİÖŞÜ âîû ÂÎÛ',
    "Hafta içi 11:00-23:00 (Pzt kapalı)",
    'Siparişleriniz için: @pidesalonu',
    'Kampanya %10 indirim! 100₺ üzeri',
    'a*b_c=d+e#f&g?h"i\'j/k;l',
  ])('%s', (line) => {
    expect(ok(line)).toBe(true);
  });

  it('tam sınırdaki satır (40 karakter) geçer', () => {
    expect(ok('a'.repeat(RECEIPT_TEXT_LIMITS.maxCharsPerLine))).toBe(true);
  });

  it('uzunluk BAYT değil kod noktası sayılır: 40 Türkçe harf geçer', () => {
    expect(ok('ğ'.repeat(RECEIPT_TEXT_LIMITS.maxCharsPerLine))).toBe(true);
  });
});

describe('ReceiptLineSchema — reddedilenler', () => {
  it('41 karakter → too_long', () => {
    expect(firstMessage('a'.repeat(RECEIPT_TEXT_LIMITS.maxCharsPerLine + 1))).toBe(
      'receipt_line:too_long',
    );
  });

  it('boş satır → empty, yalnız boşluk → blank', () => {
    expect(firstMessage('')).toBe('receipt_line:empty');
    expect(ok('   ')).toBe(false);
  });

  it.each([
    ['ESC baytı', 'Fiş\u001b@'],
    ['GS baytı', 'Fiş\u001dV'],
    ['NUL', 'a\u0000b'],
    ['satır sonu', 'iki\nsatır'],
    ['satır başı', 'iki\rsatır'],
    ['sekme', 'a\tb'],
    ['DEL', 'a\u007fb'],
    ['C1 kontrol', 'a\u0085b'],
    ['emoji', 'Afiyet olsun 😀'],
    ['font dışı alfabe', 'Привет'],
    ['sıfır genişlikli boşluk', 'a​b'],
    ['ters çevirme', 'a‮b'],
  ])('%s → invalid_char', (_label, line) => {
    expect(ok(line)).toBe(false);
  });
});

describe('Satır dizileri', () => {
  it('boş dizi geçer (üstte "ek satır yok", altta "hiç alt bilgi")', () => {
    expect(ReceiptHeaderLinesSchema.safeParse([]).success).toBe(true);
    expect(ReceiptFooterLinesSchema.safeParse([]).success).toBe(true);
  });

  it('en fazla 4 satır; 5. satır reddedilir', () => {
    const four = ['a', 'b', 'c', 'd'];
    expect(ReceiptHeaderLinesSchema.safeParse(four).success).toBe(true);
    expect(ReceiptFooterLinesSchema.safeParse(four).success).toBe(true);
    expect(ReceiptHeaderLinesSchema.safeParse([...four, 'e']).success).toBe(false);
    expect(ReceiptFooterLinesSchema.safeParse([...four, 'e']).success).toBe(false);
  });

  it('dizideki tek bozuk satır bütün diziyi reddeder', () => {
    expect(ReceiptFooterLinesSchema.safeParse(['Teşekkürler', 'a\u001bb']).success).toBe(
      false,
    );
  });
});
