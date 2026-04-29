import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, ChefHat } from 'lucide-react';
import { Button } from '../ui/button';
import { useAuthStore } from '../../store/auth';
import { api } from '../../lib/api';
import { disconnectSocket } from '../../lib/socket';
import { Sidebar } from './Sidebar';
import { cn } from '../../lib/utils';

interface AppShellProps {
  children: ReactNode;
}

/**
 * Authenticated app layout — collapsible sidebar (mobile + desktop).
 * Default açık (lg+). Hamburger ile her zaman aç/kapa toggle.
 *
 * Sayfanın kendi başlığı içerikte yönetilir — bu shell sadece nav + chrome.
 */
export function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = async (): Promise<void> => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Network/expired refresh — local session yine sonlandırılır.
    } finally {
      disconnectSocket();
      clearAuth();
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        onLogout={handleLogout}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Top bar — hamburger + brand. Sidebar kapalıyken her boyutta görünür. */}
      <header
        className={cn(
          'sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-white/80 px-4 backdrop-blur-sm transition-all',
          sidebarOpen && 'lg:hidden',
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(true)}
          aria-label="Menüyü aç"
          className="h-11 w-11"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-amber-400 to-orange-500">
            <ChefHat className="h-4 w-4 text-white" strokeWidth={2.25} />
          </span>
          <span className="text-base font-semibold tracking-tight">
            {t('app.brand')}
          </span>
        </div>
      </header>

      {/* Main content — sidebar açıkken lg+'da pl-64 */}
      <main
        className={cn(
          'transition-[padding] duration-200',
          sidebarOpen && 'lg:pl-64',
        )}
      >
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
