/**
 * İptal fişi (mutfak) ESC/POS şablonu — ADR-004 Amendment 6 Bölüm A (A3).
 *
 * İki varyant, tek yerleşim:
 *   - 'item-cancel'  → başlık "KALEM İPTAL"    (tek kalem iptali)
 *   - 'order-cancel' → başlık "ADİSYON İPTAL"  (adisyonun tümü; canlı kalemler listeli)
 *
 * ADR-004 Amendment 9 (2026-07-19) — RASTER render: `@napi-rs/canvas` 576px
 * bitmap → `GS v 0`. Alan İÇERİĞİ AYNI; yalnız render mekanizması text→raster.
 * Yumuşak font + Türkçe doğrudan → `sanitizeForCP857`/`encodeCP857`/ESC-t
 * codepage GEREKMEZ (K3/K4).
 *
 * Yerleşim (Adisyo-kalite, K5):
 *   ortalı büyük-bold  KALEM İPTAL | ADİSYON İPTAL
 *   ── çizgi ──
 *   tarih-saat / bold "Adisyon No: N" ...... "Bölge | Masa X" | "PAKET" / garson
 *   ── çizgi ──
 *   per item BÜYÜK "<ad> ...... <adet porsiyon>" + [seçenek] + BOLD BÜYÜK not
 *   ── çizgi ──
 *   ortalı büyük "- N -" (mutfak seslenişi, kitchen paritesi)
 *
 * Bilinçli YOK (A3/A8): işletme başlığı, FİYAT, müşteri PII (takeaway'de bile).
 *
 * Saf fonksiyon: IO/clock/random yok (ADR-004 §7 kontratı).
 */

import type { OrderType } from '@restoran-pos/shared-types';
import { ReceiptCanvas, SIZES } from '../raster/canvas-render.js';
import { encodeRaster, wrapPrintJob } from '../raster/raster-encode.js';

/** İptal fişi kalemi — kitchen'dan farkı: FİYAT ALANI YOK (A3). */
export interface CancelReceiptItem {
  name: string;
  qty: number;
  /** Porsiyon (`order_items.variant_name_snapshot`) — null → yalnız adet. */
  variantName: string | null;
  /** Seçenek snapshot'ları (`order_item_attributes.option_name_snapshot`). */
  modifiers: string[];
  /** Kalem notu — BÜYÜK HARF + bold ayrı satır (mutfak dikkat çekmesi). */
  note: string | null;
}

/** Input shape for {@link renderCancelReceipt} — ADR-004 Amd6 A3. */
export interface CancelReceiptParams {
  /** Fiş varyantı: tek kalem mi, adisyonun tümü mü. */
  variant: 'item-cancel' | 'order-cancel';
  /** dine_in → "Bölge | Masa" bloğu; diğerleri → "PAKET" etiketi. */
  order_type: OrderType;
  order_no: number;
  /** Kanonik masa etiketi ("Masa 2"); paket → null. */
  table_label: string | null;
  /** Bölge adı; null → yalnız masa basılır. */
  area_label: string | null;
  /** Çalışan adı — null → "-". */
  server_name: string | null;
  /** Pre-formatted yerel tarih-saat (formatReceiptDateTime çıktısı). */
  created_at_local: string;
  /** İptal edilen kalem(ler) — item-cancel'da tek eleman. */
  items: CancelReceiptItem[];
}

/** Sağ kolon "adet + porsiyon" ("2 Tam"); variant null → yalnız adet. */
function qtyLabel(item: CancelReceiptItem): string {
  const variant =
    item.variantName !== null && item.variantName.length > 0
      ? ` ${item.variantName}`
      : '';
  return `${item.qty}${variant}`;
}

/**
 * Render a kitchen cancel receipt to an ESC/POS byte buffer (raster; Amd9).
 *
 * Pure function: no IO, no clock, no randomness.
 */
export function renderCancelReceipt(params: CancelReceiptParams): Uint8Array {
  const rc = new ReceiptCanvas();

  // Çift-boyut başlık — mutfağın uzaktan ayırt etmesi için.
  rc.centered(
    params.variant === 'item-cancel' ? 'KALEM İPTAL' : 'ADİSYON İPTAL',
    { size: SIZES.title, bold: true },
  );
  rc.rule('solid');

  // Kimlik bloğu: yerel saat + adisyon no + masa/PAKET + garson.
  rc.left(params.created_at_local, { size: SIZES.small });
  const locationText =
    params.order_type === 'dine_in'
      ? params.table_label === null
        ? '-'
        : params.area_label !== null
          ? `${params.area_label} | ${params.table_label}`
          : params.table_label
      : 'PAKET';
  rc.leftRight(`Adisyon No: ${params.order_no}`, locationText, {
    size: SIZES.meta,
    bold: true,
  });
  rc.left(params.server_name ?? '-', { size: SIZES.meta });
  rc.rule('solid');

  // İptal edilen kalemler — FİYATSIZ (mutfak fişi; A3). Ürün-adı+adet BÜYÜK.
  for (const item of params.items) {
    rc.leftRight(item.name, qtyLabel(item), { size: SIZES.itemBig, bold: true });
    if (item.modifiers.length > 0) {
      rc.left(`[${item.modifiers.join(', ')}]`, { size: SIZES.meta, indentPx: 24 });
    }
    if (item.note !== null && item.note.length > 0) {
      // Türkçe-doğru büyük harf (i→İ, ı→I) — mutfak dikkat çekmesi (Amd5 K5 paritesi).
      rc.left(item.note.toLocaleUpperCase('tr-TR'), {
        size: SIZES.meta,
        bold: true,
        indentPx: 24,
      });
    }
  }
  rc.rule('solid');

  // Günlük sıra — ortada büyük "- 109 -" (kitchen paritesi, seslenme).
  rc.centered(`- ${params.order_no} -`, { size: SIZES.callout, bold: true });

  return wrapPrintJob(encodeRaster(rc.build()));
}
