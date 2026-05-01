import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { CATEGORY_COLORS, type CategoryColor } from '@restoran-pos/shared-types';

interface ColorPickerProps {
  value: CategoryColor;
  onChange: (color: CategoryColor) => void;
  disabled?: boolean;
}

/**
 * Kategori renk seçici — Sprint 8c PR-D2.
 *
 * ADR-011 Amendment 2026-05-01 Karar 3: 8 swatch (Tailwind 600 tonu, WCAG AA).
 * Tile 44×44px touch target. Selected: beyaz check mark + ring.
 */
export function ColorPicker({ value, onChange, disabled }: ColorPickerProps) {
  const { t } = useTranslation();

  return (
    <div role="radiogroup" aria-label={t('admin.menuDefinitions.drawer.colorLabel')}>
      <div className="grid grid-cols-8 gap-2">
        {CATEGORY_COLORS.map((color) => {
          const selected = color === value;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={color}
              disabled={disabled}
              onClick={() => onChange(color)}
              className="flex h-11 w-full items-center justify-center rounded-md transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: color,
                boxShadow: selected ? `0 0 0 2px white, 0 0 0 4px ${color}` : 'none',
              }}
            >
              {selected && <Check className="h-5 w-5 text-white" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
