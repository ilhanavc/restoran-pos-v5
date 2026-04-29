import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Package } from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { useTables, useAreas, useTableRealtimeInvalidate, type ApiTable } from './api';
import { TableCard } from './components/TableCard';
import { TableDetailPlaceholder } from './components/TableDetailPlaceholder';
import { useSocketEvent } from '../../lib/socket';
import { cn } from '../../lib/utils';

/**
 * Masalar — Sprint 8b ana sayfa, v3 1:1 layout paritesi.
 *
 * Layout (v3 TablesScreen):
 * - Üst başlık: "Masalar" + "X Boş / Y Dolu" sayaç + "Paket" butonu (Phase 3 placeholder)
 * - Area tabs: areas.length > 0 ise göster (her area için "Name (occupied/total)")
 * - Grid: 3 kolon, 180px row, gap 18px
 * - Sağ aside: "Paket siparişler" (showTakeawaySidebar true ise)
 *
 * Phase 3 (orders + payments hazır olunca):
 * - Card'larda order_total, waiter_name, elapsed time görünür
 * - "Paket" butonu yeni paket sipariş açar
 * - Sağ aside açık takeaway listesi
 *
 * Card label "Masa N" — v3 `masaLabelInArea` paritesi: aktif area
 * içindeki masaları sort_order'a göre indeksleyip "Masa {idx+1}". Areas
 * tab YOK ise tüm masalar tek listede sıralı, code yedek olarak gösterilir.
 */
export default function TablesListPage() {
  const { t } = useTranslation();

  const tablesQuery = useTables();
  const areasQuery = useAreas();
  const invalidateTables = useTableRealtimeInvalidate();

  useSocketEvent('tables.statusChanged', () => {
    invalidateTables();
  });

  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<ApiTable | null>(null);

  const allTables = tablesQuery.data ?? [];
  const areas = areasQuery.data ?? [];

  // Şimdilik area_id backend response'da yok → tüm masalar her area'da görünür
  // varsayımı kullanılmaz. Sprint 8c areas + tables.area_id ile genişletilir.
  // Aktif filter SADECE areas.length > 0 ise + activeAreaId match.
  const filteredTables = useMemo(() => {
    if (areas.length === 0 || activeAreaId === null) return allTables;
    // Phase 8c: tablo.area_id === activeAreaId filter — şu an pass-through.
    return allTables;
  }, [allTables, areas.length, activeAreaId]);

  const sortedTables = useMemo(() => {
    return [...filteredTables].sort((a, b) =>
      a.code.localeCompare(b.code, 'tr', { numeric: true }),
    );
  }, [filteredTables]);

  // displayName: aktif kümede sıraya göre "Masa 1, Masa 2, ..."
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

  return (
    <AppShell>
      <div className="flex h-full min-h-[calc(100vh-3.5rem)] gap-0">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="mx-auto max-w-7xl space-y-5">
            {/* Page header — v3 layout */}
            <header className="flex flex-wrap items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-5">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {t('tables.title')}
                </h1>
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-semibold tabular-nums text-emerald-700">
                    {summary.available} <span className="font-normal text-muted-foreground">{t('tables.summary.availableShort')}</span>
                  </span>
                  <span className="font-semibold tabular-nums text-amber-700">
                    {summary.occupied} <span className="font-normal text-muted-foreground">{t('tables.summary.occupiedShort')}</span>
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 opacity-70 cursor-not-allowed"
                title="Faz 3'te aktif"
              >
                <Package className="h-4 w-4" />
                {t('tables.actions.takeaway')}
              </button>
            </header>

            {/* Area tabs — v3 paritesi (areas[].name + occupied/total) */}
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

            {/* Loading */}
            {tablesQuery.isPending && (
              <div className="flex min-h-[300px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
              </div>
            )}

            {/* Empty */}
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

            {/* Grid — v3 paritesi: 3 kolon, 180px row, gap 18 */}
            {tablesQuery.isSuccess && sortedTables.length > 0 && (
              <div
                className="grid gap-[18px]"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
              >
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

        {/* Right aside — v3 "Paket siparişler" sidebar */}
        <aside className="hidden w-[300px] shrink-0 border-l border-border bg-stone-50/40 p-4 lg:flex lg:flex-col gap-3">
          <h2 className="text-sm font-bold text-foreground">
            {t('tables.takeaway.title')}
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('tables.takeaway.empty')}
          </p>
          <div className="mt-auto rounded-lg border border-amber-200/60 bg-amber-50/50 p-3">
            <p className="text-[11px] font-medium text-amber-800">
              {t('dashboard.phase3Badge')}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
              {t('tables.takeaway.phase3Note')}
            </p>
          </div>
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
