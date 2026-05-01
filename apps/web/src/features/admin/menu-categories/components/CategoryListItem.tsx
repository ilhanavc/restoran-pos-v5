import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { CATEGORY_ICONS, type CategoryIcon } from '@restoran-pos/shared-types';
import type { ApiCategory } from '../api';

interface CategoryListItemProps {
  category: ApiCategory;
  productCount: number;
  isActive: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

/**
 * Sol panel kategori kartı — Sprint 8c PR-D1 + D2.
 *
 * V3 paritesi `MenuSettingsPage.jsx` kart yapısı + ADR-011 Amendment 2026-05-01
 * Karar 1 (lucide ikon) + Karar 3 (renk halosu).
 *
 * D2: 3-dot menu yerine 2 ayrı btn (Düzenle + Sil) — AreaCard pattern. Her btn
 * 40×40 (HCI Concern-A #1 follow-up). Disabled state: callback yoksa btn
 * görünmez (D1 read-only mode).
 */
export function CategoryListItem({
  category,
  productCount,
  isActive,
  onClick,
  onEdit,
  onDelete,
}: CategoryListItemProps) {
  const { t } = useTranslation();

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
      className="group relative flex cursor-pointer items-center gap-2 overflow-hidden rounded-lg border px-3 py-2.5 transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
      style={{
        background: isActive ? `${category.color}14` : 'var(--v3-surface-1)',
        borderColor: isActive ? `${category.color}55` : 'var(--v3-border-subtle)',
      }}
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[3px]"
          style={{ background: category.color }}
        />
      )}

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

      <div className="flex items-center gap-0.5">
        {onEdit && (
          <button
            type="button"
            aria-label={t('admin.menuDefinitions.editCategory')}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-[120ms] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            <Pencil className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            aria-label={t('admin.menuDefinitions.deleteCategory')}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-[120ms] hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            style={{ color: 'var(--v3-danger, #dc2626)' }}
          >
            <Trash2 className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
