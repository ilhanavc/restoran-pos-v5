import { describe, expect, it } from 'vitest';
import {
  renderKitchenReceipt,
  type KitchenReceiptItem,
  type KitchenReceiptParams,
} from './kitchen-receipt.js';
import { encodeCP857 } from '@restoran-pos/shared-domain';

/**
 * ADR-004 §7 + Amendment 5 — kitchen receipt render tests (iki yerleşim).
 * Pure function, no DB. Byte-level assertions.
 */

function makeItem(overrides: Partial<KitchenReceiptItem> = {}): KitchenReceiptItem {
  return {
    name: 'Karışık Pide',
    qty: 5,
    variantName: 'Tam',
    lineTotalCents: 190000,
    modifiers: [],
    note: null,
    ...overrides,
  };
}

function baseParams(
  overrides: Partial<KitchenReceiptParams> = {},
): KitchenReceiptParams {
  return {
    order_type: 'dine_in',
    tenant_header: 'Dilan Pide',
    order_no: 109,
    table_label: 'Masa 5',
    area_label: 'Salon',
    server_name: 'İlhan',
    created_at_local: '10.07.2026 15:00:14',
    items: [makeItem()],
    customer_name: null,
    customer_phone: null,
    delivery_address: null,
    delivery_note: null,
    planned_payment_type: null,
    total_cents: 190000,
    ...overrides,
  };
}

function paketParams(
  overrides: Partial<KitchenReceiptParams> = {},
): KitchenReceiptParams {
  return baseParams({
    order_type: 'delivery',
    table_label: null,
    area_label: null,
    customer_name: 'İlhan Avcı',
    customer_phone: '5398400856',
    delivery_address: 'Mürefte Şarköy, Mürefte Köyü İç Yolu, No 1 Kat 2',
    delivery_note: 'ÇATAL-BIÇAK GÖNDERMEYİN',
    planned_payment_type: 'cash',
    total_cents: 143000,
    ...overrides,
  });
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

/** Count occurrences of a byte subsequence. */
function countOccurrences(haystack: Uint8Array, needle: Uint8Array): number {
  let count = 0;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    count++;
  }
  return count;
}

describe('renderKitchenReceipt — ortak sözleşme (k)', () => {
  it('opens with RESET + ESC t 29 and ends with CUT_FULL (both layouts)', () => {
    for (const params of [baseParams(), paketParams()]) {
      const out = renderKitchenReceipt(params);
      // İlk 5 bayt ESC @ + ESC t 29 (JP80H CP857 — ADR-004 Amd3 DEĞİŞMEZ).
      expect(Array.from(out.subarray(0, 5))).toEqual([
        0x1b, 0x40, 0x1b, 0x74, 0x1d,
      ]);
      // Son 4 bayt GS V 66 0.
      expect(Array.from(out.subarray(out.length - 4))).toEqual([
        0x1d, 0x56, 0x42, 0x00,
      ]);
    }
  });

  it('renders Turkish CP857 bytes correctly (Ğ=0xA6, ğ=0xA7) (j)', () => {
    const out = renderKitchenReceipt(
      baseParams({ items: [makeItem({ name: 'Dağ Kekikli Boğaça' })] }),
    );
    const needle = encodeCP857('Dağ Kekikli Boğaça');
    expect(bufferContains(out, needle)).toBe(true);
    expect(Array.from(needle)).toContain(0xa7); // ğ
  });
});

describe('Layout A — masa (dine_in) kompakt fişi', () => {
  it('prints local datetime as-is, "Adisyon No", bold "Bölge | Masa" and server (a,i)', () => {
    const out = renderKitchenReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('10.07.2026 15:00:14'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Adisyon No: 109'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Salon | Masa 5'))).toBe(true);
    expect(bufferContains(out, encodeCP857('İlhan'))).toBe(true);
  });

  it('omits tenant header, MUTFAK label, course header and prices (a — K3)', () => {
    const out = renderKitchenReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('Dilan Pide'))).toBe(false);
    expect(bufferContains(out, encodeCP857('MUTFAK'))).toBe(false);
    expect(bufferContains(out, encodeCP857('MARŞ'))).toBe(false);
    // Fiyat basılmaz (total 1.900,00 hiçbir yerde geçmez).
    expect(bufferContains(out, encodeCP857('1.900,00'))).toBe(false);
    expect(bufferContains(out, encodeCP857('TUTAR'))).toBe(false);
  });

  it('renders item as "name ... qty variant" ("5 Tam") (a — K4)', () => {
    const out = renderKitchenReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('Karışık Pide'))).toBe(true);
    expect(bufferContains(out, encodeCP857('5 Tam'))).toBe(true);
  });

  it('renders qty only when variant is null (a — K4)', () => {
    const out = renderKitchenReceipt(
      baseParams({ items: [makeItem({ variantName: null, qty: 3 })] }),
    );
    // twoCol sağ kolon " 3" ile biter (variant eki yok) — satır sonu LF.
    expect(bufferContains(out, encodeCP857(' 3\n'.trimEnd()))).toBe(true);
    expect(bufferContains(out, encodeCP857('3 Tam'))).toBe(false);
  });

  it('prints big centered "- <order_no> -" footer (a)', () => {
    const out = renderKitchenReceipt(baseParams({ order_no: 111 }));
    expect(bufferContains(out, encodeCP857('- 111 -'))).toBe(true);
  });

  it('uses omitted area gracefully (only "Masa 5")', () => {
    const out = renderKitchenReceipt(baseParams({ area_label: null }));
    expect(bufferContains(out, encodeCP857('Salon | '))).toBe(false);
    expect(bufferContains(out, encodeCP857('Masa 5'))).toBe(true);
  });
});

describe('Layout B — paket (kurye) fişi', () => {
  it('prints tenant header, order channel, customer block and payment type (b — K3/K7/K8)', () => {
    const out = renderKitchenReceipt(paketParams());
    expect(bufferContains(out, encodeCP857('Dilan Pide'))).toBe(true);
    expect(
      bufferContains(out, encodeCP857('Sipariş Kanalı: Paket / Adrese Teslim')),
    ).toBe(true);
    expect(bufferContains(out, encodeCP857('Müşteri : İlhan Avcı'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Telefon : 5398400856'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Adres   : Mürefte'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Tarif   : ÇATAL-BIÇAK'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Ödeme   : Nakit'))).toBe(true);
  });

  it('renders priced item rows and TUTAR + AFİYET OLSUN (b — K4)', () => {
    const out = renderKitchenReceipt(paketParams());
    // 3-kolon: tutar "1.900,00" kalem satırında; TUTAR toplamı "1.430,00 TL".
    expect(bufferContains(out, encodeCP857('1.900,00'))).toBe(true);
    expect(bufferContains(out, encodeCP857('TUTAR'))).toBe(true);
    expect(bufferContains(out, encodeCP857('1.430,00 TL'))).toBe(true);
    expect(bufferContains(out, encodeCP857('AFİYET OLSUN'))).toBe(true);
  });

  it('shrinks gracefully when customer/address absent — no crash, no labels (c — K8)', () => {
    const out = renderKitchenReceipt(
      paketParams({
        customer_name: null,
        customer_phone: null,
        delivery_address: null,
        delivery_note: null,
        planned_payment_type: null,
      }),
    );
    // Etiket-kolon biçimiyle ara ("Adres" düz metni "Adrese Teslim" kanal
    // etiketinde de geçer — yalnız "Etiket  : " satır ön eki blok kanıtıdır).
    expect(bufferContains(out, encodeCP857('Müşteri : '))).toBe(false);
    expect(bufferContains(out, encodeCP857('Telefon : '))).toBe(false);
    expect(bufferContains(out, encodeCP857('Adres   : '))).toBe(false);
    expect(bufferContains(out, encodeCP857('Tarif   : '))).toBe(false);
    expect(bufferContains(out, encodeCP857('Ödeme   : '))).toBe(false);
    // Kalem + TUTAR yine basılır.
    expect(bufferContains(out, encodeCP857('TUTAR'))).toBe(true);
  });

  it('word-wraps long address into indented continuation lines (b — K8)', () => {
    const out = renderKitchenReceipt(
      paketParams({
        delivery_address:
          'Mahalle Mürefte Şarköy Sokak Mürefte Köyü İç Yolu Apt avci No 1 Kat 2 Daire 3',
      }),
    );
    // Devam satırı 10 boşluk girintiyle başlar.
    expect(bufferContains(out, encodeCP857('\n          '))).toBe(true);
  });

  it('truncates long name/variant to their columns — row stays 48 wide (h)', () => {
    const out = renderKitchenReceipt(
      paketParams({
        items: [
          makeItem({
            name: 'Çok Uzun İsimli Kaşarlı Kıymalı Special Pide',
            variantName: 'Bir buçuk porsiyon',
            qty: 1,
          }),
        ],
      }),
    );
    // Ad 24 kolona kırpılır; variant "1 Bir buçuk…" 12 kolona kırpılır
    // (Adisyo "1 Bir buç" paritesi) — tam metinler geçmez.
    expect(
      bufferContains(out, encodeCP857('Çok Uzun İsimli Kaşarlı Kıymalı')),
    ).toBe(false);
    expect(bufferContains(out, encodeCP857('Bir buçuk porsiyon'))).toBe(false);
    expect(bufferContains(out, encodeCP857('1 Bir buçuk'))).toBe(true);
  });
});

describe('not + seçenek satırları (d, e — K5/K6)', () => {
  it('renders note UPPERCASED (Turkish-correct) on its own line, no "! Not:" prefix (d)', () => {
    const out = renderKitchenReceipt(
      baseParams({
        items: [makeItem({ note: 'az mercimek istiyor' })],
      }),
    );
    expect(bufferContains(out, encodeCP857('AZ MERCİMEK İSTİYOR'))).toBe(true);
    expect(bufferContains(out, encodeCP857('! Not:'))).toBe(false);
    expect(bufferContains(out, encodeCP857('az mercimek'))).toBe(false);
  });

  it('renders attributes as "[opt, opt]" line in both layouts (e)', () => {
    for (const params of [
      baseParams({ items: [makeItem({ modifiers: ['Yumurtalı', 'Acılı'] })] }),
      paketParams({ items: [makeItem({ modifiers: ['Yumurtalı', 'Acılı'] })] }),
    ]) {
      const out = renderKitchenReceipt(params);
      expect(bufferContains(out, encodeCP857('  [Yumurtalı, Acılı]'))).toBe(true);
    }
  });
});

describe('CP857 sanitizasyon (f, g — K10, chip task_df442130)', () => {
  it('does NOT throw on em-dash server placeholder / em-dash note (f)', () => {
    expect(() =>
      renderKitchenReceipt(baseParams({ server_name: '—' })),
    ).not.toThrow();
    const out = renderKitchenReceipt(
      baseParams({ items: [makeItem({ note: 'soğansız — acısız' })] }),
    );
    // Em-dash '-' oldu, not büyük harf.
    expect(bufferContains(out, encodeCP857('SOĞANSIZ - ACISIZ'))).toBe(true);
  });

  it('renders "-" for null server (no em-dash bytes anywhere)', () => {
    const out = renderKitchenReceipt(baseParams({ server_name: null }));
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(20);
  });

  it('strips raw control bytes from free text — no injected CUT (g)', () => {
    const out = renderKitchenReceipt(
      baseParams({
        items: [makeItem({ note: 'kes\x1d\x56\x42imi dene', name: 'Pide\x1b@' })],
      }),
    );
    // GS V 66 (kesim) yalnız fiş sonunda 1 kez; nottaki enjeksiyon silindi.
    expect(countOccurrences(out, new Uint8Array([0x1d, 0x56, 0x42]))).toBe(1);
    // ESC @ (reset) yalnız başta 1 kez.
    expect(countOccurrences(out, new Uint8Array([0x1b, 0x40]))).toBe(1);
  });

  it('replaces unmappable characters with "?" instead of throwing', () => {
    const out = renderKitchenReceipt(
      baseParams({ items: [makeItem({ name: 'Pizza 🍕 Special' })] }),
    );
    expect(bufferContains(out, encodeCP857('Pizza ? Special'))).toBe(true);
  });
});
