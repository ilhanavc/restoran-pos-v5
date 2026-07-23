/**
 * Customer bill / adisyon receipt template (ADR-027 Faz A + Amendment 1).
 *
 * ADR-004 §7 — pure render: BillReceiptParams -> Uint8Array of ESC/POS bytes.
 * Caller (enqueue-bill-job) queues the resulting buffer into a print job; this
 * module performs NO IO / clock / randomness.
 *
 * ADR-004 Amendment 9 (Session 2026-07-19) — RASTER render: metin-mode yerine
 * `@napi-rs/canvas` ile 576px bitmap çizilir → `GS v 0` (raster/{@link ../raster}).
 * Alan İÇERİĞİ (order_no, kalemler, ödemeler, meta, koşullu döküm) AYNI; yalnız
 * RENDER mekanizması text→raster. Yumuşak font + Türkçe + ₺ doğrudan basılır
 * → `sanitizeForCP857`/`encodeCP857`/ESC-t codepage GEREKMEZ (K3/K4). Para artık
 * ₺ ile: TUTAR/tahsil/kalan "1.234,56 ₺" (CP857 ₺-glyph kısıtı kalktı).
 *
 * Yerleşim (Adisyo-kalite, K5):
 *   ortalı büyük-bold  işletme adı
 *   ortalı küçük       tarih/saat
 *   ── çizgi ──
 *   meta (Adisyon No / Garson·Masa / Sipariş Kanalı, sol-etiket)
 *   ── çizgi ──
 *   kalemler (adet · ad-wrap · fiyat-sağ) + modifiye/not indent alt-satır
 *   ── çizgi ──
 *   TUTAR büyük-bold sağ (₺)
 *   koşullu ödeme dökümü (YALNIZ payments.length > 1)
 *   ── çizgi ──
 *   ortalı footer "Afiyet olsun / Teşekkür ederiz"
 */

import { ESC_POS } from '@restoran-pos/shared-domain';
import type { OrderType, PaymentType } from '@restoran-pos/shared-types';
import { ReceiptCanvas, SIZES } from '../raster/canvas-render.js';
import { encodeRaster, wrapPrintJob } from '../raster/raster-encode.js';
import {
  ORDER_TYPE_LABELS,
  PAYMENT_TYPE_LABELS,
  moneyDigits,
} from './receipt-layout.js';

/** Input shape for {@link renderBillReceipt}. Money is integer kuruş. */
export interface BillReceiptParams {
  tenant_header: string;
  order_no: number;
  /** Sipariş kanalı — "Sipariş Kanalı" satırı (dine_in/takeaway/delivery). */
  order_type: OrderType;
  /**
   * Garson adı (`users.username` @ `orders.waiter_user_id`). null =
   * paket/atanmamış → "-" basılır.
   */
  server_name: string | null;
  /**
   * Kanonik masa etiketi (ADR-009 Amendment 2026-06-30 Karar A) — "Masa 2" /
   * orphan code; paket sipariş için null geçilir ("PAKET" basılır).
   */
  table_label: string | null;
  /**
   * Bölge adı (`order.area_name_snapshot`) — per-bölge display_no çakışmasını
   * ayırt etmek için ön ek ("Bahçe - Masa 2"). null = bölgesiz/paket.
   */
  area_label: string | null;
  items: Array<{
    name: string;
    qty: number;
    /**
     * Porsiyon (`order_items.variant_name_snapshot`) — ADR-027 Amd3 K1.
     * Adet kolonunda basılır ("2 Bir buçuk"); null → yalnız adet. Mutfak
     * (ADR-004 Amd5 K4) ve paket (ADR-032 Amd3) fişleriyle birebir aynı desen.
     */
    variantName: string | null;
    lineTotalCents: number;
    /** Kalem notu (`order_items.note`) — varsa alt-satır "(note)". */
    note: string | null;
    /** Modifiye seçenekleri (`order_item_attributes.option_name_snapshot`). */
    modifiers: string[];
  }>;
  totalCents: number;
  /**
   * Ödeme dökümü kaynağı (`payments`). Yalnız `length > 1` iken tahsil/kalan
   * bloğu basılır (yalın adisyon = tek/ödemesiz senaryoda gürültü eklemez).
   */
  payments: Array<{ type: PaymentType; amountCents: number }>;
  /** Toplam tahsil edilen (Σ payments.amountCents). */
  paidTotalCents: number;
  /** Kalan (totalCents − paidTotalCents). */
  remainingCents: number;
  /** Pre-formatted local time, rendered as-is (ör. "08.07.2026  20:35"). */
  created_at_local: string;
}

/**
 * ADR-027 Amd3 K1 — "adet + porsiyon" ("2 Bir buçuk"); porsiyon yoksa yalnız
 * adet. `kitchen-receipt.ts` / `packing-receipt.ts` ile birebir aynı desen.
 */
function qtyLabel(item: { qty: number; variantName: string | null }): string {
  const variant =
    item.variantName !== null && item.variantName.length > 0
      ? ` ${item.variantName}`
      : '';
  return `${item.qty}${variant}`;
}

/** Toplam/özet satırları için "1.234,56 ₺" (raster'da ₺ glyph basılır; Amd9 K4). */
function moneyLira(cents: number): string {
  return `${moneyDigits(cents)} ₺`;
}

/**
 * Render a customer bill to an ESC/POS byte buffer (raster; ADR-004 Amd9).
 *
 * Pure function: no IO, no clock, no randomness.
 *
 * @param _codepage ADR-004 Amd9: raster-yolunda KULLANILMAZ (metin yok →
 *   ESC t codepage gereksiz, Amd3 SUPERSEDED). İmza geriye-dönük korunur —
 *   `enqueueBillJob` ikinci argümanı pozisyonel geçer (çağıran DEĞİŞMEZ).
 */
export function renderBillReceipt(
  params: BillReceiptParams,
  _codepage: Uint8Array = ESC_POS.CODEPAGE_CP857,
): Uint8Array {
  const rc = new ReceiptCanvas();

  // --- Header: ortalı büyük-bold işletme adı + küçük tarih/saat ---
  rc.centered(params.tenant_header, { size: SIZES.header, bold: true });
  rc.centered(params.created_at_local, { size: SIZES.small });
  rc.gap(6);
  rc.rule('solid');

  // --- Meta: adisyon no + garson/masa + sipariş kanalı (sol-etiket) ---
  // S99 kağıt-smoke: üst-bilgi bloğu bold (kullanıcı: "daha belirgin").
  rc.left(`Adisyon No: ${params.order_no}`, { size: SIZES.meta, bold: true });
  // Masa satırı self-describing (Karar A): "Masa 2"; bölge varsa ön ek.
  const tableText =
    params.table_label === null
      ? 'PAKET'
      : params.area_label !== null
        ? `${params.area_label} - ${params.table_label}`
        : params.table_label;
  rc.leftRight(`Garson: ${params.server_name ?? '-'}`, tableText, {
    size: SIZES.meta,
    bold: true,
  });
  rc.left(`Sipariş Kanalı: ${ORDER_TYPE_LABELS[params.order_type]}`, {
    size: SIZES.meta,
    bold: true,
  });
  rc.rule('solid');

  // --- Kalemler: adet(+porsiyon) · ad (wrap) · fiyat-sağ; modifiye/not alt-satır ---
  // ADR-027 Amd3 K2: adet kolonu TÜM kalemlerde ortak genişlikte → ad kolonu
  // hizalı başlar (aksi hâlde porsiyonlu/porsiyonsuz satırlar tırtıklanır).
  const itemOpts = { size: SIZES.itemName, bold: true };
  const qtyTexts = params.items.map(qtyLabel);
  const qtyColPx = rc.qtyColumnWidth(qtyTexts, itemOpts);

  params.items.forEach((item, i) => {
    rc.itemRow(
      qtyTexts[i]!,
      item.name,
      moneyDigits(item.lineTotalCents),
      itemOpts,
      qtyColPx,
    );
    if (item.modifiers.length > 0) {
      rc.left(`[${item.modifiers.join(', ')}]`, { size: SIZES.small, indentPx: 24 });
    }
    if (item.note !== null && item.note.length > 0) {
      rc.left(`(${item.note})`, { size: SIZES.small, indentPx: 24 });
    }
  });
  rc.rule('solid');

  // --- Toplam: TUTAR büyük-bold sağ (₺) ---
  rc.leftRight('TUTAR', moneyLira(params.totalCents), {
    size: SIZES.total,
    bold: true,
  });

  // --- Koşullu ödeme dökümü (YALNIZ parçalı/çok-türlü: payments.length > 1) ---
  if (params.payments.length > 1) {
    rc.gap(6);
    rc.leftRight('Tahsil Edilen', moneyLira(params.paidTotalCents), {
      size: SIZES.meta,
      bold: true,
    });
    for (const p of params.payments) {
      rc.leftRight(PAYMENT_TYPE_LABELS[p.type], moneyDigits(p.amountCents), {
        size: SIZES.meta,
      });
    }
    rc.leftRight('Kalan', moneyLira(params.remainingCents), {
      size: SIZES.meta,
      bold: true,
    });
  }
  rc.rule('solid');

  // --- Footer: ortalı Afiyet olsun / Teşekkür ederiz ---
  rc.centered('Afiyet olsun', { size: SIZES.total, bold: true });
  rc.centered('Teşekkür ederiz', { size: SIZES.meta });

  return wrapPrintJob(encodeRaster(rc.build()));
}
