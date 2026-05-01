import { useTranslation } from 'react-i18next';
import {
  ArrowDownUp,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CATEGORY_ICONS, type CategoryIcon } from '@restoran-pos/shared-types';
import type { ApiCategory } from '../api';

interface CategoryListItemProps {
  category: ApiCategory;
  productCount: number;
  isActive: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onAddProduct?: () => void;
}

/**
 * Sol panel kategori kartı — Sprint 8c PR-D1 + D2 + E2.
 *
 * V3 paritesi `MenuSettingsPage.jsx` kart yapısı + ADR-011 Amendment 2026-05-01
 * Karar 1 (lucide ikon) + Karar 3 (renk halosu) + Karar 6 (3-nokta dropdown
 * menu — V3'teki kebab menü paritesi).
 *
 * 3-nokta menü öğeleri (V3 paritesi, "Toplu işlemler" hariç):
 *   - Ürünleri sırala (disabled, PR-E3'te aktif)
 *   - Yeni ürün ekle (kategori-context'li navigate)
 *   - Düzenle (CategoryDrawer edit mode)
 *   - Kategoriyi sil (DeleteCategoryDialog)
 */
export function CategoryListItem({
  category,
  productCount,
  isActive,
  onClick,
  onEdit,
  onDelete,
  onAddProduct,
}: CategoryListItemProps) {
  const { t } = useTranslation();

  const isWhitelistedIcon = (CATEGORY_ICONS as readonly string[]).includes(category.icon);
  const IconComponent = isWhitelistedIcon
    ? ((LucideIcons as unknown as Record<string, LucideIcon>)[category.icon as CategoryIcon] ??
      UtensilsCrossed)
    : UtensilsCrossed;

  const hasMenu = onEdit || onDelete || onAddProduct;

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

      {hasMenu && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={t('admin.menuDefinitions.openMenu')}
              onClick={(e) => e.stopPropagation()}
              className="flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-[120ms] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              style={{ color: 'var(--v3-text-muted)' }}
            >
              <MoreVertical className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              onClick={(e) => e.stopPropagation()}
              className="z-50 min-w-[200px] overflow-hidden rounded-md border bg-white p-1 shadow-lg"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              <DropdownMenu.Item
                disabled
                className="flex cursor-not-allowed items-center gap-2 rounded-sm px-3 py-2 text-[13px] outline-none data-[disabled]:opacity-40"
                style={{ color: 'var(--v3-text-secondary)' }}
              >
                <ArrowDownUp className="h-4 w-4" strokeWidth={2} />
                <span>{t('admin.menuDefinitions.menu.reorderProducts')}</span>
                <span
                  className="ml-auto text-[10px] uppercase tracking-wide"
                  style={{ color: 'var(--v3-text-muted)' }}
                >
                  {t('admin.menuDefinitions.menu.comingSoon')}
                </span>
              </DropdownMenu.Item>
              {onAddProduct && (
                <DropdownMenu.Item
                  onSelect={onAddProduct}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-[13px] outline-none data-[highlighted]:bg-black/5"
                  style={{ color: 'var(--v3-text-primary)' }}
                >
                  <Plus className="h-4 w-4" strokeWidth={2} />
                  <span>{t('admin.menuDefinitions.menu.addProduct')}</span>
                </DropdownMenu.Item>
              )}
              {onEdit && (
                <DropdownMenu.Item
                  onSelect={onEdit}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-[13px] outline-none data-[highlighted]:bg-black/5"
                  style={{ color: 'var(--v3-text-primary)' }}
                >
                  <Pencil className="h-4 w-4" strokeWidth={2} />
                  <span>{t('admin.menuDefinitions.menu.editCategory')}</span>
                </DropdownMenu.Item>
              )}
              {onDelete && (
                <>
                  <DropdownMenu.Separator
                    className="my-1 h-px"
                    style={{ background: 'var(--v3-border-subtle)' }}
                  />
                  <DropdownMenu.Item
                    onSelect={onDelete}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-[13px] outline-none data-[highlighted]:bg-red-50"
                    style={{ color: 'var(--v3-danger, #dc2626)' }}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                    <span>{t('admin.menuDefinitions.menu.deleteCategory')}</span>
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}
