import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadCsv } from '../lib/downloadCsv';

interface CsvDownloadButtonProps {
  /** Backend report path, e.g. `/reports/hourly-revenue`. */
  endpoint: string;
  /** Suggested filename, e.g. `saatlik-ciro-2026-05-12.csv`. */
  filename: string;
  /** Optional override; defaults to `reports.actions.csvDownload`. */
  label?: string;
}

/**
 * Compact `CSV` button rendered inside `SectionCard` `rightSlot`. Click fires
 * `GET <endpoint>?format=csv` (responseType blob) and saves the file via a
 * synthetic `<a download>` link.
 *
 * Sprint 14 PR-5d — ADR-021 surface integration.
 */
export function CsvDownloadButton({
  endpoint,
  filename,
  label,
}: CsvDownloadButtonProps): JSX.Element {
  const { t } = useTranslation();
  const [isDownloading, setIsDownloading] = useState(false);

  const handleClick = async (): Promise<void> => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadCsv(`${endpoint}?format=csv`, filename);
    } catch {
      toast.error(t('reports.actions.error.downloadFailed'));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={isDownloading}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-stone-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isDownloading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      {label ?? t('reports.actions.csvDownload')}
    </button>
  );
}
