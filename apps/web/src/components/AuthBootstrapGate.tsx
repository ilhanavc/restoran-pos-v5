import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthBootstrap } from '../features/auth/api';

/**
 * Auth bootstrap kapısı — RouterProvider sarmalı.
 * Mount'ta cookie ile sessiz refresh dener; isReady olana kadar full-screen
 * loader göster (login'e flash YOK).
 */
export function AuthBootstrapGate({ children }: { children: ReactNode }) {
  const { isReady } = useAuthBootstrap();
  const { t } = useTranslation();

  if (!isReady) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-50 via-white to-amber-50/40"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }

  return <>{children}</>;
}
