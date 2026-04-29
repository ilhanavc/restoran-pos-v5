import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChefHat, Clock, LogOut } from 'lucide-react';
import { Button } from '../ui/button';
import { useAuthStore } from '../../store/auth';
import { api } from '../../lib/api';
import { disconnectSocket } from '../../lib/socket';
import { useLiveClock } from '../../lib/useLiveClock';

interface AppShellProps {
  children: ReactNode;
}

/**
 * Top-bar shell for authenticated pages.
 * Sidebar will land in Sprint 8b alongside table/menu navigation.
 */
export function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const liveClock = useLiveClock();

  const handleLogout = async (): Promise<void> => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Even if the call fails (e.g. expired refresh), the local session must end.
    } finally {
      disconnectSocket();
      clearAuth();
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-16 border-b border-border bg-white/80 px-6 flex items-center justify-between backdrop-blur-sm">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2.5 font-semibold text-base"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm">
            <ChefHat className="h-5 w-5 text-white" strokeWidth={2.25} />
          </span>
          {t('app.brand')}
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <span
            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground tabular-nums"
            aria-label="Saat"
          >
            <Clock className="h-3.5 w-3.5" />
            {liveClock}
          </span>
          {user && (
            <span
              className="hidden md:inline text-sm text-muted-foreground"
              aria-label={t('app.activeUserAriaLabel')}
            >
              {user.email}
            </span>
          )}
          <Button
            variant="outline"
            onClick={handleLogout}
            aria-label={t('auth.logout')}
            className="h-11 gap-2"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t('auth.logout')}</span>
          </Button>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
