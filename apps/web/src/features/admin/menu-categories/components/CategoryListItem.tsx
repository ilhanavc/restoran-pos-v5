import { useTranslation } from 'react-i18next';
import { MoreVertical, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { CATEGORY_ICONS, type CategoryIcon } from '@restoran-pos/shared-types';
import type { ApiCategory } from '../api';

interface CategoryListItemProps {
  category: ApiCategory;
  productCount: number;
  isActive: boolean;
  onClick: () => void;
  /** D2'de aktive: 3-dot menu (Düzenle / Sil). PR-D1'de tıklama no-op. */
  onMenuClick?: () => void;
}

/**
 * Sol panel kategori kartı — Sprint 8c PR-D1.
 *
 * V3 paritesi `MenuSettingsPage.jsx` kart yapısı + ADR-011 Amendment 2026-05-01
 * Karar 2 (lucide ikon) + Karar 3 (renk halosu).
 *
 * Aktif kart: soft tinted bg + sol-edge 3px accent (kategori rengi). Inaktif:
 * `var(--v3-surface-1)` neutral. Hover'da hafif lift (--v3-surface-2).
 *
 * 3-dot menu PR-D1'de görünür ama tıklanamaz — D2'de drawer aktive olunca
 * Düzenle/Sil eklenir.
 */
export function CategoryListItem({
  category,
  productCount,
  isActive,
  onClick,
  onMenuClick,
}: CategoryListItemProps) {
  const { t } = useTranslation();

  // Lucide-react dynamic icon resolution. Whitelist (CATEGORY_ICONS) zod
  // katmanında garanti edilir; runtime fallback UtensilsCrossed.
  const isWhitelistedIcon = (CATEGORY_ICONS as readonly string[]).includes(category.icon);
  const IconComponent = isWhitelistedIcon
    ? ((LucideIcons as unknown as Record<string, LucideIcon>)[category.icon as CategoryIcon] ??
      UtensilsCrossed)
    : UtensilsCrossed;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-lg border px-3 py-2.5 transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
      style={{
        background: isActive ? `${category.color}14` : 'var(--v3-surface-1)',
        borderColor: isActive ? `${category.color}55` : 'var(--v3-border-subtle)',
      }}
    >
      {/* Sol-edge accent: aktif kartta 3px renk şeridi. */}
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[3px]"
          style={{ background: category.color }}
        />
      )}

      {/* İkon halosu: kategori rengi + 14% alpha bg, ikon strok renk yoğun. */}
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ background: `${category.color}1f` }}
      >
        <IconComponent
          className="h-[18px] w-[18px]"
          strokeWidth={2}
          style={{ color: category.color }}
        />
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-[13px] font-bold leading-tight"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {category.name}
        </span>
        <span
          className="text-[11px] font-medium"
          style={{ color: 'var(--v3-text-muted)' }}
        >
          {t('admin.menuDefinitions.productsCount', { count: productCount })}
        </span>
      </div>

      <button
        type="button"
        aria-label={t('admin.menuDefinitions.openMenu')}
        onClick={(e) => {
          e.stopPropagation();
          onMenuClick?.();
        }}
        disabled={onMenuClick === undefined}
        className="ml-1 flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-[120ms] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ color: 'var(--v3-text-muted)' }}
      >
        <MoreVertical className="h-[18px] w-[18px]" strokeWidth={2} />
      </button>
    </div>
  );
}
