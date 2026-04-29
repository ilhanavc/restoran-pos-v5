import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
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
  const toggleSidebar = useSidebarStore((s) => s.toggle);

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
      {/* v3 .sidebar-menu-btn paritesi — fixed top:12 left:12, 42×42, radius 8,
          beyaz bg, ince border. Aynı buton hem aç hem kapa: ikon Menu↔X.
          z-index sidebar'ın (z-50) üstünde olmalı (v3'te 202 vs 201). */}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={sidebarOpen ? 'Menüyü kapat' : 'Menüyü aç'}
        aria-expanded={sidebarOpen}
        className="fixed left-3 top-3 z-[60] inline-flex h-[42px] w-[42px] items-center justify-center rounded-lg transition-all hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
        style={{
          background: 'var(--v3-surface-1)',
          border: '1px solid var(--v3-border-subtle)',
          color: 'var(--v3-text-secondary)',
        }}
      >
        {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

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
