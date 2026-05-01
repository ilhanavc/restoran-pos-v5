import { useTranslation } from 'react-i18next';
import * as LucideIcons from 'lucide-react';
import { UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { CATEGORY_ICONS, type CategoryIcon } from '@restoran-pos/shared-types';

interface IconPickerProps {
  value: CategoryIcon;
  onChange: (icon: CategoryIcon) => void;
  /** Seçili kategori rengi — selected tile'a uygulanır. */
  accentColor: string;
  disabled?: boolean;
}

/**
 * Kategori ikon seçici — Sprint 8c PR-D2.
 *
 * ADR-011 Amendment 2026-05-01 Karar 2: 18 lucide ikon, 6 sütun grid.
 * Tile boyut 52×52px (HCI dokunma hedefi). Selected: accentColor border + bg.
 */
export function IconPicker({ value, onChange, accentColor, disabled }: IconPickerProps) {
  const { t } = useTranslation();

  return (
    <div role="radiogroup" aria-label={t('admin.menuDefinitions.drawer.iconLabel')}>
      <div className="grid grid-cols-6 gap-2">
        {CATEGORY_ICONS.map((iconName) => {
          const IconComponent =
            ((LucideIcons as unknown as Record<string, LucideIcon>)[iconName] ??
              UtensilsCrossed);
          const selected = iconName === value;
          return (
            <button
              key={iconName}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={iconName}
              disabled={disabled}
              onClick={() => onChange(iconName)}
              className="flex h-[52px] w-full items-center justify-center rounded-md border transition-all duration-[120ms] hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: selected ? accentColor : 'var(--v3-border-subtle)',
                background: selected ? `${accentColor}1f` : 'var(--v3-surface-1)',
                borderWidth: selected ? '2px' : '1px',
              }}
            >
              <IconComponent
                className="h-5 w-5"
                strokeWidth={2}
                style={{ color: selected ? accentColor : 'var(--v3-text-secondary)' }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
