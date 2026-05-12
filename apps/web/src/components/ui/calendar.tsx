import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { tr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

import 'react-day-picker/dist/style.css';

/**
 * shadcn-style calendar wrapped around `react-day-picker` v9 with Turkish
 * locale + tailwind classes. Use inside a `<Popover>` for date pickers.
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: DayPickerProps): JSX.Element {
  return (
    <DayPicker
      locale={tr}
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'space-y-3',
        month_caption: 'flex justify-center items-center relative h-9',
        caption_label: 'text-sm font-semibold text-slate-900',
        nav: 'flex items-center gap-1',
        button_previous:
          'absolute left-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40',
        button_next:
          'absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'w-9 text-center text-[11px] font-medium uppercase text-slate-500',
        week: 'flex w-full mt-1',
        day: 'relative h-9 w-9 text-center text-sm focus-within:relative focus-within:z-20',
        day_button:
          'inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
        selected:
          'bg-slate-900 text-white hover:bg-slate-900 focus-visible:ring-slate-700',
        today: 'ring-1 ring-slate-300',
        outside: 'text-slate-300',
        disabled: 'text-slate-300 opacity-50 hover:bg-transparent',
        range_middle: 'bg-slate-100 text-slate-900 rounded-none',
        range_start: 'bg-slate-900 text-white rounded-r-none',
        range_end: 'bg-slate-900 text-white rounded-l-none',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  );
}
