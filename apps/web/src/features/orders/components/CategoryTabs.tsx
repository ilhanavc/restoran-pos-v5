import { useTranslation } from 'react-i18next';
import type { ApiCategory } from '../../admin/menu-categories/api';

/**
 * Kategori sekme pastelleri (S99 — Adisyo referansı, mobil CategoryGrid ile
 * ortak görsel dil). Kategori verisi ayırt edici renk taşımadığından palet
 * konuma göre döner: deterministik, veri-bağımsız, komşu sekmeler hep farklı.
 * Hepsi açık — koyu etiket metni (`--v3-text-primary`) üstlerinde >= 8:1.
 */
const CATEGORY_PASTELS = [
  '#bee3da', // mint
  '#f7d0c9', // salmon
  '#c7c5ec', // periwinkle
  '#e6c3d6', // rose
  '#cbd0b4', // sage
  '#d3c4ec', // lilac
  '#e8d8b8', // sand
  '#b5e2d4', // teal
];

interface CategoryTabsProps {
  categories: ApiCategory[];
  /** null = "Tümü" (filter yok). */
  activeCategoryId: string | null;
  onChange: (categoryId: string | null) => void;
}

/**
 * Kategori sekmeleri — v3 paritesi (ekran 1: Tümü / Pideler / İçecekler),
 * S99 pastel revizyonu.
 *
 * Her kategori sekmesi ayrı pastel dolgu taşır (ürün kartlarından — beyaz +
 * gölge — renkle net ayrılır; kullanıcının "kategoriler ürünlerle karışıyor"
 * şikayetinin çözümü). Seçili sekme beyaza + koyu alt-çizgiye + gölgeye yükselir
 * (mobil + Adisyo paritesi). "Tümü" nötr gri (meta-filtre, kategori değil).
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
        pastel={null}
      />
      {sorted.map((category, index) => (
        <CategoryTab
          key={category.id}
          active={activeCategoryId === category.id}
          onClick={() => onChange(category.id)}
          label={category.name}
          pastel={CATEGORY_PASTELS[index % CATEGORY_PASTELS.length] ?? '#bee3da'}
        />
      ))}
    </div>
  );
}

interface CategoryTabProps {
  active: boolean;
  onClick: () => void;
  label: string;
  /** Kategori pastel dolgusu; null = "Tümü" (nötr gri). */
  pastel: string | null;
}

function CategoryTab({ active, onClick, label, pastel }: CategoryTabProps) {
  // Aktif: beyaz + koyu alt-çizgi + gölge (yükselmiş "aktif" hissi). Pasif:
  // pastel dolgu (kategori) veya nötr gri ("Tümü").
  const background = active ? '#ffffff' : (pastel ?? '#e5e7eb');

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex h-11 items-center justify-center rounded-lg px-5 text-[13px] font-bold uppercase tracking-tight transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
      style={{
        background,
        color: 'var(--v3-text-primary)',
        borderBottom: active
          ? '3px solid var(--v3-text-primary, #11233F)'
          : '3px solid transparent',
        boxShadow: active
          ? 'var(--v3-shadow-sm, 0 2px 8px rgba(17, 35, 63, 0.06))'
          : 'none',
      }}
    >
      {label}
    </button>
  );
}
