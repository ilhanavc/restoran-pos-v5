import type { ReactNode } from 'react';

/**
 * Modern authenticated layout (ADR-011 §11.1).
 * - Gradient mesh background (mavi-mor, light mode)
 * - Decorative blurred orbs (subtle depth, perf-light)
 * - Form sağ tarafta cam-card; geniş ekranda sol panel brand/tagline
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-stone-50 via-white to-amber-50/40">
      {/* Decorative blurred gradient orbs — soft warm-neutral, saturation düşük */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-amber-200/25 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-stone-300/30 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-100/25 blur-3xl"
      />

      <main className="relative flex min-h-screen items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
          {children}
        </div>
      </main>
    </div>
  );
}
