import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { cn } from '../../../lib/utils';
import { Calendar } from '../../../components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';

/**
 * ADR-015 Amendment 2 — Sprint 15 PR-2.
 *
 * Reports range filter. Four preset buttons (today / yesterday / last7 /
 * last30) plus a `custom` mode that opens a popover with a date-range
 * calendar (react-day-picker, Turkish locale). Backend contract:
 *   - preset → `?range=<kind>` (no from/to)
 *   - custom → `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` (≤ 90 days)
 *
 * Custom is committed only on "Uygula" click — selecting a partial range
 * never reaches the parent (no 400 round-trip while the user is choosing).
 *
 * All labels go through `t('reports.range.*')`. Buttons honour the 44px
 * minimum touch target from the HCI checklist.
 */

interface RangeFilterProps {
  value: ReportRangeQuery;
  onChange: (next: ReportRangeQuery) => void;
}

type PresetKind = 'today' | 'yesterday' | 'last7' | 'last30';

const PRESETS: readonly PresetKind[] = ['today', 'yesterday', 'last7', 'last30'] as const;

const MS_PER_DAY = 86_400_000;
const MAX_RANGE_DAYS = 90;

function toIsoDay(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function parseIsoDay(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined;
  const [y, m, d] = parts as [number, number, number];
  return new Date(y, m - 1, d);
}

export function RangeFilter({ value, onChange }: RangeFilterProps): JSX.Element {
  const { t } = useTranslation();
  const [popoverOpen, setPopoverOpen] = useState(false);

  const initialFrom = parseIsoDay(value.range === 'custom' ? value.from : undefined);
  const initialTo = parseIsoDay(value.range === 'custom' ? value.to : undefined);
  const [pickerRange, setPickerRange] = useState<DateRange | undefined>(
    initialFrom && initialTo ? { from: initialFrom, to: initialTo } : undefined,
  );
  const [error, setError] = useState<string | null>(null);

  const handlePreset = (preset: PresetKind): void => {
    setError(null);
    onChange({ range: preset });
  };

  const handleApply = (): void => {
    if (!pickerRange?.from || !pickerRange.to) return;
    const span = (pickerRange.to.getTime() - pickerRange.from.getTime()) / MS_PER_DAY;
    if (Number.isNaN(span) || span < 0 || span > MAX_RANGE_DAYS) {
      setError(t('reports.range.invalidRange'));
      return;
    }
    setError(null);
    onChange({
      range: 'custom',
      from: toIsoDay(pickerRange.from),
      to: toIsoDay(pickerRange.to),
    });
    setPopoverOpen(false);
  };

  const customActive = popoverOpen || value.range === 'custom';
  const customLabel =
    value.range === 'custom' && value.from && value.to
      ? `${value.from} → ${value.to}`
      : t('reports.range.custom');

  return (
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
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-pressed={customActive}
            aria-haspopup="dialog"
            className={cn(
              'inline-flex min-h-[44px] items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors',
              customActive
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100',
            )}
          >
            <CalendarIcon className="h-4 w-4" />
            {customLabel}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto">
          <Calendar
            mode="range"
            selected={pickerRange}
            onSelect={setPickerRange}
            numberOfMonths={2}
            defaultMonth={pickerRange?.from ?? new Date()}
          />
          {error ? (
            <p className="mt-2 text-xs text-red-700">{error}</p>
          ) : null}
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {t('reports.range.cancelButton')}
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!pickerRange?.from || !pickerRange.to}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('reports.range.applyButton')}
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
