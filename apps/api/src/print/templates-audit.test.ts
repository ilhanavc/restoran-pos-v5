import { describe, expect, it } from 'vitest';
import { encodeCP857 } from '@restoran-pos/shared-domain';
import { renderBillReceipt, type BillReceiptParams } from './templates/bill-receipt.js';
import {
  renderKitchenReceipt,
  type KitchenReceiptItem,
  type KitchenReceiptParams,
} from './templates/kitchen-receipt.js';
import { formatReceiptDateTime } from './format-receipt-datetime.js';

/**
 * Blok 8 HAT B — QA derin denetim, YEŞİL paket.
 *
 * Bu dosya MEVCUT davranışı doğrular (regresyon kilidi + "temiz alan" kanıtı).
 * bill-receipt.test.ts / kitchen-receipt.test.ts / format-receipt-datetime.test.ts
 * DEĞİŞTİRİLMEDİ — bu ayrı, ek bir dosya.
 *
 * Kırmızı paket (bulgular): ./templates-findings.test.ts — P8-TPL-01/02/03.
 * Bu dosyadaki ID'ler devam eder: P8-TPL-04..12 (bulguların çoğu INFO/temiz).
 */

function baseParams(overrides: Partial<BillReceiptParams> = {}): BillReceiptParams {
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

function paketKitchenParams(
  overrides: Partial<KitchenReceiptParams> = {},
): KitchenReceiptParams {
  return baseKitchenParams({
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

/** Naive byte-array contains-subsequence check (mevcut test dosyalarıyla aynı desen). */
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

describe('P8-TPL-04 (INFO) — remainingCents negatif ise (overpayment) template alt sınır uygulamıyor', () => {
  it('template kendi hesaplamıyor; negatif remainingCents "-" işaretiyle olduğu gibi basılır', () => {
    // Not: aşırı-ödeme engeli (varsa) payments domain'inin sorumluluğu — bu
    // yalnız render katmanının davranışını belgeler (clamp YOK).
    const out = renderBillReceipt(
      baseParams({
        payments: [
          { type: 'cash', amountCents: 20000 },
          { type: 'card', amountCents: 25000 },
        ],
        paidTotalCents: 45000,
        remainingCents: -6500,
        totalCents: 38500,
      }),
    );
    expect(bufferContains(out, encodeCP857('-65,00 TL'))).toBe(true);
  });
});

describe('P8-TPL-05 (INFO) — AMT_W(12) aşan tutar en anlamlı haneleri korur (sondan kırpar)', () => {
  it('13 karakterlik tutar son karakterini kaybeder, baş haneler korunur', () => {
    const out = renderBillReceipt(
      baseParams({
        items: [
          { name: 'Test', qty: 1, lineTotalCents: 1_000_000_000, note: null, modifiers: [] },
        ],
      }),
    );
    // "10.000.000,00" (13 char) > AMT_W(12) → slice(0,12) = "10.000.000,0".
    expect(bufferContains(out, encodeCP857('10.000.000,0'))).toBe(true);
    expect(bufferContains(out, encodeCP857('10.000.000,00'))).toBe(false);
  });
});

describe('P8-TPL-06 (ROB, temiz) — 0 kalem ve 40+ kalemli fiş çökmeden render edilir', () => {
  it('bill: 0 kalem → toplam/footer yine basılır', () => {
    const out = renderBillReceipt(baseParams({ items: [], totalCents: 0, remainingCents: 0 }));
    expect(out).toBeInstanceOf(Uint8Array);
    expect(bufferContains(out, encodeCP857('TUTAR'))).toBe(true);
    expect(bufferContains(out, encodeCP857('AFİYET OLSUN'))).toBe(true);
  });

  it('bill: 40 kalemli fiş çökmeden render edilir, ilk ve son kalem geçer', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      name: `Ürün ${i + 1}`,
      qty: 1,
      lineTotalCents: 1000,
      note: null,
      modifiers: [],
    }));
    const out = renderBillReceipt(baseParams({ items, totalCents: 40000, remainingCents: 40000 }));
    expect(bufferContains(out, encodeCP857('Ürün 1'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Ürün 40'))).toBe(true);
  });

  it('kitchen Layout A: 0 kalem ve 40 kalem çökmeden render edilir', () => {
    const zero = renderKitchenReceipt(baseKitchenParams({ items: [] }));
    expect(zero).toBeInstanceOf(Uint8Array);
    expect(bufferContains(zero, encodeCP857('- 109 -'))).toBe(true); // footer yine basılır

    const items = Array.from({ length: 40 }, (_, i) => makeItem({ name: `Ürün ${i + 1}` }));
    const forty = renderKitchenReceipt(baseKitchenParams({ items }));
    expect(bufferContains(forty, encodeCP857('Ürün 1'))).toBe(true);
    expect(bufferContains(forty, encodeCP857('Ürün 40'))).toBe(true);
  });

  it('kitchen Layout B: 0 kalem ve 40 kalem çökmeden render edilir', () => {
    const zero = renderKitchenReceipt(paketKitchenParams({ items: [] }));
    expect(zero).toBeInstanceOf(Uint8Array);
    expect(bufferContains(zero, encodeCP857('TUTAR'))).toBe(true);

    const items = Array.from({ length: 40 }, (_, i) => makeItem({ name: `Ürün ${i + 1}` }));
    const forty = renderKitchenReceipt(paketKitchenParams({ items }));
    expect(bufferContains(forty, encodeCP857('Ürün 1'))).toBe(true);
    expect(bufferContains(forty, encodeCP857('Ürün 40'))).toBe(true);
  });
});

describe('P8-TPL-07 (temiz) — koşullu ödeme dökümü: kısmi ödeme + 3 türlü split doğru render edilir', () => {
  it('kısmi ödeme: Kalan sıfırdan büyük doğru basılır', () => {
    const out = renderBillReceipt(
      baseParams({
        payments: [
          { type: 'cash', amountCents: 10000 },
          { type: 'card', amountCents: 5000 },
        ],
        paidTotalCents: 15000,
        remainingCents: 23500, // totalCents(38500) - 15000
      }),
    );
    expect(bufferContains(out, encodeCP857('Kalan'))).toBe(true);
    expect(bufferContains(out, encodeCP857('235,00 TL'))).toBe(true);
  });

  it('3 türlü ödeme (nakit+kart+havale) tümü döküme girer', () => {
    const out = renderBillReceipt(
      baseParams({
        payments: [
          { type: 'cash', amountCents: 10000 },
          { type: 'card', amountCents: 20000 },
          { type: 'transfer', amountCents: 8500 },
        ],
        paidTotalCents: 38500,
        remainingCents: 0,
      }),
    );
    expect(bufferContains(out, encodeCP857('Nakit'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Kredi Kartı'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Havale/EFT'))).toBe(true);
    expect(bufferContains(out, encodeCP857('0,00 TL'))).toBe(true); // Kalan
  });
});

describe('P8-TPL-08 (temiz — P8-TPL-01 ile ZIT örnek) — uzun ürün adı 48 kolonu AŞMADAN güvenli kırpılır', () => {
  it('bill: 40 karakterlik ürün adı NAME_W(30)a kırpılır, satır tam 48 kolon', () => {
    const longName = 'A'.repeat(40);
    const out = renderBillReceipt(
      baseParams({ items: [{ name: longName, qty: 1, lineTotalCents: 1000, note: null, modifiers: [] }] }),
    );
    const line = extractLine(out, encodeCP857('A'.repeat(30)));
    expect(line.length).toBe(48);
    expect(bufferContains(out, encodeCP857('A'.repeat(31)))).toBe(false); // 31. A basılmaz
  });

  it('kitchen Layout B: 40 karakterlik ürün adı B_NAME_W(24)e kırpılır, satır tam 48 kolon', () => {
    const longName = 'B'.repeat(40);
    const out = renderKitchenReceipt(
      paketKitchenParams({ items: [makeItem({ name: longName, variantName: null })] }),
    );
    const line = extractLine(out, encodeCP857('B'.repeat(24)));
    expect(line.length).toBe(48);
  });
});

describe('P8-TPL-09 (temiz) — desteklenmeyen karakter (emoji/€) sanitize edilir, throw etmez', () => {
  it('bill: € sembolü ürün adında "?" olur, throw etmez', () => {
    const params = baseParams({
      items: [{ name: 'Kahve €5', qty: 1, lineTotalCents: 1000, note: null, modifiers: [] }],
    });
    expect(() => renderBillReceipt(params)).not.toThrow();
    const out = renderBillReceipt(params);
    expect(bufferContains(out, encodeCP857('Kahve ?5'))).toBe(true);
  });

  it('bill: emoji ürün adında "?" olur', () => {
    const out = renderBillReceipt(
      baseParams({ items: [{ name: 'Pizza 🍕', qty: 1, lineTotalCents: 1000, note: null, modifiers: [] }] }),
    );
    expect(bufferContains(out, encodeCP857('Pizza ?'))).toBe(true);
  });

  it('bill: tenant_header / area_label içindeki kontrol baytı enjeksiyonu temizlenir', () => {
    const out = renderBillReceipt(
      baseParams({
        tenant_header: 'Pide\x1bSalonu',
        area_label: 'Bahç\x07e',
        table_label: 'Masa 1',
      }),
    );
    expect(bufferContains(out, encodeCP857('PideSalonu'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Bahçe - Masa 1'))).toBe(true);
  });

  it('kitchen Layout B: delivery_address / customer_phone içindeki kontrol baytı enjeksiyonu temizlenir', () => {
    const out = renderKitchenReceipt(
      paketKitchenParams({
        customer_phone: '539\x1d84008\x1b56',
        delivery_address: 'Mürefte\x07 Sok.',
      }),
    );
    expect(bufferContains(out, encodeCP857('Telefon : 5398400856'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Adres   : Mürefte Sok.'))).toBe(true);
  });
});

describe('P8-TPL-10 (temiz) — format-receipt-datetime + template entegrasyonu: gece yarısı/tz', () => {
  it('gece yarısını geçen İstanbul saati fişte doğru yerel tarihe basılır (UTC tarihi GÖRÜNMEZ)', () => {
    // 22:30 UTC = ertesi gün 01:30 İstanbul (format-receipt-datetime.test.ts ile aynı vaka).
    const local = formatReceiptDateTime('2026-07-10T22:30:00.000Z', 'Europe/Istanbul');
    const out = renderKitchenReceipt(baseKitchenParams({ created_at_local: local }));
    expect(bufferContains(out, encodeCP857('11.07.2026 01:30:00'))).toBe(true);
    expect(bufferContains(out, encodeCP857('10.07.2026'))).toBe(false);
  });

  it('bill: aynı gece-yarısı geçişi kasa fişinde de doğru basılır', () => {
    const local = formatReceiptDateTime('2026-07-10T22:30:00.000Z', 'Europe/Istanbul');
    const out = renderBillReceipt(baseParams({ created_at_local: local }));
    expect(bufferContains(out, encodeCP857('11.07.2026 01:30:00'))).toBe(true);
  });
});

describe('P8-TPL-11 (ROB, temiz) — null/eksik alan: masa yok = paket, dine_in defansif dal', () => {
  it('bill: table_label null → "PAKET" basılır (area yok sayılır)', () => {
    const out = renderBillReceipt(baseParams({ table_label: null, area_label: 'Bahçe' }));
    expect(bufferContains(out, encodeCP857('PAKET'))).toBe(true);
  });

  it('kitchen Layout A: table_label null iken (teorik olarak imkansız) çökmeden "-" basar', () => {
    const out = renderKitchenReceipt(baseKitchenParams({ table_label: null, area_label: 'Bahçe' }));
    expect(out).toBeInstanceOf(Uint8Array);
    expect(bufferContains(out, encodeCP857('Bahçe | '))).toBe(false);
  });

  it('kitchen Layout B: müşterisiz manuel paket — bloklar tamamen atlanır, çökmez', () => {
    const out = renderKitchenReceipt(
      paketKitchenParams({
        customer_name: null,
        customer_phone: null,
        delivery_address: null,
        delivery_note: null,
        planned_payment_type: null,
      }),
    );
    expect(out).toBeInstanceOf(Uint8Array);
    expect(bufferContains(out, encodeCP857('TUTAR'))).toBe(true);
  });
});

describe('P8-TPL-12 (temiz) — tüm Türkçe karakter seti ürün adında round-trip korunuyor (bill + kitchen A/B)', () => {
  const TURKISH_CHARSET = 'çÇüÜöÖşŞıİğĞ';

  it('bill', () => {
    const out = renderBillReceipt(
      baseParams({
        items: [{ name: TURKISH_CHARSET, qty: 1, lineTotalCents: 1000, note: null, modifiers: [] }],
      }),
    );
    expect(bufferContains(out, encodeCP857(TURKISH_CHARSET))).toBe(true);
  });

  it('kitchen Layout A', () => {
    const out = renderKitchenReceipt(
      baseKitchenParams({ items: [makeItem({ name: TURKISH_CHARSET, variantName: null })] }),
    );
    expect(bufferContains(out, encodeCP857(TURKISH_CHARSET))).toBe(true);
  });

  it('kitchen Layout B', () => {
    const out = renderKitchenReceipt(
      paketKitchenParams({ items: [makeItem({ name: TURKISH_CHARSET, variantName: null })] }),
    );
    expect(bufferContains(out, encodeCP857(TURKISH_CHARSET))).toBe(true);
  });
});
