import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../store/auth';
import { IncomingCallProvider } from '../features/caller-id/IncomingCallProvider';

type Role = 'admin' | 'cashier' | 'waiter' | 'kitchen';

/**
 * Auth guard — redirects to /login if no user in memory.
 * Note: silent refresh (cookie → access token) bootstrap is intentionally NOT
 * performed here in MVP; an unauthenticated reload simply lands on /login.
 * Bootstrap-on-mount is a Sprint 8b enhancement.
 *
 * `requiredRoles` (Sprint 12 PR-3 / ADR-020 K7): rol bazlı sayfa erişimi.
 * Set edilirse user.role o listede olmalı, aksi halde /dashboard'a redirect
 * (kitchen-only KDS gibi).
 *
 * Auth'lu sayfalar `IncomingCallProvider` ile sarılır (ADR-016 §11) — Caller ID
 * popup'ı yalnız oturum açmış istasyonlarda görünmeli.
 */
export function ProtectedRoute({
  children,
  requiredRoles,
}: {
  children: ReactNode;
  requiredRoles?: ReadonlyArray<Role>;
}) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (
    requiredRoles !== undefined &&
    !requiredRoles.includes(user.role as Role)
  ) {
    return <Navigate to="/dashboard" replace />;
  }
  return <IncomingCallProvider>{children}</IncomingCallProvider>;
}
