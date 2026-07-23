import { describe, expect, it } from 'vitest';
import {
  ReceiptCanvas,
  RECEIPT_WIDTH,
  SIZES,
  computeLineHeight,
  wrapToWidth,
} from './canvas-render.js';

/**
 * ADR-004 Amendment 9 — raster çizim katmanı birim testleri. `wrapToWidth` ve
 * `computeLineHeight` saf (font-ölçümü enjekte edilir). `ReceiptCanvas.build`
 * gerçek canvas üretir (yapısal: genişlik sabit, içerik arttıkça yükseklik artar).
 */

describe('computeLineHeight', () => {
  it('boyut × 1.35 (yuvarlanmış)', () => {
    expect(computeLineHeight(20)).toBe(27); // 27.0
    expect(computeLineHeight(24)).toBe(32); // 32.4 → 32
    expect(computeLineHeight(40)).toBe(54); // 54.0
  });

  it('her SIZES ölçeği pozitif satır-yüksekliği üretir', () => {
    for (const size of Object.values(SIZES)) {
      expect(computeLineHeight(size)).toBeGreaterThan(size);
    }
  });
});

describe('wrapToWidth (enjekte edilen ölçümle)', () => {
  // Sahte ölçüm: her karakter 10 birim → maxWidth=100 ⇒ satır başına 10 karakter.
  const measure = (s: string): number => s.length * 10;

  it('sığan kısa metin tek satır', () => {
    expect(wrapToWidth(measure, 'kisa metin', 200)).toEqual(['kisa metin']);
  });

  it('uzun metni kelime sınırında böler (her satır maxWidth içinde)', () => {
    const lines = wrapToWidth(measure, 'aaaa bbbb cccc dddd', 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const ln of lines) expect(measure(ln)).toBeLessThanOrEqual(100);
  });

  it('kolon genişliğini aşan tek kelimeyi sert böler', () => {
    const lines = wrapToWidth(measure, 'aaaaaaaaaaaaaaaa', 100); // 16 char
    expect(lines.length).toBeGreaterThan(1);
    for (const ln of lines) expect(measure(ln)).toBeLessThanOrEqual(100);
    expect(lines.join('')).toBe('aaaaaaaaaaaaaaaa'); // içerik korunur
  });

  it('boş metin tek boş satır döner (çökmz)', () => {
    expect(wrapToWidth(measure, '', 100)).toEqual(['']);
    expect(wrapToWidth(measure, '   ', 100)).toEqual(['']);
  });
});

describe('ReceiptCanvas.build', () => {
  it('genişlik daima RECEIPT_WIDTH (576) ve yükseklik > 0', () => {
    const canvas = new ReceiptCanvas()
      .centered('DİLAN PİDE', { size: SIZES.header, bold: true })
      .build();
    expect(canvas.width).toBe(RECEIPT_WIDTH);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it('daha çok içerik → daha yüksek canvas (yükseklik-hesap birikimli)', () => {
    const short = new ReceiptCanvas()
      .centered('X', { size: SIZES.meta })
      .build().height;
    const tall = new ReceiptCanvas()
      .centered('X', { size: SIZES.meta })
      .left('bir', { size: SIZES.meta })
      .left('iki', { size: SIZES.meta })
      .rule('solid')
      .leftRight('sol', 'sag', { size: SIZES.meta })
      .build().height;
    expect(tall).toBeGreaterThan(short);
  });

  it('Türkçe + ₺ çizimi THROW etmez (font glyph var)', () => {
    expect(() =>
      new ReceiptCanvas()
        .centered('Çiğ köfte ş/ı/İ/ğ/Ğ/ö/ü — 1.234,56 ₺', { size: SIZES.itemName })
        .build(),
    ).not.toThrow();
  });

  // ADR-027 Amendment 3 K2 — ortak adet-kolonu (kasa fişi hizası).
  describe('qtyColumnWidth (ADR-027 Amd3 K2)', () => {
    const opts = { size: SIZES.itemName, bold: true };

    it('en GENİŞ adet metnine göre hesaplar', () => {
      const rc = new ReceiptCanvas();
      const mixed = rc.qtyColumnWidth(['1', '2 Bir buçuk'], opts);
      const widestOnly = rc.qtyColumnWidth(['2 Bir buçuk'], opts);
      expect(mixed).toBe(widestOnly);
      expect(mixed).toBeGreaterThan(rc.qtyColumnWidth(['1', '2'], opts));
    });

    it('taban genişliğin (40px) altına inmez', () => {
      const rc = new ReceiptCanvas();
      expect(rc.qtyColumnWidth(['1'], opts)).toBeGreaterThanOrEqual(40);
      expect(rc.qtyColumnWidth([], opts)).toBe(40);
    });

    it('qtyColPx geçilen itemRow, satırın kendi genişliğini YOK SAYAR', () => {
      // Aynı kalem iki kez: biri dar, biri geniş ortak kolonla → çıktı farklı.
      const narrow = new ReceiptCanvas()
        .itemRow('1', 'Ayran', '25,00', opts, 40)
        .build();
      const wide = new ReceiptCanvas()
        .itemRow('1', 'Ayran', '25,00', opts, 200)
        .build();
      expect(narrow.toBuffer('image/png').equals(wide.toBuffer('image/png'))).toBe(
        false,
      );
    });
  });
});
