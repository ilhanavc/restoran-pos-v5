import { useTranslation } from 'react-i18next';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ApiCategory } from '../../admin/menu-categories/api';

interface CategoryTabsProps {
  categories: ApiCategory[];
  /** null = "Tümü" (filter yok). */
  activeCategoryId: string | null;
  onChange: (categoryId: string | null) => void;
}

/**
 * Kategori sekmeleri — v3 paritesi (ekran 1: Tümü / Pideler / İçecekler).
 *
 * Aktif sekme: mor accent pill + bold; pasif: sade pill, hover'da hafif vurgu.
 * "Tümü" = filter yok (activeCategoryId === null).
 *
 * sort_order ile sıralı; admin'de tanımlı sıraya saygı.
 */
export function CategoryTabs({
  categories,
  activeCategoryId,
  onChange,
}: CategoryTabsProps) {
  const { t } = useTranslation();

  const sorted = [...categories].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr'),
  );

  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-3">
      <CategoryTab
        active={activeCategoryId === null}
        onClick={() => onChange(null)}
        label={t('order.catalog.tabAll')}
      />
      {sorted.map((category) => (
        <CategoryTab
          key={category.id}
          active={activeCategoryId === category.id}
          onClick={() => onChange(category.id)}
          label={category.name}
          icon={category.icon}
          color={category.color}
        />
      ))}
    </div>
  );
}

interface CategoryTabProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: string;
  color?: string;
}

function CategoryTab({ active, onClick, label, icon, color }: CategoryTabProps) {
  // Lucide icon adı (örn. "UtensilsCrossed") → component lookup. Bilinmeyen
  // ad / boş string → ikon yok.
  const IconCmp =
    icon && icon.length > 0
      ? ((LucideIcons as unknown as Record<string, LucideIcon>)[icon] ?? null)
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[13px] font-bold uppercase transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
      style={{
        background: active
          ? 'var(--v3-purple-bg, #ede9fe)'
          : 'transparent',
        color: active
          ? 'var(--v3-purple, #7c3aed)'
          : 'var(--v3-text-secondary)',
        border: active
          ? '1px solid transparent'
          : '1px solid var(--v3-border-subtle)',
      }}
    >
      {IconCmp && (
        <IconCmp
          aria-hidden="true"
          size={16}
          strokeWidth={2}
          style={color ? { color } : undefined}
        />
      )}
      {label}
    </button>
  );
}
