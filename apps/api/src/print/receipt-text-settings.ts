/**
 * ADR-045 K2/K9 — enqueue'ların `tenant_settings` satırından fiş metnini
 * çözmesi. Kasa (`enqueue-bill-job`) ve paket (`enqueue-packing-job`) fişi
 * AYNI kuralla çözülür; ikisi de bu yardımcıyı çağırır.
 *
 * Ek sorgu YOK: kolonlar enqueue'ların zaten yaptığı `tenant_settings` okumasına
 * (`timezone` ile aynı `select`) eklenir ve buraya o satır verilir.
 */

import {
  DEFAULT_RECEIPT_TEXT,
  resolveReceiptText,
  type ResolvedReceiptText,
} from '@restoran-pos/shared-domain';
import { isReceiptTextEnabled } from '../config/receiptTextConfig.js';
import { logger } from '../logger.js';

/** `tenant_settings`'ten fiş metni için okunan kolonlar. */
export const RECEIPT_TEXT_COLUMNS = ['receipt_header_lines', 'receipt_footer_lines'] as const;

export interface ReceiptTextSettingsRow {
  receipt_header_lines: string[] | null;
  receipt_footer_lines: string[] | null;
}

/**
 * @param row `tenant_settings` satırı; `undefined` (satır yok / RLS context
 *   eksik) → bugünkü fiş. ⚠️ Context eksikliği burada HATA VERMEZ, satırı
 *   görmez — sonuç iyi huyludur (baskı durmaz) ama yapılandırma uygulanmaz;
 *   bu yüzden entegrasyon testi `withTenant`'ı sökerek KIRMIZI'yı kanıtlar.
 */
export function resolveTenantReceiptText(
  row: ReceiptTextSettingsRow | undefined,
  tenantId: string,
): ResolvedReceiptText {
  if (row === undefined) return DEFAULT_RECEIPT_TEXT;
  const result = resolveReceiptText(
    { headerLines: row.receipt_header_lines, footerLines: row.receipt_footer_lines },
    { enabled: isReceiptTextEnabled() },
  );
  if (result.invalid) {
    // FAIL-OPEN (K9): fiş varsayılanla basılır, asla throw yok. Sessiz de
    // değil: "işletme metni neden basılmadı" sorusunun cevabı bu satırdır.
    // Metnin kendisi log'a YAZILMAZ — işletme verisidir, teşhis için tenant +
    // sayaç yeterli.
    logger.error(
      { tenantId, counter: 'receipt_text.invalid' },
      '[receipt-text] tenant_settings receipt text failed validation; printing default',
    );
  }
  return result.text;
}
