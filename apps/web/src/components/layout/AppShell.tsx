import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, X } from 'lucide-react';
import { Button } from '../ui/button';
import { useAuthStore } from '../../store/auth';
import { api } from '../../lib/api';
import { disconnectSocket } from '../../lib/socket';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  children: ReactNode;
}

/**
 * Authenticated app layout — sidebar (lg+) + mobile drawer + content.
 * v3 layout pattern, modern revamp (Sprint 8b Görev 32).
 *
 * Sayfanın kendi başlığı içerikte yönetilir (Anasayfa / Masalar / vb.) — bu
 * shell sadece nav + chrome sağlar.
 */
export function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
        isOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />

      {/* Mobile topbar — sadece hamburger */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-white/80 px-4 backdrop-blur-sm lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-label="Menü"
          className="h-11 w-11"
        >
          {drawerOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <span className="text-base font-semibold tracking-tight">
          {t('app.brand')}
        </span>
      </div>

      {/* Main content area — left padding for sidebar on lg+ */}
      <main className="lg:pl-64">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
