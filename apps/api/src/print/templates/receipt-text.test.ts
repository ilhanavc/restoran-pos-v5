/**
 * ADR-045 K2/K3/K6 — işletme fiş metninin kasa ve paket fişine basılması.
 *
 * Çizim çağrıları (`ReceiptCanvas.prototype.centered`) kaydedilerek sınanır:
 * bayt içeriği raster olduğu için okunamaz, ama hangi metnin hangi sırada ve
 * hangi puntoyla çizildiği okunabilir (bkz. `receipt-golden.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RECEIPT_TEXT,
  resolveReceiptText,
  type ResolvedReceiptText,
} from '@restoran-pos/shared-domain';
import { RECEIPT_TEXT_LIMITS } from '@restoran-pos/shared-types';
import { ReceiptCanvas, SIZES, computeLineHeight } from '../raster/canvas-render.js';
import { renderBillReceipt } from './bill-receipt.js';
import { renderPackingReceipt } from './packing-receipt.js';
import { BILL_SCENARIOS, PACKING_SCENARIOS } from './receipt-golden-scenarios.js';

const BILL = BILL_SCENARIOS['bill-dine-in-split-payment']!;
const PACKING = PACKING_SCENARIOS['packing-delivery-full-customer']!;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Render süresince `centered` ile çizilen metinleri sırayla döner. */
function centeredTexts(render: () => Uint8Array): Array<{ text: string; size: number; bold: boolean }> {
  const out: Array<{ text: string; size: number; bold: boolean }> = [];
  const original = ReceiptCanvas.prototype.centered;
  vi.spyOn(ReceiptCanvas.prototype, 'centered').mockImplementation(function (
    this: ReceiptCanvas,
    text: string,
    opts: { size: number; bold?: boolean },
  ) {
    out.push({ text, size: opts.size, bold: opts.bold ?? false });
    return original.call(this, text, opts);
  });
  render();
  return out;
}

const custom = (
  header: string[],
  footer: string[] | null,
): ResolvedReceiptText =>
  resolveReceiptText({ headerLines: header, footerLines: footer }, { enabled: true }).text;

describe('kasa fişi — işletme metni', () => {
  it('üst satırlar işletme adının HEMEN altında, tek punto ve kalın değil', () => {
    const texts = centeredTexts(() =>
      renderBillReceipt({ ...BILL, receipt_text: custom(['Adres: Atatürk Cad. 12', 'Tel: 0212 555 44 33'], null) }),
    );
    expect(texts.slice(0, 4).map((t) => t.text)).toEqual([
      BILL.tenant_header,
      'Adres: Atatürk Cad. 12',
      'Tel: 0212 555 44 33',
      BILL.created_at_local,
    ]);
    expect(texts[1]).toEqual({ text: 'Adres: Atatürk Cad. 12', size: SIZES.meta, bold: false });
  });

  it('alt bilgi NULL → gömülü kapanış AYNEN ("Afiyet olsun / Teşekkür ederiz")', () => {
    const texts = centeredTexts(() => renderBillReceipt({ ...BILL, receipt_text: custom([], null) }));
    expect(texts.slice(-2).map((t) => t.text)).toEqual(['Afiyet olsun', 'Teşekkür ederiz']);
  });

  it('özel alt bilgi gömülü kapanışın YERİNE basılır', () => {
    const texts = centeredTexts(() =>
      renderBillReceipt({ ...BILL, receipt_text: custom([], ['Yine bekleriz', 'pidesalonu.com.tr']) }),
    );
    const all = texts.map((t) => t.text);
    expect(all.slice(-2)).toEqual(['Yine bekleriz', 'pidesalonu.com.tr']);
    expect(all).not.toContain('Afiyet olsun');
    expect(all).not.toContain('Teşekkür ederiz');
  });

  it('🔴 alt bilgi [] → HİÇ kapanış yok (NULL ile AYNI ŞEY DEĞİL)', () => {
    const texts = centeredTexts(() => renderBillReceipt({ ...BILL, receipt_text: custom([], []) }));
    const all = texts.map((t) => t.text);
    expect(all).not.toContain('Afiyet olsun');
    expect(all).not.toContain('Teşekkür ederiz');
    // Son ortalanmış çizim artık fişin üst bölümünden bir satırdır, kapanış değil.
    expect(all.at(-1)).toBe(BILL.created_at_local);
  });
});

describe('kasa fişi — deneme işareti (ADR-045 K7, PR-2)', () => {
  it('test_marker → en üstte "DENEME FİŞİ", ardından fiş aynen', () => {
    const normal = centeredTexts(() => renderBillReceipt({ ...BILL, receipt_text: custom([], null) }));
    vi.restoreAllMocks();
    const test = centeredTexts(() =>
      renderBillReceipt({ ...BILL, receipt_text: custom([], null), test_marker: true }),
    );
    expect(test[0]).toEqual({ text: '*** DENEME FİŞİ ***', size: SIZES.total, bold: true });
    expect(test.slice(1)).toEqual(normal);
  });

  it('test_marker false → işaret YOK', () => {
    const texts = centeredTexts(() =>
      renderBillReceipt({ ...BILL, receipt_text: custom([], null), test_marker: false }),
    );
    expect(texts.map((t) => t.text)).not.toContain('*** DENEME FİŞİ ***');
  });
});

describe('paket fişi — işletme metni', () => {
  it('üst satırlar işletme adı ile "PAKET SİPARİŞ" arasında', () => {
    const texts = centeredTexts(() =>
      renderPackingReceipt({ ...PACKING, receipt_text: custom(['Tel: 0212 555 44 33'], null) }),
    );
    expect(texts.slice(0, 3).map((t) => t.text)).toEqual([
      PACKING.tenant_header,
      'Tel: 0212 555 44 33',
      'PAKET SİPARİŞ',
    ]);
  });

  it('alt bilgi NULL → "AFİYET OLSUN"; özel → yerine; [] → hiç', () => {
    const def = centeredTexts(() => renderPackingReceipt({ ...PACKING, receipt_text: custom([], null) }));
    expect(def.at(-1)?.text).toBe('AFİYET OLSUN');

    vi.restoreAllMocks();
    const cus = centeredTexts(() =>
      renderPackingReceipt({ ...PACKING, receipt_text: custom([], ['Yine bekleriz']) }),
    );
    expect(cus.at(-1)?.text).toBe('Yine bekleriz');
    expect(cus.map((t) => t.text)).not.toContain('AFİYET OLSUN');

    vi.restoreAllMocks();
    const none = centeredTexts(() => renderPackingReceipt({ ...PACKING, receipt_text: custom([], []) }));
    expect(none.map((t) => t.text)).not.toContain('AFİYET OLSUN');
  });
});

/**
 * ⚠️ Bu blok YENİ kodu yeni kodla karşılaştırır (çözümleyicinin NULL sonucu /
 * kill-switch ↔ `DEFAULT_RECEIPT_TEXT`). "Bugünkü fiş korundu" güvencesinin
 * ASIL kaynağı değişiklik öncesi üretilmiş altın çizim kaydıdır
 * (`receipt-golden.test.ts`); bu blok onu tamamlar, yerine geçmez.
 */
describe('varsayılana giden her yol aynı baytları üretir (aynı süreçte)', () => {
  it('çözümleyicinin NULL/NULL sonucu ile DEFAULT_RECEIPT_TEXT aynı baytları üretir', () => {
    const resolved = resolveReceiptText({ headerLines: null, footerLines: null }, { enabled: true }).text;
    expect(Buffer.from(renderBillReceipt({ ...BILL, receipt_text: resolved }))).toEqual(
      Buffer.from(renderBillReceipt({ ...BILL, receipt_text: DEFAULT_RECEIPT_TEXT })),
    );
    expect(Buffer.from(renderPackingReceipt({ ...PACKING, receipt_text: resolved }))).toEqual(
      Buffer.from(renderPackingReceipt({ ...PACKING, receipt_text: DEFAULT_RECEIPT_TEXT })),
    );
  });

  it('kill-switch kapalıyken (geçerli metin olsa bile) baytlar varsayılanla aynı', () => {
    const switchedOff = resolveReceiptText(
      { headerLines: ['Adres'], footerLines: [] },
      { enabled: false },
    ).text;
    expect(Buffer.from(renderBillReceipt({ ...BILL, receipt_text: switchedOff }))).toEqual(
      Buffer.from(renderBillReceipt({ ...BILL, receipt_text: DEFAULT_RECEIPT_TEXT })),
    );
  });

  it('özel metin baytları GERÇEKTEN değiştirir (yukarıdaki eşitlik boş bir eşitlik değil)', () => {
    expect(Buffer.from(renderBillReceipt({ ...BILL, receipt_text: custom(['Adres'], null) }))).not.toEqual(
      Buffer.from(renderBillReceipt({ ...BILL, receipt_text: DEFAULT_RECEIPT_TEXT })),
    );
  });
});

/**
 * ADR-045 K6.2 — `RECEIPT_TEXT_LIMITS` ölçülerek seçildi; bu test o ölçümü
 * GERÇEK çiziciyle tekrarlar. Font, punto ya da kâğıt genişliği değişirse
 * kırmızıya döner ve sınırın yeniden ölçülmesi gerektiğini söyler.
 *
 * Satır sayısı, tek satırlık bir `centered` çizimin bitmap yüksekliğine göre
 * farktan bulunur: Δyükseklik = (satır − 1) × satır yüksekliği.
 */
describe('kalibrasyon — satır sınırı kâğıtta ölçülür', () => {
  const lh = computeLineHeight(SIZES.meta);
  const linesOf = (text: string): number => {
    const height = (t: string): number =>
      new ReceiptCanvas().centered(t, { size: SIZES.meta }).build().height;
    return 1 + (height(text) - height('a')) / lh;
  };
  const max = RECEIPT_TEXT_LIMITS.maxCharsPerLine;

  it('gerçekçi 35 karakterlik adres satırı TEK satıra sığar', () => {
    expect(linesOf('Cumhuriyet Mah. Atatürk Cad. No: 12')).toBe(1);
    expect(linesOf('Vergi No: 1234567890 Kadıköy V.D.')).toBe(1);
  });

  it.each(['W', '@', 'Ğ', 'M'])(
    'izinli en geniş karakterlerden "%s" × sınır en fazla 2 satıra kayar (kesilmez)',
    (ch) => {
      expect(linesOf(ch.repeat(max))).toBeLessThanOrEqual(2);
    },
  );
});
