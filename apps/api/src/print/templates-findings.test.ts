import { describe, expect, it } from 'vitest';
import { encodeCP857 } from '@restoran-pos/shared-domain';
import { renderBillReceipt, type BillReceiptParams } from './templates/bill-receipt.js';
import {
  renderKitchenReceipt,
  type KitchenReceiptItem,
  type KitchenReceiptParams,
} from './templates/kitchen-receipt.js';
import { twoCol, WIDTH } from './templates/receipt-layout.js';
import { formatReceiptDateTime } from './format-receipt-datetime.js';

/**
 * Blok 8 HAT B — QA derin denetim, KIRMIZI paket.
 *
 * Bu testler MEVCUT davranışı değil, OLMASI GEREKEN davranışı ifade eder.
 * Implementer fix'lemeden bu dosya vitest'te KIRMIZI kalması beklenir.
 * bill-receipt.test.ts / kitchen-receipt.test.ts / format-receipt-datetime.test.ts
 * DEĞİŞTİRİLMEDİ — bu ayrı bir dosya.
 */

function baseBillParams(overrides: Partial<BillReceiptParams> = {}): BillReceiptParams {
  return {
    tenant_header: 'Pide Salonu',
    order_no: 42,
    order_type: 'dine_in',
    server_name: 'İlhan',
    table_label: 'Masa 5',
    area_label: null,
    items: [
      { name: 'Kıymalı Pide', qty: 2, lineTotalCents: 36000, note: null, modifiers: [] },
    ],
    totalCents: 36000,
    payments: [],
    paidTotalCents: 0,
    remainingCents: 36000,
    created_at_local: '29.06.2026  20:30',
    ...overrides,
  };
}

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

function baseKitchenParams(
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

/** Naive byte-array contains-subsequence check (mevcut test dosyalarıyla aynı). */
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

/** Marker byte dizisini içeren LF-sınırlı satırı (LF hariç) döner. */
function extractLine(haystack: Uint8Array, markerBytes: Uint8Array): Uint8Array {
  let start = -1;
  outer: for (let i = 0; i <= haystack.length - markerBytes.length; i++) {
    for (let j = 0; j < markerBytes.length; j++) {
      if (haystack[i + j] !== markerBytes[j]) continue outer;
    }
    start = i;
    break;
  }
  if (start === -1) throw new Error('extractLine: marker bulunamadı');
  let lineStart = start;
  while (lineStart > 0 && haystack[lineStart - 1] !== 0x0a) lineStart--;
  let lineEnd = start;
  while (lineEnd < haystack.length && haystack[lineEnd] !== 0x0a) lineEnd++;
  return haystack.subarray(lineStart, lineEnd);
}

describe('P8-TPL-01 — twoCol: right.length >= WIDTH iken satır 48 kolonu aşıyor (sola taşma)', () => {
  it('[root cause] twoCol(receipt-layout.ts) satırı WIDTH(48) içinde tutamıyor', () => {
    // right >= WIDTH(48) olunca maxLeft negatife düşer; left.slice(0, negatif)
    // BAŞTAN kırpma yerine SONDAN kırpar → satır 48'i aşar.
    const right = 'X'.repeat(50);
    const result = twoCol('Kısa Sol Metin', right);
    expect(result.length).toBeLessThanOrEqual(WIDTH);
  });

  it('[kitchen Layout A] uzun porsiyon (variant) adı satırı 48 kolonu aşıyor', () => {
    // "5 " + 46 karakter = 48 → right.length >= WIDTH eşiği aşılıyor.
    const longVariant = 'Ekstra Bol Malzemeli Aile Boyu Buçuk Porsiyonu';
    const out = renderKitchenReceipt(
      baseKitchenParams({
        items: [makeItem({ name: 'Karışık Pide', qty: 5, variantName: longVariant })],
      }),
    );
    const line = extractLine(out, encodeCP857('Karışık'));
    expect(line.length).toBeLessThanOrEqual(WIDTH);
  });

  it('[bill + kitchen] uzun bölge+masa etiketi satırı 48 kolonu aşıyor', () => {
    // Anchor sağ-kolon metninde ("Masa 100") — twoCol right'ı HİÇ kırpmaz,
    // yalnız left'i (Garson/Adisyon No) kırpar; bug ağırsa left o kadar
    // kısalır ki kendi anchor'ı bile silinebilir (bkz. ilk deneme notu).
    const longArea = 'Zemin Kat Sokağa Bakan Cam Kenarı Oturma Alanı';
    const bill = renderBillReceipt(
      baseBillParams({ area_label: longArea, table_label: 'Masa 100', server_name: 'İlhan' }),
    );
    const billLine = extractLine(bill, encodeCP857('Masa 100'));
    expect(billLine.length).toBeLessThanOrEqual(WIDTH);

    const kitchen = renderKitchenReceipt(
      baseKitchenParams({ area_label: longArea, table_label: 'Masa 100' }),
    );
    const kitchenLine = extractLine(kitchen, encodeCP857('Masa 100'));
    expect(kitchenLine.length).toBeLessThanOrEqual(WIDTH);
  });
});

describe('P8-TPL-02 — formatReceiptDateTime geçersiz ISO tarihte throw ediyor (yalnız tz fallback var)', () => {
  it('geçersiz ISO string (tz geçerliyken) print job’ı öldürmemeli', () => {
    expect(() =>
      formatReceiptDateTime('not-a-real-date', 'Europe/Istanbul'),
    ).not.toThrow();
  });

  it('boş string ISO değeri print job’ı öldürmemeli', () => {
    expect(() => formatReceiptDateTime('', 'Europe/Istanbul')).not.toThrow();
  });
});

describe('P8-TPL-03 — presence-check ham metinde, render sanitize-sonrası: sanitize sonrası boşalan alan yine satır basıyor', () => {
  it('[bill] yalnız kontrol baytlarından oluşan not "  ()" boş satırını basmamalı', () => {
    const out = renderBillReceipt(
      baseBillParams({
        items: [
          { name: 'Lahmacun', qty: 1, lineTotalCents: 5000, note: '\x01\x02\x03', modifiers: [] },
        ],
      }),
    );
    expect(bufferContains(out, encodeCP857('  ()'))).toBe(false);
  });

  it('[kitchen] yalnız kontrol baytından oluşan seçenek "  []" boş satırını basmamalı', () => {
    const out = renderKitchenReceipt(
      baseKitchenParams({ items: [makeItem({ modifiers: ['\x01'] })] }),
    );
    expect(bufferContains(out, encodeCP857('  []'))).toBe(false);
  });

  it('[kitchen Layout B] yalnız kontrol baytından oluşan müşteri adı bloğu tamamen atlanmalı', () => {
    const out = renderKitchenReceipt(
      baseKitchenParams({
        order_type: 'delivery',
        table_label: null,
        area_label: null,
        customer_name: '\x01',
      }),
    );
    // customer_name sanitize sonrası '' olur; diğer müşteri alanları da null →
    // blok TAMAMEN atlanmalı ("Müşteri" kelimesi hiçbir yerde geçmemeli).
    expect(bufferContains(out, encodeCP857('Müşteri'))).toBe(false);
  });
});
