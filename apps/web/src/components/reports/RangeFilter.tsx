import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

/**
 * Date range preset for `/raporlar` filtering.
 *
 * Sprint 14 PR-5a supports preset switch only.
 * `custom` is enabled with a date picker in PR-5b (disabled for now).
 */
export type RangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

export interface RangeValue {
  preset: RangePreset;
  // PR-5b will add: startDate?: string; endDate?: string;
}

interface RangeFilterProps {
  value: RangeValue;
  onChange: (next: RangeValue) => void;
}

/**
 * Segmented control: 4 preset buttons + 1 disabled "Custom…" button.
 *
 * ADR-011 palette (slate/blue) with 44px min touch target.
 * `aria-pressed` exposes the active state to screen readers.
 */
export default function RangeFilter({ value, onChange }: RangeFilterProps) {
  const { t } = useTranslation();

  const presets: ReadonlyArray<{ key: Exclude<RangePreset, 'custom'>; label: string }> = [
    { key: 'today', label: t('reports.range.today') },
    { key: 'yesterday', label: t('reports.range.yesterday') },
    { key: 'last7', label: t('reports.range.last7') },
    { key: 'last30', label: t('reports.range.last30') },
  ];

  return (
    <div
      role="group"
      aria-label={t('reports.range.label')}
      className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
    >
      {presets.map((p) => {
        const active = value.preset === p.key;
        return (
          <button
            key={p.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange({ preset: p.key })}
            className={cn(
              'inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors',
              active
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100',
            )}
          >
            {p.label}
          </button>
        );
      })}
      <button
        type="button"
        disabled
        aria-pressed={value.preset === 'custom'}
        title={t('reports.range.customSoon')}
        className="inline-flex h-11 cursor-not-allowed items-center justify-center rounded-md px-4 text-sm font-medium text-slate-400"
      >
        {t('reports.range.custom')}
      </button>
    </div>
  );
}
