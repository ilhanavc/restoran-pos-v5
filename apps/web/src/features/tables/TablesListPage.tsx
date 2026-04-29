import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Package, Menu, Phone, RefreshCw } from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { useTables, useAreas, useTableRealtimeInvalidate, type ApiTable } from './api';
import { TableCard } from './components/TableCard';
import { TableDetailPlaceholder } from './components/TableDetailPlaceholder';
import { useSocketEvent } from '../../lib/socket';
import { useSidebarStore } from '../../store/sidebar';
import { cn } from '../../lib/utils';

/**
 * Masalar — Sprint 8b ana sayfa, v3 1:1 layout paritesi.
 *
 * v3 layout:
 * - page-header full-width (border yok, bg yok), tüm aksiyonlar tek satır
 * - Sağ aside (Paket siparişler) header'ın ALTINDAN başlar — header butonlarını
 *   işgal etmez (önceki sürümde yapıyordu, fix)
 * - Grid 3 kolon (lg+), 180px sabit row, geniş kartlar
 */
export default function TablesListPage() {
  const { t } = useTranslation();

  const tablesQuery = useTables();
  const areasQuery = useAreas();
  const invalidateTables = useTableRealtimeInvalidate();
  const sidebarOpen = useSidebarStore((s) => s.open);
  const toggleSidebar = useSidebarStore((s) => s.toggle);

  useSocketEvent('tables.statusChanged', () => {
    invalidateTables();
  });

  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<ApiTable | null>(null);

  const allTables = tablesQuery.data ?? [];
  const areas = areasQuery.data ?? [];

  const filteredTables = useMemo(() => {
    if (areas.length === 0 || activeAreaId === null) return allTables;
    return allTables;
  }, [allTables, areas.length, activeAreaId]);

  const sortedTables = useMemo(() => {
    return [...filteredTables].sort((a, b) =>
      a.code.localeCompare(b.code, 'tr', { numeric: true }),
    );
  }, [filteredTables]);

  const tableLabels = useMemo(() => {
    const map = new Map<string, string>();
    sortedTables.forEach((tbl, idx) => {
      map.set(tbl.id, `Masa ${idx + 1}`);
    });
    return map;
  }, [sortedTables]);

  const summary = useMemo(() => {
    const available = allTables.filter((tbl) => tbl.status === 'available').length;
    const occupied = allTables.filter((tbl) => tbl.status === 'occupied').length;
    return { available, occupied, total: allTables.length };
  }, [allTables]);

  const handleRefresh = () => window.location.reload();

  return (
    <AppShell>
      {/* v3 page-header: full width, tek satır */}
      <div className="px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <div className="flex flex-1 items-center gap-3 min-w-0">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Menüyü aç"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-foreground transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              {t('tables.title')}
            </h1>
            <div className="flex items-center gap-3 text-sm tabular-nums">
              <span>
                <span className="font-bold text-emerald-600">{summary.available}</span>
                <span className="ml-1 text-muted-foreground">{t('tables.summary.availableShort')}</span>
              </span>
              <span>
                <span className="font-bold text-amber-600">{summary.occupied}</span>
                <span className="ml-1 text-muted-foreground">{t('tables.summary.occupiedShort')}</span>
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled
            title="Faz 3'te aktif"
            className="hidden sm:inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 opacity-70 cursor-not-allowed"
          >
            <Package className="h-4 w-4" />
            {t('tables.actions.takeaway')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              aria-label="Çağrılar"
              title="Faz 4'te aktif (Caller ID)"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-stone-200 bg-white text-muted-foreground opacity-60 cursor-not-allowed"
            >
              <Phone className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="Yenile"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-stone-200 bg-white text-foreground transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Header'ın ALTINDA: content + aside */}
      <div className="flex flex-1">
        <div className="flex-1 min-w-0 px-4 pb-6 sm:px-6">
          <div className="space-y-5">
            {areas.length > 0 && (
              <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-stone-200 bg-white p-1">
                {areas.map((area) => {
                  const active = activeAreaId === area.id;
                  return (
                    <button
                      key={area.id}
                      type="button"
                      onClick={() => setActiveAreaId(active ? null : area.id)}
                      aria-pressed={active}
                      className={cn(
                        'flex h-10 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-medium transition-colors',
                        active
                          ? 'bg-stone-100 text-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-stone-50',
                      )}
                    >
                      {area.name}
                      <span className="text-[11px] text-muted-foreground tabular-nums">(0/0)</span>
                    </button>
                  );
                })}
              </div>
            )}

            {tablesQuery.isPending && (
              <div className="flex min-h-[300px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
              </div>
            )}

            {tablesQuery.isSuccess && sortedTables.length === 0 && (
              <div className="rounded-lg border border-dashed border-stone-300 bg-white/50 p-12 text-center">
                <p className="text-base font-medium text-foreground">
                  {t('tables.empty.noTables')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Masa eklemek için Tanımlamalar sayfasını kullanın.
                </p>
              </div>
            )}

            {tablesQuery.isSuccess && sortedTables.length > 0 && (
              <div className="grid gap-[18px] grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {sortedTables.map((table) => (
                  <TableCard
                    key={table.id}
                    table={table}
                    displayName={tableLabels.get(table.id) ?? table.code}
                    onClick={() => setDetailTarget(table)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sağ aside — Paket siparişler (v3 paritesi: kompakt, sade) */}
        <aside className="hidden w-[280px] shrink-0 border-l border-border p-4 lg:block">
          <h2 className="text-sm font-semibold text-foreground">
            {t('tables.takeaway.title')}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t('tables.takeaway.empty')}
          </p>
        </aside>
      </div>

      <TableDetailPlaceholder
        open={detailTarget !== null}
        onOpenChange={(v) => !v && setDetailTarget(null)}
        displayName={detailTarget ? tableLabels.get(detailTarget.id) ?? detailTarget.code : null}
      />
    </AppShell>
  );
}
