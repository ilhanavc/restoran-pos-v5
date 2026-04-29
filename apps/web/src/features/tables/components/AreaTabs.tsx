import type { Area } from '@restoran-pos/shared-types';
import { cn } from '../../../lib/utils';

interface AreaTabsProps {
  areas: Area[];
  /** `null` = "Tümü" sekmesi seçili (filter yok) */
  activeAreaId: string | null;
  onChange: (areaId: string | null) => void;
  /** Her bölgedeki masa sayıları — `null` key = tümü için */
  counts: Record<string | 'all', { available: number; occupied: number; total: number }>;
}

/**
 * Salon bölgesi sekmeleri (İç Salon / Bahçe / vb.).
 * "Tümü" + her area için bir tab. Sayaçlar sağda gösterilir.
 */
export function AreaTabs({ areas, activeAreaId, onChange, counts }: AreaTabsProps) {
  const allCounts = counts.all ?? { available: 0, occupied: 0, total: 0 };
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-stone-100/80 p-1.5 backdrop-blur-sm">
      <Tab
        active={activeAreaId === null}
        onClick={() => onChange(null)}
        label="Tümü"
        count={allCounts.total}
      />
      {areas.map((area) => {
        const c = counts[area.id] ?? { available: 0, occupied: 0, total: 0 };
        return (
          <Tab
            key={area.id}
            active={activeAreaId === area.id}
            onClick={() => onChange(area.id)}
            label={area.name}
            count={c.total}
          />
        );
      })}
    </div>
  );
}

function Tab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all',
        active
          ? 'bg-white text-foreground shadow-sm ring-1 ring-stone-200/80'
          : 'text-muted-foreground hover:bg-white/50',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
          active ? 'bg-stone-100 text-muted-foreground' : 'bg-stone-200/80 text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}
