import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../store/auth';
import { IncomingCallProvider } from '../features/caller-id/IncomingCallProvider';

/**
 * Auth guard — redirects to /login if no user in memory.
 * Note: silent refresh (cookie → access token) bootstrap is intentionally NOT
 * performed here in MVP; an unauthenticated reload simply lands on /login.
 * Bootstrap-on-mount is a Sprint 8b enhancement.
 *
 * Auth'lu sayfalar `IncomingCallProvider` ile sarılır (ADR-016 §11) — Caller ID
 * popup'ı yalnız oturum açmış istasyonlarda görünmeli.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <IncomingCallProvider>{children}</IncomingCallProvider>;
}
