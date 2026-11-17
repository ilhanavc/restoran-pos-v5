import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { RECEIPT_TEXT_LIMITS, ReceiptLineSchema } from '@restoran-pos/shared-types';

/**
 * Bir satırın hata anahtarı (`admin.printSettings.lineErrors.*`) ya da null.
 * Sunucuyla AYNI şema + aynı NFC normalizasyonu (ADR-045 K6.2: tek kaynak).
 */
export function receiptLineError(line: string): string | null {
  const parsed = ReceiptLineSchema.safeParse(line.normalize('NFC'));
  if (parsed.success) return null;
  const message = parsed.error.issues[0]?.message ?? 'receipt_line:invalid_char';
  return message.replace('receipt_line:', '');
}

/** Satırın kod noktası uzunluğu (sunucu sınırı kod noktası sayar, UTF-16 değil). */
export function receiptLineLength(line: string): number {
  return [...line.normalize('NFC')].length;
}

interface ReceiptLinesEditorProps {
  /** Erişilebilirlik + test kimliği öneki: `header` / `footer`. */
  idPrefix: string;
  lines: string[];
  maxLines: number;
  disabled: boolean;
  onChange: (lines: string[]) => void;
}

/**
 * Satır listesi düzenleyici — her satırda canlı karakter sayacı ve satır içi
 * hata; satır ekle/sil. Satır sonu yalnız ayrı satır olarak ifade edilir
 * (K6.4), bu yüzden alanlar tek satırlık `input`'tur.
 */
export function ReceiptLinesEditor({
  idPrefix,
  lines,
  maxLines,
  disabled,
  onChange,
}: ReceiptLinesEditorProps) {
  const { t } = useTranslation();
  const max = RECEIPT_TEXT_LIMITS.maxCharsPerLine;

  const update = (index: number, value: string) => {
    onChange(lines.map((line, i) => (i === index ? value : line)));
  };
  const remove = (index: number) => {
    onChange(lines.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, index) => {
        const lineNo = index + 1;
        const error = line.length === 0 ? null : receiptLineError(line);
        const length = receiptLineLength(line);
        const inputId = `${idPrefix}-line-${lineNo}`;
        const hintId = `${inputId}-hint`;
        return (
          <div key={index} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                id={inputId}
                data-testid={inputId}
                type="text"
                value={line}
                disabled={disabled}
                aria-label={t('admin.printSettings.lineLabel', { lineNo })}
                aria-invalid={error !== null}
                aria-describedby={hintId}
                onChange={(e) => update(index, e.target.value)}
                className={`flex h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                  error !== null ? 'border-rose-500' : 'border-input'
                }`}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(index)}
                aria-label={t('admin.printSettings.removeLine', { lineNo })}
                data-testid={`${inputId}-remove`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-input text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p id={hintId} className="flex justify-between gap-2 text-[12px]">
              <span className="text-rose-600" role={error !== null ? 'alert' : undefined}>
                {error !== null ? t(`admin.printSettings.lineErrors.${error}`, { max }) : ''}
              </span>
              <span
                data-testid={`${inputId}-counter`}
                className={length > max ? 'font-semibold text-rose-600' : 'text-slate-500'}
              >
                {t('admin.printSettings.charCounter', { used: length, max })}
              </span>
            </p>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          disabled={disabled || lines.length >= maxLines}
          onClick={() => onChange([...lines, ''])}
          data-testid={`${idPrefix}-add-line`}
          className="inline-flex h-11 items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {lines.length >= maxLines
            ? t('admin.printSettings.maxLinesReached', { maxLines })
            : t('admin.printSettings.addLine')}
        </button>
      </div>
    </div>
  );
}
