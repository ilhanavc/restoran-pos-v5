import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadCsv, todayStamp } from '../lib/downloadCsv';

/**
 * "Z Raporu" — end-of-business-day close report. Two-step inline confirm
 * pattern (CustomerDetailPage parity): first click flips the button into a
 * 5-second confirm window with amber background + "Gün kapanışı al?" label;
 * second click within the window triggers the CSV download.
 *
 * The backend endpoint itself is read-only (snapshot + audit log row); the
 * confirm exists for user intent — Z raporu signals an operational ritual
 * (gün kapanışı) and should not be triggered by accidental clicks.
 *
 * ADR-015 §A1.4 (daily-close endpoint), ADR-021 PR-4b2 (CSV output).
 */
export function DailyCloseButton(): JSX.Element {
  const { t } = useTranslation();
  const [confirmPending, setConfirmPending] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Auto-reset the pending confirm after 5s of inactivity. Same TTL as
  // CustomerDetailPage:73-82 to keep the muscle memory consistent.
  useEffect(() => {
    if (!confirmPending) return;
    const handle = setTimeout(() => setConfirmPending(false), 5000);
    return (): void => clearTimeout(handle);
  }, [confirmPending]);

  const handleClick = async (): Promise<void> => {
    if (isDownloading) return;
    if (!confirmPending) {
      setConfirmPending(true);
      return;
    }
    setConfirmPending(false);
    setIsDownloading(true);
    try {
      await downloadCsv('/reports/daily-close?format=csv', `z-raporu-${todayStamp()}.csv`);
      toast.success(t('reports.actions.csvDownloadSuccess'));
    } catch {
      toast.error(t('reports.actions.error.downloadFailed'));
    } finally {
      setIsDownloading(false);
    }
  };

  const label = confirmPending
    ? t('reports.actions.dailyCloseConfirm')
    : t('reports.actions.dailyClose');

  const buttonClass = confirmPending
    ? 'inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-amber-300 bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-60'
    : 'inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={isDownloading}
      className={buttonClass}
    >
      {isDownloading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Lock className="h-4 w-4" />
      )}
      {label}
    </button>
  );
}
