import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { Button } from '../ui/button';
import { useAuthStore } from '../../store/auth';
import { api } from '../../lib/api';
import { disconnectSocket } from '../../lib/socket';

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
      <header className="h-14 border-b border-border bg-background px-4 flex items-center justify-between">
        <Link to="/dashboard" className="font-semibold text-base">
          {t('app.brand')}
        </Link>
        <div className="flex items-center gap-3">
          {user && (
            <span
              className="text-sm text-muted-foreground"
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
            <span>{t('auth.logout')}</span>
          </Button>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
