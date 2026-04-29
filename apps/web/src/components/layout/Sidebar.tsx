import type { ComponentType, SVGProps } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Home,
  LayoutGrid,
  ChefHat,
  Users,
  Calendar,
  Boxes,
  BarChart3,
  BookOpen,
  UserCog,
  Settings,
  LogOut,
  X,
} from 'lucide-react';
import { Button } from '../ui/button';
import { useAuthStore } from '../../store/auth';
import { useLiveClock } from '../../lib/useLiveClock';
import { cn } from '../../lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  disabled?: boolean;
  badge?: string;
}

interface SidebarProps {
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Collapsible sol sidebar — mobile + desktop tek pattern.
 * isOpen=true: translate-x-0 (görünür)
 * isOpen=false: -translate-x-full (gizli, AppShell hamburger ile açar)
 *
 * Mobile'da overlay backdrop var; desktop'ta sayfa main padding ile yer açar.
 *
 * Üst köşede X butonu sidebar'ı kapatır (kullanıcı her boyutta toggle yapabilir).
 */
export function Sidebar({ onLogout, isOpen, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const liveClock = useLiveClock();

  const primaryNav: NavItem[] = [
    { to: '/dashboard', label: t('sidebar.home'), icon: Home },
    { to: '/tables', label: t('sidebar.tables'), icon: LayoutGrid },
  ];

  const futureNav: NavItem[] = [
    { to: '/kitchen', label: t('sidebar.kitchen'), icon: ChefHat, disabled: true, badge: t('sidebar.phase3') },
    { to: '/customers', label: t('sidebar.customers'), icon: Users, disabled: true, badge: t('sidebar.v51') },
    { to: '/reservations', label: t('sidebar.reservations'), icon: Calendar, disabled: true, badge: t('sidebar.v51') },
    { to: '/stock', label: t('sidebar.stock'), icon: Boxes, disabled: true, badge: t('sidebar.v51') },
    { to: '/reports', label: t('sidebar.reports'), icon: BarChart3, disabled: true, badge: t('sidebar.phase3') },
  ];

  const adminNav: NavItem[] = [
    { to: '/menu', label: t('sidebar.menu'), icon: BookOpen, disabled: true, badge: t('sidebar.soon') },
    { to: '/users', label: t('sidebar.users'), icon: UserCog, disabled: true, badge: t('sidebar.soon') },
    { to: '/settings', label: t('sidebar.settings'), icon: Settings, disabled: true, badge: t('sidebar.soon') },
  ];

  const roleLabel = (() => {
    switch (user?.role) {
      case 'admin':
        return t('sidebar.manager');
      case 'cashier':
        return t('sidebar.cashier');
      case 'waiter':
        return t('sidebar.waiter');
      case 'kitchen':
        return t('sidebar.kitchenRole');
      default:
        return '';
    }
  })();

  return (
    <>
      {/* Mobile/desktop backdrop — sidebar açıkken tüm ekranlarda kapatma kolaylığı.
          lg+'da backdrop yok (sayfa padding ile sidebar yan yana). */}
      {isOpen && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-white/95 backdrop-blur-sm transition-transform duration-200',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand + close — v3 .sidebar-top spec:
            sidebar pt 12px + brand pt 4px → logo top 16px (köşede)
            brand padding: 4px 16px 14px (intrinsic h≈52px), gap 12px
            logo 34×34, radius 8px; brand text 13px/800, letter-spacing -0.01em */}
        <div className="flex items-center justify-between border-b border-border pl-4 pr-3 pt-4 pb-[14px]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 shadow-sm">
              <ChefHat className="h-[18px] w-[18px] text-white" strokeWidth={2.25} />
            </span>
            <span className="text-[13px] font-extrabold tracking-[-0.01em]">
              {t('app.brand')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Menüyü kapat"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav scroll area */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <NavGroup items={primaryNav} onItemClick={onClose} />
          <Separator />
          <NavGroup items={futureNav} onItemClick={onClose} />
          <Separator />
          <NavGroup items={adminNav} onItemClick={onClose} />
        </nav>

        {/* Footer: clock + user + logout */}
        <div className="border-t border-border bg-stone-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span aria-label="Saat">{liveClock}</span>
          </div>
          {user && (
            <div className="flex items-center gap-3 rounded-lg bg-white p-2.5 shadow-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-sm font-semibold text-white">
                {(user.fullName ?? user.email ?? '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {user.fullName ?? user.email}
                </p>
                <p className="text-xs text-muted-foreground">{roleLabel}</p>
              </div>
            </div>
          )}
          <Button
            variant="outline"
            onClick={onLogout}
            aria-label={t('auth.logout')}
            className="h-11 w-full gap-2"
          >
            <LogOut className="h-4 w-4" />
            <span>{t('auth.logout')}</span>
          </Button>
        </div>
      </aside>
    </>
  );
}

function NavGroup({
  items,
  onItemClick,
}: {
  items: NavItem[];
  onItemClick?: (() => void) | undefined;
}) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.to}>
          <NavItemLink item={item} onClick={onItemClick} />
        </li>
      ))}
    </ul>
  );
}

function NavItemLink({
  item,
  onClick,
}: {
  item: NavItem;
  onClick?: (() => void) | undefined;
}) {
  const Icon = item.icon;

  if (item.disabled) {
    return (
      <div
        aria-disabled="true"
        tabIndex={-1}
        className="flex h-11 cursor-not-allowed items-center justify-between gap-3 rounded-lg px-3 text-sm text-muted-foreground/70"
      >
        <span className="flex items-center gap-3">
          <Icon className="h-4 w-4" />
          {item.label}
        </span>
        {item.badge && (
          <span className="rounded-full bg-stone-200/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {item.badge}
          </span>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isActive
            ? 'bg-gradient-to-r from-amber-100/80 to-orange-50 text-orange-800 shadow-sm'
            : 'text-foreground',
        )
      }
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </NavLink>
  );
}

function Separator() {
  return <div className="my-3 h-px bg-border" />;
}
