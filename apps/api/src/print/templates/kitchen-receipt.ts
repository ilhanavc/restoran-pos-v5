/**
 * Kitchen receipt (mutfak fişi) template.
 *
 * ADR-004 §7 — pure render: KitchenReceiptParams -> Uint8Array of ESC/POS bytes.
 * Caller is responsible for selecting kitchen destination and queueing the
 * resulting buffer into a print job; this module performs NO IO.
 *
 * Layout (printer-notes.md domain reference):
 *   ESC @ (reset)
 *   ESC t 13 (CP857)
 *   ESC a 1 (center)
 *   ESC ! bold+doubleHeight  -> tenant_header
 *   LF
 *   ESC ! 0
 *   LF
 *   ESC a 0 (left)
 *   kitchen_dest_label                 LF
 *   "Masa: <table_label or 'PAKET'>"   LF
 *   "Garson: <server_name>"            LF
 *   "Saat: <created_at_local>"         LF
 *   "Fis No: <order_no>"               LF  (note: header text uses "Fiş No")
 *   40x '-'                            LF
 *   LF
 *   per item:
 *     ESC ! bold
 *     "<qty>x <name>"                  LF
 *     ESC ! 0
 *     per modifier:
 *       "  + <modifier>"               LF
 *     if note:
 *       "  ! Not: <note>"              LF
 *   LF LF LF
 *   GS V 66 0 (cut)
 */

import {
  encodeCP857,
  ESC_POS,
  align,
  printMode,
  concat,
} from '@restoran-pos/shared-domain';

/** Input shape for {@link renderKitchenReceipt}. */
export interface KitchenReceiptParams {
  tenant_header: string;
  order_no: number;
  /** Masa etiketi; paket sipariş için null geçilir. */
  table_label: string | null;
  server_name: string;
  items: Array<{
    name: string;
    qty: number;
    modifiers?: string[];
    note?: string;
  }>;
  /** ISO string or pre-formatted local time. Rendered as-is. */
  created_at_local: string;
  kitchen_dest_label: string;
}

/** Helper: encode a text line and append LF. */
function line(text: string): Uint8Array {
  return concat(encodeCP857(text), ESC_POS.FEED_LINE);
}

/**
 * Render a kitchen receipt to an ESC/POS byte buffer.
 *
 * Pure function: no IO, no clock, no randomness.
 */
export function renderKitchenReceipt(
  params: KitchenReceiptParams,
): Uint8Array {
  const parts: Uint8Array[] = [];

  // --- Header (centered, bold + double height) ---
  parts.push(ESC_POS.RESET);
  parts.push(ESC_POS.CODEPAGE_CP857);
  parts.push(align('center'));
  parts.push(printMode({ bold: true, doubleHeight: true }));
  parts.push(line(params.tenant_header));
  parts.push(printMode()); // reset to normal
  parts.push(ESC_POS.FEED_LINE);

  // --- Meta block (left aligned) ---
  parts.push(align('left'));
  parts.push(line(params.kitchen_dest_label));

  const tableText = params.table_label ?? 'PAKET';
  parts.push(line(`Masa: ${tableText}`));
  parts.push(line(`Garson: ${params.server_name}`));
  parts.push(line(`Saat: ${params.created_at_local}`));
  parts.push(line(`Fiş No: ${params.order_no}`));
  parts.push(line('-'.repeat(40)));
  parts.push(ESC_POS.FEED_LINE);

  // --- Items ---
  for (const item of params.items) {
    parts.push(printMode({ bold: true }));
    parts.push(line(`${item.qty}x ${item.name}`));
    parts.push(printMode()); // reset

    if (item.modifiers && item.modifiers.length > 0) {
      for (const mod of item.modifiers) {
        parts.push(line(`  + ${mod}`));
      }
    }

    if (item.note && item.note.length > 0) {
      parts.push(line(`  ! Not: ${item.note}`));
    }
  }

  // --- Footer feed + cut ---
  parts.push(ESC_POS.FEED_LINE);
  parts.push(ESC_POS.FEED_LINE);
  parts.push(ESC_POS.FEED_LINE);
  parts.push(ESC_POS.CUT_FULL);

  return concat(...parts);
}
