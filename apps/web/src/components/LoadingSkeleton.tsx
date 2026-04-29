import { useTranslation } from 'react-i18next';
import { Skeleton } from './ui/skeleton';

/** Default Suspense / lazy-route fallback. */
export function LoadingSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-4 p-6"
      role="status"
      aria-live="polite"
      aria-label={t('common.loading')}
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-4 w-56" />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}
