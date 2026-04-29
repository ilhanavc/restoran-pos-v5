import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { useSidebarStore } from '../../store/sidebar';
import { api } from '../../lib/api';
import { disconnectSocket } from '../../lib/socket';
import { Sidebar } from './Sidebar';
import { cn } from '../../lib/utils';

interface AppShellProps {
  children: ReactNode;
}

/**
 * Authenticated app layout — sidebar (collapsible) + main content.
 *
 * v3 paritesi:
 * - Topbar YOK — sayfalar kendi header'larını çizer (page-header)
 * - Hamburger butonu sayfa içinde (useSidebarStore üzerinden)
 * - Sidebar açıkken main content sağa kayar (lg:pl-64)
 * - Sidebar kapalıyken full width
 */
export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const sidebarOpen = useSidebarStore((s) => s.open);
  const setSidebarOpen = useSidebarStore((s) => s.setOpen);

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
      <main
        className={cn(
          'min-h-screen transition-[padding] duration-200',
          sidebarOpen && 'lg:pl-64',
        )}
      >
        {children}
      </main>
    </div>
  );
}
