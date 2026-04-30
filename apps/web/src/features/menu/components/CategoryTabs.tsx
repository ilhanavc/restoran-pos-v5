import { useTranslation } from 'react-i18next';
import type { ApiCategoryRaw } from '../api';

interface CategoryTabsProps {
  categories: ApiCategoryRaw[];
  /** "all" → tüm ürünler, aksi: kategori id. */
  activeCategoryId: string | 'all';
  onChange: (next: string | 'all') => void;
  /** Her kategori için ürün sayısı (filtre öncesi tablo). */
  countsByCategory: Map<string, number>;
  totalCount: number;
}

/**
 * Sprint 8c PR #2 — kategori sekmeleri (Tümü + her kategori).
 * Stil Tables ekranındaki area tab container'ı ile birebir aynı (v3 paritesi):
 * surface-2 bg, 3px padding, 2px gap, radius-sm, aktif tab surface-1 + shadow-sm.
 */
export function CategoryTabs({
  categories,
  activeCategoryId,
  onChange,
  countsByCategory,
  totalCount,
}: CategoryTabsProps) {
  const { t } = useTranslation();

  const renderTab = (
    key: string,
    label: string,
    count: number,
    value: string | 'all',
  ) => {
    const isActive = activeCategoryId === value;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onChange(value)}
        aria-pressed={isActive}
        className="flex flex-1 items-center justify-center gap-1.5 transition-colors"
        style={{
          background: isActive ? 'var(--v3-surface-1)' : 'transparent',
          color: isActive ? 'var(--v3-text-primary)' : 'var(--v3-text-muted)',
          borderRadius: '6px',
          boxShadow: isActive ? 'var(--v3-shadow-sm)' : 'none',
          padding: '8px 16px',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        <span>{label}</span>
        <span className="tabular-nums opacity-70">({count})</span>
      </button>
    );
  };

  return (
    <div
      className="mb-3 flex w-full gap-[2px] p-[3px]"
      style={{
        background: 'var(--v3-surface-2)',
        borderRadius: 'var(--v3-radius-sm)',
      }}
    >
      {renderTab('all', t('menu.tabs.all'), totalCount, 'all')}
      {categories.map((cat) =>
        renderTab(cat.id, cat.name, countsByCategory.get(cat.id) ?? 0, cat.id),
      )}
    </div>
  );
}
