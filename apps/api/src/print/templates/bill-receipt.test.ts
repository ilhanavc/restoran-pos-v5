import { describe, expect, it } from 'vitest';
import { renderBillReceipt, type BillReceiptParams } from './bill-receipt.js';
import { encodeCP857, ESC_POS } from '@restoran-pos/shared-domain';

/**
 * ADR-027 Faz A + Amendment 1 — customer bill (adisyon) template render tests.
 * Pure function, no DB. Byte-level assertions. 48 sütun, çift-boyut başlık/TUTAR/
 * AFİYET OLSUN, 3-kolon kalem, modifiye/not alt-satırları, koşullu ödeme dökümü.
 * Money basar "TL" (CP857 ₺ yok).
 */

function baseParams(
  overrides: Partial<BillReceiptParams> = {},
): BillReceiptParams {
  return {
    tenant_header: 'Pide Salonu',
    order_no: 42,
    order_type: 'dine_in',
    server_name: 'İlhan',
    table_label: 'Masa 5',
    area_label: null,
    items: [
      { name: 'Kıymalı Pide', qty: 2, lineTotalCents: 36000, note: null, modifiers: [] },
      { name: 'Ayran', qty: 1, lineTotalCents: 2500, note: null, modifiers: [] },
    ],
    totalCents: 38500,
    payments: [],
    paidTotalCents: 0,
    remainingCents: 38500,
    created_at_local: '29.06.2026  20:30',
    ...overrides,
  };
}

/** Naive byte-array contains-subsequence check. */
function bufferContains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** First index of a byte subsequence, or -1. */
function indexOfSub(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0) return 0;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// ADR-004 Amendment 7 mode bytes.
const ESC_G_ON = new Uint8Array([0x1b, 0x47, 0x01]); // double-strike aç
const ESC_E_ON = new Uint8Array([0x1b, 0x45, 0x01]); // bold aç
const ESC_E_OFF = new Uint8Array([0x1b, 0x45, 0x00]); // bold kapat

// 3-kolon kalem satırı beklenen biçimi (impl ile aynı 30/6/12 genişlikleri).
const NAME_W = 30;
const QTY_W = 6;
const AMT_W = 12;
function itemLine(name: string, qty: string, amount: string): string {
  const nameField =
    name.length > NAME_W ? name.slice(0, NAME_W) : name.padEnd(NAME_W);
  return `${nameField}${qty.padStart(QTY_W)}${amount.padStart(AMT_W)}`;
}

describe('renderBillReceipt', () => {
  it('opens with RESET then the kasa codepage (PAGE61 / ESC t 61) when passed and ends with CUT_FULL', () => {
    // Kasa (POS-80) fişi: enqueueBillJob CODEPAGE_CP857_PAGE61 geçer (ADR-004 Amd3).
    const out = renderBillReceipt(baseParams(), ESC_POS.CODEPAGE_CP857_PAGE61);
    expect(Array.from(out.subarray(0, 5))).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 0x3d,
    ]);
    // feed(4) + CUT_FULL kapanışı; son 4 bayt = CUT_FULL.
    expect(Array.from(out.subarray(out.length - 4))).toEqual([
      0x1d, 0x56, 0x42, 0x00,
    ]);
    // Kesim öncesi 4 satır besleme (ESC d 4).
    expect(bufferContains(out, new Uint8Array([0x1b, 0x64, 0x04]))).toBe(true);
  });

  it('defaults to CODEPAGE_CP857 (ESC t 29, mutfak) when no codepage arg — byte-identical geriye-dönük', () => {
    const out = renderBillReceipt(baseParams());
    expect(Array.from(out.subarray(0, 5))).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 0x1d,
    ]);
  });

  it('renders 48-column major/minor separators', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('='.repeat(48)))).toBe(true);
    expect(bufferContains(out, encodeCP857('-'.repeat(48)))).toBe(true);
  });

  it('renders centered double-size header (tenant + date) with dblH+dblW bytes', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('Pide Salonu'))).toBe(true);
    expect(bufferContains(out, encodeCP857('29.06.2026  20:30'))).toBe(true);
    // ESC ! 0x38 = bold(0x08)+doubleHeight(0x10)+doubleWidth(0x20).
    expect(bufferContains(out, new Uint8Array([0x1b, 0x21, 0x38]))).toBe(true);
    // ESC a 1 = center.
    expect(bufferContains(out, new Uint8Array([0x1b, 0x61, 0x01]))).toBe(true);
  });

  it('renders meta block: Adisyon No, Garson, Sipariş Kanalı', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('Adisyon No: 42'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Garson: İlhan'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Sipariş Kanalı: Masa Siparişi'))).toBe(
      true,
    );
    // Eski "Fiş No:" / "ADİSYON" başlığı kaldırıldı.
    expect(bufferContains(out, encodeCP857('Fiş No:'))).toBe(false);
  });

  it('renders 3-column item lines (ad · adet · tutar sağa; kalem tutarı TL YOK)', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, encodeCP857(itemLine('Kıymalı Pide', '2', '360,00')))).toBe(
      true,
    );
    expect(bufferContains(out, encodeCP857(itemLine('Ayran', '1', '25,00')))).toBe(
      true,
    );
  });

  it('renders modifier subline "  [..]" when modifiers present', () => {
    const out = renderBillReceipt(
      baseParams({
        items: [
          {
            name: 'Karışık Pizza',
            qty: 1,
            lineTotalCents: 42000,
            note: null,
            modifiers: ['ekstra kaşar', 'ince hamur'],
          },
        ],
      }),
    );
    expect(bufferContains(out, encodeCP857('  [ekstra kaşar, ince hamur]'))).toBe(
      true,
    );
  });

  it('renders note subline "  (..)" when item note present', () => {
    const out = renderBillReceipt(
      baseParams({
        items: [
          { name: 'Lahmacun', qty: 3, lineTotalCents: 15000, note: 'az acılı', modifiers: [] },
        ],
      }),
    );
    expect(bufferContains(out, encodeCP857('  (az acılı)'))).toBe(true);
  });

  it('renders TUTAR with the total in TL + double-height bold bytes', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('TUTAR'))).toBe(true);
    expect(bufferContains(out, encodeCP857('385,00 TL'))).toBe(true);
    // ESC ! 0x18 = bold(0x08)+doubleHeight(0x10), doubleWidth YOK (hiza korunur).
    expect(bufferContains(out, new Uint8Array([0x1b, 0x21, 0x18]))).toBe(true);
  });

  it('maps order_type to Türkçe "Sipariş Kanalı" label (takeaway/delivery)', () => {
    const takeaway = renderBillReceipt(baseParams({ order_type: 'takeaway' }));
    expect(bufferContains(takeaway, encodeCP857('Sipariş Kanalı: Paket / Gel-Al'))).toBe(
      true,
    );
    const delivery = renderBillReceipt(baseParams({ order_type: 'delivery' }));
    expect(
      bufferContains(delivery, encodeCP857('Sipariş Kanalı: Paket / Adrese Teslim')),
    ).toBe(true);
  });

  it('renders "Garson: -" (ASCII, CP857-safe) when server_name is null', () => {
    const out = renderBillReceipt(baseParams({ server_name: null }));
    expect(bufferContains(out, encodeCP857('Garson: -'))).toBe(true);
  });

  it('prefixes the area when area_label is present ("Bahçe - Masa 2")', () => {
    const out = renderBillReceipt(
      baseParams({ table_label: 'Masa 2', area_label: 'Bahçe' }),
    );
    expect(bufferContains(out, encodeCP857('Bahçe - Masa 2'))).toBe(true);
  });

  it('renders "PAKET" when table_label is null (area ignored)', () => {
    const out = renderBillReceipt(
      baseParams({ table_label: null, area_label: 'Bahçe' }),
    );
    expect(bufferContains(out, encodeCP857('PAKET'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Masa 5'))).toBe(false);
  });

  it('renders payment breakdown when payments.length > 1 (parçalı/çok-türlü)', () => {
    const out = renderBillReceipt(
      baseParams({
        payments: [
          { type: 'card', amountCents: 30000 },
          { type: 'cash', amountCents: 8500 },
        ],
        paidTotalCents: 38500,
        remainingCents: 0,
      }),
    );
    expect(bufferContains(out, encodeCP857('Tahsil Edilen'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Ödemeler'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Kredi Kartı'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Nakit'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Kalan'))).toBe(true);
    // Özet satırları TL'li (Tahsil/Kalan), ödeme satırları TL'siz (sütun).
    expect(bufferContains(out, encodeCP857('0,00 TL'))).toBe(true); // Kalan
    expect(bufferContains(out, encodeCP857('300,00'))).toBe(true); // Kredi Kartı
    expect(bufferContains(out, encodeCP857('85,00'))).toBe(true); // Nakit
  });

  it('omits payment breakdown when payments.length <= 1 (yalın adisyon)', () => {
    const zero = renderBillReceipt(baseParams({ payments: [] }));
    expect(bufferContains(zero, encodeCP857('Tahsil Edilen'))).toBe(false);
    expect(bufferContains(zero, encodeCP857('Ödemeler'))).toBe(false);
    expect(bufferContains(zero, encodeCP857('Kalan'))).toBe(false);

    const single = renderBillReceipt(
      baseParams({ payments: [{ type: 'cash', amountCents: 38500 }] }),
    );
    expect(bufferContains(single, encodeCP857('Tahsil Edilen'))).toBe(false);
    expect(bufferContains(single, encodeCP857('Ödemeler'))).toBe(false);
  });

  it('renders the footer AFİYET OLSUN (double-size) + Teşekkür ederiz!', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('AFİYET OLSUN'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Teşekkür ederiz!'))).toBe(true);
  });

  it('encodes Turkish glyphs correctly (CP857: İ, ğ=0xA7, Ğ=0xA6)', () => {
    const out = renderBillReceipt(
      baseParams({
        items: [
          { name: 'Çiğ Köfte Ğ', qty: 1, lineTotalCents: 5000, note: null, modifiers: [] },
        ],
      }),
    );
    // AFİYET → İ = 0x98.
    expect(bufferContains(out, new Uint8Array([0x98]))).toBe(true);
    // ğ = 0xA7, Ğ = 0xA6 (S83 empirik düzeltme).
    expect(bufferContains(out, encodeCP857('Çiğ Köfte Ğ'))).toBe(true);
    expect(bufferContains(out, new Uint8Array([0xa7]))).toBe(true);
    expect(bufferContains(out, new Uint8Array([0xa6]))).toBe(true);
  });

  it('strips ESC/POS control bytes from free-text (name/note/modifier) — injection guard', () => {
    // security-reviewer (ADR-027 Amd1): garson serbest-metne ham ESC/POS control
    // byte koyup (GS V = kesim / ESC = mode) yazıcıyı bozamaz — clean() süzer.
    const out = renderBillReceipt(
      baseParams({
        items: [
          {
            name: `Pide${String.fromCharCode(0x1b)}Q`, // ESC injection
            qty: 1,
            lineTotalCents: 5000,
            note: `a${String.fromCharCode(0x1d)}b`, // GS injection
            modifiers: [`x${String.fromCharCode(0x00)}y`], // NUL injection
          },
        ],
      }),
    );
    expect(bufferContains(out, encodeCP857('PideQ'))).toBe(true); // ESC 0x1b silindi
    expect(bufferContains(out, encodeCP857('  (ab)'))).toBe(true); // GS 0x1d silindi
    expect(bufferContains(out, encodeCP857('  [xy]'))).toBe(true); // NUL 0x00 silindi
  });

  it('returns a non-empty Uint8Array', () => {
    const out = renderBillReceipt(baseParams());
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(20);
  });

  // --- ADR-004 Amendment 7 — fiş tipografisi (dengeli + koyu) ---

  it('opens double-strike (ESC G 1) right after RESET + codepage (Amd7 K2 koyuluk)', () => {
    const out = renderBillReceipt(baseParams());
    // RESET(2) + ESC t 61(3) = 5 bayt; hemen ardından ESC G 1 (koyuluk aç).
    expect(Array.from(out.subarray(5, 8))).toEqual([0x1b, 0x47, 0x01]);
    expect(bufferContains(out, ESC_G_ON)).toBe(true);
  });

  it('Amd8: bip/buzzer (ESC B 3 2) ESC G sonrasi emit edilir', () => {
    const out = renderBillReceipt(baseParams());
    expect(Array.from(out.subarray(8, 12))).toEqual([0x1b, 0x42, 0x03, 0x02]);
  });

  it('wraps the body (meta + item lines) in ESC E bold — asıl "ince" düzeltmesi (Amd7 K3)', () => {
    const out = renderBillReceipt(baseParams());
    // Bold-on ürün satırından ÖNCE, bold-off ürün satırından SONRA / TUTAR'a kadar.
    const idxBoldOn = indexOfSub(out, ESC_E_ON);
    const idxItem = indexOfSub(out, encodeCP857('Kıymalı Pide'));
    const idxBoldOff = indexOfSub(out, ESC_E_OFF);
    const idxTutar = indexOfSub(out, encodeCP857('TUTAR'));
    expect(idxBoldOn).toBeGreaterThanOrEqual(0);
    expect(idxBoldOn).toBeLessThan(idxItem);
    expect(idxBoldOff).toBeGreaterThan(idxItem);
    expect(idxBoldOff).toBeLessThanOrEqual(idxTutar);
  });

  it('keeps header ESC ! 0x38 + TUTAR ESC ! 0x18 mode bytes unchanged (Amd7 K3)', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, new Uint8Array([0x1b, 0x21, 0x38]))).toBe(true);
    expect(bufferContains(out, new Uint8Array([0x1b, 0x21, 0x18]))).toBe(true);
  });

  it('wraps the payment breakdown in bold when payments.length > 1 (Amd7 K3)', () => {
    const out = renderBillReceipt(
      baseParams({
        payments: [
          { type: 'card', amountCents: 30000 },
          { type: 'cash', amountCents: 8500 },
        ],
        paidTotalCents: 38500,
        remainingCents: 0,
      }),
    );
    // Dökümün "Tahsil Edilen" satırı bir ESC E bold bloğunun içinde.
    const idxTahsil = indexOfSub(out, encodeCP857('Tahsil Edilen'));
    const idxBoldOnBefore = lastIndexOfSubBefore(out, ESC_E_ON, idxTahsil);
    const idxBoldOffAfter = indexOfSubFrom(out, ESC_E_OFF, idxTahsil);
    expect(idxBoldOnBefore).toBeGreaterThanOrEqual(0);
    expect(idxBoldOffAfter).toBeGreaterThan(idxTahsil);
  });
});

/** Last index of `needle` strictly before `limit`, or -1. */
function lastIndexOfSubBefore(
  haystack: Uint8Array,
  needle: Uint8Array,
  limit: number,
): number {
  let found = -1;
  outer: for (let i = 0; i <= haystack.length - needle.length && i < limit; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    found = i;
  }
  return found;
}

/** First index of `needle` at or after `from`, or -1. */
function indexOfSubFrom(
  haystack: Uint8Array,
  needle: Uint8Array,
  from: number,
): number {
  outer: for (let i = Math.max(0, from); i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
