import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { cn } from '../../../lib/utils';

/**
 * ADR-015 Amendment 2 — Sprint 15 PR-2.
 *
 * Reports range filter. Four preset buttons (today / yesterday / last7 /
 * last30) plus a `custom` mode that reveals two `<input type="date">` fields
 * and an "Uygula" button. Backend contract:
 *   - preset → `?range=<kind>` (no from/to)
 *   - custom → `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` (≤ 90 days)
 *
 * All labels go through `t('reports.range.*')` — hardcoded strings forbidden.
 * Buttons meet the 44px minimum touch target from the HCI checklist.
 */

interface RangeFilterProps {
  value: ReportRangeQuery;
  onChange: (next: ReportRangeQuery) => void;
}

type PresetKind = 'today' | 'yesterday' | 'last7' | 'last30';

const PRESETS: readonly PresetKind[] = ['today', 'yesterday', 'last7', 'last30'] as const;

/** Inclusive day span between two YYYY-MM-DD strings (0 if same day). */
function daySpan(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

export function RangeFilter({ value, onChange }: RangeFilterProps): JSX.Element {
  const { t } = useTranslation();
  const [customFrom, setCustomFrom] = useState<string>(
    value.range === 'custom' ? value.from ?? '' : '',
  );
  const [customTo, setCustomTo] = useState<string>(
    value.range === 'custom' ? value.to ?? '' : '',
  );
  const [error, setError] = useState<string | null>(null);

  const handlePreset = (preset: PresetKind): void => {
    setError(null);
    onChange({ range: preset });
  };

  const handleCustomActivate = (): void => {
    setError(null);
    onChange({
      range: 'custom',
      from: customFrom || undefined,
      to: customTo || undefined,
    });
  };

  const handleCustomApply = (): void => {
    if (!customFrom || !customTo) return;
    const span = daySpan(customFrom, customTo);
    if (Number.isNaN(span) || span < 0 || span > 90) {
      setError(t('reports.range.invalidRange'));
      return;
    }
    setError(null);
    onChange({ range: 'custom', from: customFrom, to: customTo });
  };

  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label={t('reports.range.label')}
        className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
      >
        {PRESETS.map((preset) => {
          const active = value.range === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={active}
              onClick={() => handlePreset(preset)}
              className={cn(
                'inline-flex min-h-[44px] items-center justify-center rounded-md px-4 text-sm font-medium transition-colors',
                active
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-700 hover:bg-slate-100',
              )}
            >
              {t(`reports.range.${preset}`)}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={value.range === 'custom'}
          onClick={handleCustomActivate}
          className={cn(
            'inline-flex min-h-[44px] items-center justify-center rounded-md px-4 text-sm font-medium transition-colors',
            value.range === 'custom'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-700 hover:bg-slate-100',
          )}
        >
          {t('reports.range.custom')}
        </button>
      </div>
      {value.range === 'custom' ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <label className="flex flex-col text-xs font-medium text-slate-700">
            {t('reports.range.fromLabel')}
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="mt-1 h-11 rounded-md border border-slate-300 px-3 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-slate-700">
            {t('reports.range.toLabel')}
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="mt-1 h-11 rounded-md border border-slate-300 px-3 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={handleCustomApply}
            disabled={!customFrom || !customTo}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('reports.range.applyButton')}
          </button>
          {error ? <p className="w-full text-xs text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
