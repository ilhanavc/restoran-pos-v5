import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Package, Phone, RefreshCw } from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { useTables, useAreas, useTableRealtimeInvalidate, type ApiTable } from './api';
import { TableCard } from './components/TableCard';
import { TableDetailPlaceholder } from './components/TableDetailPlaceholder';
import { useSocketEvent } from '../../lib/socket';

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
      {/* v3 page-header: 3 sütun grid — sol (başlık+sayaç) | orta (Paket centered) | sağ (icons sade)
          Hamburger AppShell'de fixed olarak yer alıyor (v3 .sidebar-menu-btn paritesi),
          page-header artık sadece içerik. Sol pl-[66px] = 12 (toggle left) + 42 (toggle w) + 12 (gap). */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 pl-[66px] pr-6 py-5">
        {/* Sol: başlık + sayaç (page-title 22px, stat 12px text-muted) */}
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap min-w-0">
          <h1
            className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {t('tables.title')}
          </h1>
          <div
            className="flex items-center gap-x-3.5 gap-y-2 flex-wrap text-xs tabular-nums"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            <span>
              <span className="font-bold" style={{ color: 'var(--v3-success)' }}>
                {summary.available}
              </span>{' '}
              {t('tables.summary.availableShort')}
            </span>
            <span>
              <span className="font-bold" style={{ color: 'var(--v3-warning)' }}>
                {summary.occupied}
              </span>{' '}
              {t('tables.summary.occupiedShort')}
            </span>
          </div>
        </div>

        {/* Orta: Paket butonu — v3 .tables-paket-btn ölçüleri:
            min-h 54px, min-w 132px, padding 0 24, radius 14, font-weight 700
            bg #22c55e14, border #22c55e55, color #16a34a */}
        <button
          type="button"
          disabled
          title="Faz 3'te aktif"
          className="inline-flex min-h-[54px] min-w-[132px] items-center justify-center gap-2 rounded-[14px] border-[1px] px-6 font-bold cursor-not-allowed"
          style={{
            backgroundColor: '#22c55e14',
            borderColor: '#22c55e55',
            color: '#16a34a',
            fontSize: '15px',
            letterSpacing: '-0.01em',
            boxShadow: '0 10px 24px rgba(34,197,94,0.12)',
          }}
        >
          <Package className="h-[18px] w-[18px]" />
          {t('tables.actions.takeaway')}
        </button>

        {/* Sağ: action butonlar (44x44 radius-12, svg 18px, gap 14px) */}
        <div className="flex items-center justify-end gap-3.5">
          <button
            type="button"
            disabled
            aria-label="Çağrılar"
            title="Faz 4'te aktif (Caller ID)"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground opacity-50 cursor-not-allowed"
          >
            <Phone className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            aria-label="Yenile"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-stone-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          >
            <RefreshCw className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {/* Header'ın ALTINDA: content + aside.
          v3 paritesi:
          - content padding: 16px top, 24px right (yok aside: 12px), 24px bottom, 24px left
          - grid gap: 18px (--v3 doesn't expose, hard-coded v3 :649)
          - tabs container margin-bottom: 12px (v3 :629 inline override)
          - aside width: 340px, padding: 16px, gap: 10px (v3 :851-864) */}
      <div className="flex flex-1">
        <div className="flex-1 min-w-0 pt-4 pb-6 pl-6 pr-6 lg:pr-3">
          {areas.length > 0 && (
            // v3 .tabs: bg surface-2, padding 3px, gap 2px, radius-sm 8px, mb 12px
            <div
              className="mb-3 flex w-full gap-[2px] p-[3px]"
              style={{
                background: 'var(--v3-surface-2)',
                borderRadius: 'var(--v3-radius-sm)',
              }}
            >
              {areas.map((area, idx) => {
                const isActive = activeAreaId === area.id || (activeAreaId === null && idx === 0);
                return (
                  <button
                    key={area.id}
                    type="button"
                    onClick={() => setActiveAreaId(area.id)}
                    aria-pressed={isActive}
                    className="flex flex-1 items-center justify-center transition-colors"
                    style={{
                      background: isActive ? 'var(--v3-surface-1)' : 'transparent',
                      color: isActive ? 'var(--v3-text-primary)' : 'var(--v3-text-muted)',
                      borderRadius: '6px',
                      boxShadow: isActive ? 'var(--v3-shadow-sm)' : 'none',
                      padding: '8px 16px',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    {area.name}
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
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              style={{ gap: '18px', gridAutoRows: '180px' }}
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

        {/* Sağ aside — Paket siparişler.
            v3 spec (TablesScreen.jsx:851-864): width 340px, padding 16px,
            bg --bg-secondary (#FFFFFF), border-left --border (#D9E2F0),
            display flex flex-col gap 10px. Title 13px/700, empty 12px/--text-muted. */}
        <aside
          className="hidden shrink-0 lg:flex lg:flex-col"
          style={{
            width: '340px',
            padding: '16px',
            gap: '10px',
            background: 'var(--v3-surface-1)',
            borderLeft: '1px solid var(--v3-border-subtle)',
            overflowY: 'auto',
          }}
        >
          <h2
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--v3-text-primary)',
              marginBottom: '4px',
            }}
          >
            {t('tables.takeaway.title')}
          </h2>
          <p
            style={{
              fontSize: '12px',
              color: 'var(--v3-text-muted)',
              lineHeight: 1.5,
            }}
          >
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
