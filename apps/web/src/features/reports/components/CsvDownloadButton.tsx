import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { downloadCsv } from '../lib/downloadCsv';

interface CsvDownloadButtonProps {
  /** Backend report path, e.g. `/reports/hourly-revenue`. */
  endpoint: string;
  /** Suggested filename, e.g. `saatlik-ciro-2026-05-12.csv`. */
  filename: string;
  /** Optional range; defaults to backend "today" when undefined. */
  range?: ReportRangeQuery;
  /** Optional override; defaults to `reports.actions.csvDownload`. */
  label?: string;
}

function buildCsvUrl(endpoint: string, range?: ReportRangeQuery): string {
  const params = new URLSearchParams({ format: 'csv' });
  if (range?.range) params.set('range', range.range);
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  return `${endpoint}?${params.toString()}`;
}

/**
 * Compact `CSV` button rendered inside `SectionCard` `rightSlot`. Click fires
 * `GET <endpoint>?format=csv[&range=...&from=...&to=...]` (responseType blob)
 * and saves the file via a synthetic `<a download>` link.
 *
 * Sprint 14 PR-5d — ADR-021 surface integration.
 * Sprint 15 PR-4 — `range` plumbing so CSV mirrors the active RangeFilter.
 */
export function CsvDownloadButton({
  endpoint,
  filename,
  range,
  label,
}: CsvDownloadButtonProps): JSX.Element {
  const { t } = useTranslation();
  const [isDownloading, setIsDownloading] = useState(false);

  const handleClick = async (): Promise<void> => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadCsv(buildCsvUrl(endpoint, range), filename);
      toast.success(t('reports.actions.csvDownloadSuccess'));
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
