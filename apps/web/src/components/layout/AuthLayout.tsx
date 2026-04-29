import type { ReactNode } from 'react';

/** Centered card layout for /login and other unauthenticated screens (ADR-011 §11.1). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
