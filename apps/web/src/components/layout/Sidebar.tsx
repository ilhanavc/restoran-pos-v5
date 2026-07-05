import { useState, type ComponentType, type SVGProps } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Home,
  LayoutGrid,
  ChefHat,
  Users,
  UserCog,
  Calendar,
  Boxes,
  BarChart3,
  Settings,
  FolderTree,
  ChevronDown,
  LogOut,
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

interface NavCollapsibleGroup {
  /** Parent label (i18n çevirisi yapılmış). */
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  children: NavItem[];
}

interface SidebarProps {
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Collapsible sol sidebar (overlay).
 *
 * v3 paritesi (App.jsx:274-279, Sidebar.jsx):
 * - Anasayfa, Masalar — primary nav
 * - Mutfak/Müşteriler/Rezervasyonlar/Stok/Raporlar/Ayarlar — future (disabled)
 * - Tanımlamalar (collapsible) — Menü Tanımları, Salon Bölgeleri, Özellikler
 * - "Menü", "Kullanıcılar", "Çağrılar" v3'te yok → V5'te de yok
 */
export function Sidebar({ onLogout, isOpen, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const liveClock = useLiveClock();

  const primaryNav: NavItem[] = [
    { to: '/dashboard', label: t('sidebar.home'), icon: Home },
    { to: '/tables', label: t('sidebar.tables'), icon: LayoutGrid },
  ];

  // Mutfak (KDS) — Sprint 12 PR-3 (ADR-020 K7): yalnız kitchen + admin görür.
  // Cashier/waiter sidebar'da Mutfak linki görmez (route gardı + sidebar
  // visibility birlikte; defense-in-depth).
  const canSeeKds = user?.role === 'kitchen' || user?.role === 'admin';

  const futureNav: NavItem[] = [
    ...(canSeeKds
      ? [{ to: '/kds', label: t('sidebar.kitchen'), icon: ChefHat }]
      : []),
    { to: '/customers', label: t('sidebar.customers'), icon: Users },
    { to: '/reservations', label: t('sidebar.reservations'), icon: Calendar, disabled: true, badge: t('sidebar.v51') },
    { to: '/stock', label: t('sidebar.stock'), icon: Boxes, disabled: true, badge: t('sidebar.v51') },
    { to: '/raporlar', label: t('sidebar.reports'), icon: BarChart3 },
    { to: '/users', label: t('sidebar.users'), icon: UserCog },
    { to: '/settings', label: t('sidebar.settings'), icon: Settings },
  ];

  const tanimlamalarGroup: NavCollapsibleGroup = {
    label: t('sidebar.tanimlamalar'),
    icon: FolderTree,
    children: [
      { to: '/tanimlamalar/menu-tanimlari', label: t('sidebar.menuDefinitions'), icon: FolderTree },
      { to: '/tanimlamalar/salon-bolgeleri', label: t('sidebar.diningAreas'), icon: FolderTree },
      { to: '/tanimlamalar/ozellikler', label: t('sidebar.productFeatures'), icon: FolderTree },
    ],
  };

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
      {/* Backdrop — v3 .sidebar-backdrop paritesi (App.jsx:274-275, global.css:279).
          Sidebar açıkken tüm boyutlarda görünür, tıklayınca kapanır. */}
      {isOpen && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-200"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col border-r border-border bg-white/95 backdrop-blur-sm transition-transform duration-200',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand header — Session 82: marka logosu (ChefHat gradient kutu) kaldırıldı
            (kullanıcı isteği).
            - pl-16 pr-4: "Restoran POS" AppShell'in fixed kapat/hamburger butonunun
              (left-3, sağ kenar ~54px) altına girmesin diye ~x64'ten başlar.
            - Kapatma butonu YOK — AppShell'de zaten sol üstte X var (çift X gereksiz). */}
        <div className="flex items-center border-b border-border bg-white py-3 pl-16 pr-4">
          <span className="truncate text-[14px] font-extrabold leading-none tracking-[-0.01em]">
            {t('app.brand')}
          </span>
        </div>

        {/* Nav scroll area */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <NavGroup items={primaryNav} onItemClick={onClose} />
          <Separator />
          <NavGroup items={futureNav} onItemClick={onClose} />
          <Separator />
          <CollapsibleNavGroup group={tanimlamalarGroup} onItemClick={onClose} />
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

function CollapsibleNavGroup({
  group,
  onItemClick,
}: {
  group: NavCollapsibleGroup;
  onItemClick?: (() => void) | undefined;
}) {
  const location = useLocation();
  const hasActiveChild = group.children.some((c) =>
    location.pathname.startsWith(c.to),
  );
  const [open, setOpen] = useState(hasActiveChild);
  const ParentIcon = group.icon;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          'text-foreground',
        )}
      >
        <span className="flex items-center gap-3">
          <ParentIcon className="h-4 w-4" />
          {group.label}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform duration-150',
            open ? 'rotate-180' : 'rotate-0',
          )}
        />
      </button>
      {open && (
        <ul className="mt-1 space-y-1 pl-6">
          {group.children.map((item) => (
            <li key={item.to}>
              <NavItemLink item={item} onClick={onItemClick} indented />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NavItemLink({
  item,
  onClick,
  indented,
}: {
  item: NavItem;
  onClick?: (() => void) | undefined;
  indented?: boolean;
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
          {indented ? null : <Icon className="h-4 w-4" />}
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
      {indented ? null : <Icon className="h-4 w-4" />}
      {item.label}
    </NavLink>
  );
}

function Separator() {
  return <div className="my-3 h-px bg-border" />;
}
