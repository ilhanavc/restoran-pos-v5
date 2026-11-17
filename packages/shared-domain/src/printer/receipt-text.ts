import {
  ReceiptFooterLinesSchema,
  ReceiptHeaderLinesSchema,
} from '@restoran-pos/shared-types';

/**
 * ADR-045 K3 — işletmenin fiş metnini (üst/alt bilgi) şablona gidecek hâle
 * çözen SAF fonksiyon. IO yok, saat yok, `throw` yok.
 *
 * 🔑 Varsayılan = KOLONUN `NULL` OLMASI (K3.1). `NULL` saklanması gerekmeyen
 * tek değerdir: geri alma ("Varsayılana dön", K9) kolonu `NULL`'a çekmekten
 * ibarettir ve bugünkü fişe birebir döner (altın çizim kaydıyla çivili).
 *
 * 🔴 `NULL` ≠ boş dizi (K3.2) — sessiz regresyonun tam gireceği yer:
 *   - alt bilgi `null`  → `{ kind: 'default' }` = şablonun GÖMÜLÜ kapanışı
 *     (kasa: "Afiyet olsun / Teşekkür ederiz", paket: "AFİYET OLSUN");
 *   - alt bilgi `[]`    → `{ kind: 'custom', lines: [] }` = HİÇ alt bilgi.
 *   Üst bilgi için ikisi bugün aynı çıktıyı verir (gömülü üst bilgi yok), ama
 *   ayrım yine korunur: ileride gömülü bir üst bilgi eklenirse hazır olsun.
 *
 * 🔴 FAIL-OPEN (K9): değer şemadan geçmezse (ör. elle SQL ile bozulmuş) metin
 * YOK SAYILIR, kod varsayılanı döner ve `invalid: true` işaretlenir; çağıran
 * `logger.error` yazar. Asimetri bilinçli: auth yolu fail-CLOSED (ADR-044),
 * yapılandırma yolu fail-OPEN — yanlış alt bilgi kötüdür, HİÇ BASMAMAK
 * operasyonu durdurur. İki alandan biri bozuksa İKİSİ de yok sayılır: yarım
 * uygulanmış bir yapılandırma, işletmenin hiç görmediği bir fiş üretirdi.
 */

/** Şablona giden alt bilgi kararı. */
export type ResolvedReceiptFooter =
  | { readonly kind: 'default' }
  | { readonly kind: 'custom'; readonly lines: readonly string[] };

/** Şablonlara (`bill-receipt`, `packing-receipt`) giden çözülmüş metin. */
export interface ResolvedReceiptText {
  /** İşletme adının altına basılacak satırlar; boş = ek satır yok. */
  readonly header: readonly string[];
  readonly footer: ResolvedReceiptFooter;
}

/** `tenant_settings`'ten okunan ham kolon değerleri. */
export interface ReceiptTextColumns {
  readonly headerLines: readonly string[] | null;
  readonly footerLines: readonly string[] | null;
}

export interface ResolveReceiptTextResult {
  readonly text: ResolvedReceiptText;
  /** Kolon değeri şemadan geçmedi → varsayılana düşüldü (çağıran log'lar). */
  readonly invalid: boolean;
}

/** Bugünkü fiş: ek üst satır yok, gömülü kapanış. */
export const DEFAULT_RECEIPT_TEXT: ResolvedReceiptText = Object.freeze({
  header: Object.freeze([]) as readonly string[],
  footer: Object.freeze({ kind: 'default' as const }),
});

/**
 * @param columns `tenant_settings.receipt_header_lines` / `receipt_footer_lines`
 * @param options.enabled kill-switch (`RECEIPT_TEXT_ENABLED`, K9 kademe 3);
 *   `false` → kolonlar hiç dikkate alınmaz, doğrudan varsayılan.
 */
export function resolveReceiptText(
  columns: ReceiptTextColumns,
  options: { readonly enabled: boolean },
): ResolveReceiptTextResult {
  if (!options.enabled) {
    return { text: DEFAULT_RECEIPT_TEXT, invalid: false };
  }

  const header =
    columns.headerLines === null
      ? { success: true as const, data: [] as string[] }
      : ReceiptHeaderLinesSchema.safeParse(columns.headerLines);
  const footer =
    columns.footerLines === null
      ? null
      : ReceiptFooterLinesSchema.safeParse(columns.footerLines);

  if (!header.success || (footer !== null && !footer.success)) {
    return { text: DEFAULT_RECEIPT_TEXT, invalid: true };
  }

  return {
    text: {
      header: header.data,
      footer:
        footer === null ? { kind: 'default' } : { kind: 'custom', lines: footer.data },
    },
    invalid: false,
  };
}
