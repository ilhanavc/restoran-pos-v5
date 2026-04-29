import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthBootstrap } from '../features/auth/api';

/**
 * Auth bootstrap kapısı — RouterProvider sarmalı.
 * Mount'ta `useAuthBootstrap()` cookie ile sessiz refresh dener.
 * `isReady` olana kadar full-screen loader göster (login'e flash YOK).
 */
export function AuthBootstrapGate({ children }: { children: ReactNode }) {
  const { isReady } = useAuthBootstrap();

  if (!isReady) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-50 via-amber-50/40 to-stone-50"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
        <span className="sr-only">Yükleniyor</span>
      </div>
    );
  }

  return <>{children}</>;
}
