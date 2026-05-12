import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadCsv, todayStamp } from '../lib/downloadCsv';

/**
 * "X Raporu" — instant snapshot of the running business day (open + closed
 * orders, payments-to-date, anomalies-to-date). Non-destructive: it does not
 * close the day, so no confirm dialog is needed.
 *
 * ADR-015 §A1.5 (snapshot endpoint), ADR-021 PR-4b2 (CSV output).
 */
export function SnapshotButton(): JSX.Element {
  const { t } = useTranslation();
  const [isDownloading, setIsDownloading] = useState(false);

  const handleClick = async (): Promise<void> => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadCsv('/reports/snapshot?format=csv', `x-raporu-${todayStamp()}.csv`);
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
      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isDownloading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Camera className="h-4 w-4" />
      )}
      {t('reports.actions.snapshot')}
    </button>
  );
}
