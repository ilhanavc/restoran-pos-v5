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

  // Türetilmiş aktif area: kullanıcı henüz tıklamadıysa ilk area otomatik
  // seçili (Sprint 8c PR #1 — "Tüm masalar" tab'ı yok, areas her zaman dolu
  // varsayımı v3 paritesi). State olarak tutmuyoruz, areas yüklenir yüklenmez
  // doğru tab vurgulansın diye türetilmiş değer.
  const effectiveAreaId: string | null = activeAreaId ?? areas[0]?.id ?? null;

  const filteredTables = useMemo(() => {
    if (areas.length === 0) return allTables;
    if (effectiveAreaId === null) return [];
    // area_id null masalar: admin Tanımlamalar'dan görünür, son kullanıcıya
    // gizlenir (UX kararı, Sprint 8c plan).
    return allTables.filter((t) => t.area_id === effectiveAreaId);
  }, [allTables, areas.length, effectiveAreaId]);

  // Her area için (boş/toplam) badge — v3 paritesi.
  const areaCounts = useMemo(() => {
    const map = new Map<string, { available: number; total: number }>();
    for (const area of areas) {
      const inArea = allTables.filter((t) => t.area_id === area.id);
      const available = inArea.filter((t) => t.status === 'available').length;
      map.set(area.id, { available, total: inArea.length });
    }
    return map;
  }, [areas, allTables]);

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
          v3 dikey ölçü: page-top-safe pt 12px + header min-h 54px (Paket btn ezer)
          + mb 14px. py kullanma — Paket btn min-h zaten 54.
          Hamburger AppShell fixed (v3 .sidebar-menu-btn). Sol pl-[74px] = 12+42+12. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
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

        {/* Orta: Paket butonu — v3 GERÇEK render değerleri (DevTools inspect):
            132×40, font 13px (.btn base), padding 10 18, weight 600, radius 8 (.btn radius-sm)
            spec dosyasındaki .tables-paket-btn (line 534) production'da override edilmemiş;
            sadece .btn + .btn-ghost + bg/border/color yeşil tint kalıyor. */}
        <button
          type="button"
          disabled
          title="Faz 3'te aktif"
          className="inline-flex min-h-[40px] min-w-[132px] items-center justify-center gap-2 whitespace-nowrap rounded-lg border cursor-not-allowed transition-all duration-[120ms]"
          style={{
            backgroundColor: '#FFFFFF',
            borderColor: '#22c55e55',
            color: '#16a34a',
            fontSize: '13px',
            fontWeight: 600,
            padding: '10px 18px',
          }}
        >
          <Package size={18} strokeWidth={2} />
          {t('tables.actions.takeaway')}
        </button>

        {/* Sağ: action butonlar — v3 .tables-action-btn .btn-ghost spec:
            44×44, radius 12, bg #FFFFFF, border 1px #D9E2F0, color #42526B
            hover bg #F1F5FB color #11233F, transition 120ms */}
        <div className="flex items-center justify-end gap-3.5">
          <button
            type="button"
            disabled
            aria-label="Çağrılar"
            title="Faz 4'te aktif (Caller ID)"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl opacity-50 cursor-not-allowed transition-all duration-[120ms]"
            style={{
              background: 'var(--v3-surface-1)',
              border: '1px solid var(--v3-border-subtle)',
              color: 'var(--v3-text-secondary)',
            }}
          >
            <Phone className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            aria-label="Yenile"
            className="tables-action-btn inline-flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-[120ms] hover:[background:var(--v3-surface-2)] hover:[color:var(--v3-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
            style={{
              background: 'var(--v3-surface-1)',
              border: '1px solid var(--v3-border-subtle)',
              color: 'var(--v3-text-secondary)',
            }}
          >
            <RefreshCw className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Header'ın ALTINDA: content + aside.
          v3 paritesi:
          - content padding: 16px top, 24px right (yok aside: 12px), 24px bottom, 24px left
          - grid gap: 18px (--v3 doesn't expose, hard-coded v3 :649)
          - tabs container margin-bottom: 12px (v3 :629 inline override)
          - aside width: 340px, padding: 16px, gap: 10px (v3 :851-864) */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6 lg:pr-3">
          {areas.length > 0 && (
            // v3 .tabs: bg surface-2, padding 3px, gap 2px, radius-sm 8px, mb 12px
            <div
              className="mb-3 flex w-full gap-[2px] p-[3px]"
              style={{
                background: 'var(--v3-surface-2)',
                borderRadius: 'var(--v3-radius-sm)',
              }}
            >
              {areas.map((area) => {
                const isActive = effectiveAreaId === area.id;
                const counts = areaCounts.get(area.id) ?? { available: 0, total: 0 };
                return (
                  <button
                    key={area.id}
                    type="button"
                    onClick={() => setActiveAreaId(area.id)}
                    aria-pressed={isActive}
                    className="flex flex-1 items-center justify-center gap-1.5 transition-colors"
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
                    <span>{area.name}</span>
                    <span className="tabular-nums opacity-70">
                      ({counts.available}/{counts.total})
                    </span>
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
