/**
 * İptal fişi (mutfak) ESC/POS şablonu — ADR-004 Amendment 6 Bölüm A (A3).
 *
 * İki varyant, tek yerleşim:
 *   - 'item-cancel'  → başlık "İPTAL"          (tek kalem iptali)
 *   - 'order-cancel' → başlık "ADİSYON İPTAL"  (adisyonun tümü; canlı kalemler listeli)
 *
 * Yerleşim (48 kolon, CP857 — Amd3 ESC t 29):
 *   center dblW+dblH bold: İPTAL | ADİSYON İPTAL
 *   ------ 48x '-' ------
 *   <dd.MM.yyyy HH:mm:ss>                      (yerel saat, Amd5 K9)
 *   bold: "Adisyon No: N" ......... "Bölge | Masa X" | "PAKET"
 *   <garson>                                   (null → '-'; em-dash YOK, Amd5 K10)
 *   ------ 48x '-' ------
 *   bold: "<ürün adı>" ............ "<adet> <porsiyon>"
 *     [seçenek, seçenek]
 *     BOLD BÜYÜK NOT
 *   ------ 48x '-' ------
 *   center dblW+dblH bold: "- N -"             (mutfak seslenişi, kitchen paritesi)
 *   feed(4) + CUT_FULL
 *
 * Bilinçli YOK (A3/A8): işletme başlığı, "MUTFAK" etiketi, FİYAT (mutfak
 * fişinde para yok), müşteri adı/telefonu/adresi (PII — takeaway'de bile).
 *
 * Saf fonksiyon: IO/clock/random yok (ADR-004 §7 kontratı).
 * kitchen-receipt.ts'in GENİŞLETMESİ DEĞİL (A3 — Amd5 sonrası 2-layout
 * karmaşık; ayrı dosya = canlı mutfak fişine regresyon-sıfır). Küçük
 * helper'lar (qtyLabel/alt-satırlar) bilinçli yerel kopya.
 */

import {
  encodeCP857,
  sanitizeForCP857,
  ESC_POS,
  align,
  printMode,
  doubleStrikeOn,
  feed,
  concat,
} from '@restoran-pos/shared-domain';
import type { OrderType } from '@restoran-pos/shared-types';
import { MINOR, twoCol } from './receipt-layout.js';

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
  /** Çalışan adı — null → ASCII '-' (em-dash CP857'de YOK). */
  server_name: string | null;
  /** Pre-formatted yerel tarih-saat (formatReceiptDateTime çıktısı). */
  created_at_local: string;
  /** İptal edilen kalem(ler) — item-cancel'da tek eleman. */
  items: CancelReceiptItem[];
}

/** Helper: encode a text line and append LF. */
function line(text: string): Uint8Array {
  return concat(encodeCP857(text), ESC_POS.FEED_LINE);
}

/** Sağ kolon "adet + porsiyon" ("2 Tam"); variant null → yalnız adet. */
function qtyLabel(item: CancelReceiptItem): string {
  const variant =
    item.variantName !== null && item.variantName.length > 0
      ? ` ${sanitizeForCP857(item.variantName)}`
      : '';
  return `${item.qty}${variant}`;
}

/**
 * Render a kitchen cancel receipt to an ESC/POS byte buffer.
 *
 * Pure function: no IO, no clock, no randomness.
 */
export function renderCancelReceipt(params: CancelReceiptParams): Uint8Array {
  const parts: Uint8Array[] = [];

  // RESET + codepage İLK baytlar olmalı (byte-level test sözleşmesi; Amd3).
  parts.push(ESC_POS.RESET);
  parts.push(ESC_POS.CODEPAGE_CP857);
  parts.push(doubleStrikeOn()); // KOYULUK global-açık (Amd7 K2)

  // Çift-boyut başlık — mutfağın uzaktan ayırt etmesi için. v3 tek başına
  // "İPTAL" basardı; turkish-ux gate önerisiyle "KALEM İPTAL" seçildi
  // ("ADİSYON İPTAL" ile simetrik — kalem-mi-adisyon-mu ilk bakışta net).
  parts.push(align('center'));
  parts.push(printMode({ bold: true, doubleHeight: true, doubleWidth: true }));
  parts.push(line(params.variant === 'item-cancel' ? 'KALEM İPTAL' : 'ADİSYON İPTAL'));
  parts.push(printMode());
  parts.push(align('left'));
  parts.push(line(MINOR));

  // Kimlik bloğu: yerel saat + adisyon no + masa/PAKET + garson.
  parts.push(line(params.created_at_local));
  const locationText =
    params.order_type === 'dine_in'
      ? params.table_label === null
        ? '-'
        : params.area_label !== null
          ? `${sanitizeForCP857(params.area_label)} | ${sanitizeForCP857(params.table_label)}`
          : sanitizeForCP857(params.table_label)
      : 'PAKET';
  parts.push(printMode({ bold: true }));
  parts.push(line(twoCol(`Adisyon No: ${params.order_no}`, locationText)));
  parts.push(printMode());
  parts.push(line(sanitizeForCP857(params.server_name ?? '-')));
  parts.push(line(MINOR));

  // İptal edilen kalemler — FİYATSIZ (mutfak fişi; A3).
  for (const item of params.items) {
    // Ürün-adı+adet çift-yükseklik + bold (Amd7 K3 — mutfak paritesi). ESC !
    // (printMode) — JP80H GS !'i render etmez (S99 smoke); çift-YÜKSEKLİK
    // genişliği değiştirmez → twoCol 48-kolon korunur (K4).
    parts.push(printMode({ bold: true, doubleHeight: true }));
    parts.push(line(twoCol(sanitizeForCP857(item.name), qtyLabel(item))));
    parts.push(printMode());
    if (item.modifiers.length > 0) {
      parts.push(line(`  [${item.modifiers.map(sanitizeForCP857).join(', ')}]`));
    }
    if (item.note !== null && item.note.length > 0) {
      // Türkçe-doğru büyük harf (i→İ, ı→I) SONRA sanitize (Amd5 K5 paritesi).
      parts.push(printMode({ bold: true }));
      parts.push(line(sanitizeForCP857(item.note.toLocaleUpperCase('tr-TR'))));
      parts.push(printMode());
    }
  }
  parts.push(line(MINOR));

  // Günlük sıra — ortada çift-boyut "- 109 -" (kitchen paritesi, seslenme).
  parts.push(align('center'));
  parts.push(printMode({ bold: true, doubleHeight: true, doubleWidth: true }));
  parts.push(line(`- ${params.order_no} -`));
  parts.push(printMode());
  parts.push(align('left'));

  parts.push(feed(4));
  parts.push(ESC_POS.CUT_FULL);
  return concat(...parts);
}
