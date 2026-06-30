import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader2, Package, Phone, RefreshCw } from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { PageHeader } from '../../components/layout/PageHeader';
import {
  useTables,
  useAreas,
  useTableRealtimeInvalidate,
  useAssignTableArea,
  useDeleteTable,
} from './api';
import { TableCard } from './components/TableCard';
import { OrphanTableActionsModal } from './components/OrphanTableActionsModal';
import { useSocketEvent } from '../../lib/socket';
import { TableActionsModal } from '../payment/components/TableActionsModal';
import { QuickPaymentModal } from '../payment/components/QuickPaymentModal';
import { DetailedPaymentModal } from '../payment/components/DetailedPaymentModal';
import { OpenTakeawayOrdersPanel } from '../orders/components/OpenTakeawayOrdersPanel';
import { tableDisplayNumber } from './utils/tableLabel';
import { getErrorMessage } from '../../lib/error';
import type { ApiTable } from './api';
import { toast } from 'sonner';

/**
 * ADR-009 Amendment 2026-06-30 Karar C(b) — bölgesiz (orphan) masaları
 * gösteren sözde-grup sentinel'i. `effectiveAreaId` bu değere eşitse
 * filtre `area_id === null` masaları döndürür. Gerçek bölge id'leri UUID
 * olduğundan bu literal ile çakışmaz.
 */
const UNASSIGNED_AREA = '__unassigned__';

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
  const assignArea = useAssignTableArea();
  const deleteTable = useDeleteTable();

  // Masa tahtası canlılığı orders.* event'lerinden türetilir — backend
  // `tables.statusChanged` emit ETMEZ (ADR-010 §11.6). Sipariş açılışı/iptali/
  // durum değişimi masayı dolu/boş yapar → board invalidate (web + mobil aynı).
  useSocketEvent('orders.created', () => {
    invalidateTables();
  });
  useSocketEvent('orders.statusChanged', () => {
    invalidateTables();
  });
  useSocketEvent('orders.cancelled', () => {
    invalidateTables();
  });

  const navigate = useNavigate();

  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  // ADR-014 §3 + §9 Karar 9.6 — dolu masa 3-nokta menüsü
  const [actionsTarget, setActionsTarget] = useState<ApiTable | null>(null);
  const [quickPayTarget, setQuickPayTarget] = useState<ApiTable | null>(null);
  // ADR-014 §11 Karar 11.2 — "Öde" → DetailedPaymentModal aç (Karar 10.1 revize)
  const [detailedTarget, setDetailedTarget] = useState<ApiTable | null>(null);
  // ADR-009 Amendment Karar C(c) — bölgesiz orphan masa için reassign/sil modali
  const [orphanTarget, setOrphanTarget] = useState<ApiTable | null>(null);

  const allTables = tablesQuery.data ?? [];
  const areas = areasQuery.data ?? [];

  // Karar C(b): bölgesiz (area_id=null) masa sayısı. >0 ise "Bölgesiz" sözde-grup
  // tab'ı render edilir; occupied orphan'lar (kurtarılan açık adisyon) MUTLAKA
  // görünür olur (önceki gizleme filtresi kaldırıldı).
  const orphanTables = useMemo(
    () => allTables.filter((tbl) => tbl.area_id === null),
    [allTables],
  );
  const orphanCount = orphanTables.length;

  // Türetilmiş aktif area: kullanıcı henüz tıklamadıysa ilk area otomatik
  // seçili (Sprint 8c PR #1 — "Tüm masalar" tab'ı yok, areas her zaman dolu
  // varsayımı v3 paritesi). State olarak tutmuyoruz, areas yüklenir yüklenmez
  // doğru tab vurgulansın diye türetilmiş değer. Karar C(b): hiç gerçek bölge
  // yoksa ama orphan masa varsa "Bölgesiz" sözde-grup vurgulanır.
  const effectiveAreaId: string | null =
    activeAreaId ??
    areas[0]?.id ??
    (orphanCount > 0 ? UNASSIGNED_AREA : null);

  const filteredTables = useMemo(() => {
    if (areas.length === 0) return allTables;
    if (effectiveAreaId === null) return [];
    // Karar C(b): "Bölgesiz" sözde-grup seçiliyse area_id=null orphan masalar
    // gösterilir (eskiden son kullanıcıdan gizleniyordu — açık adisyonlu orphan
    // tahtadan kaybolurdu). Aksi halde seçili gerçek bölgenin masaları.
    if (effectiveAreaId === UNASSIGNED_AREA) {
      return allTables.filter((t) => t.area_id === null);
    }
    return allTables.filter((t) => t.area_id === effectiveAreaId);
  }, [allTables, areas.length, effectiveAreaId]);

  // Her area için (dolu/toplam) badge — v3 paritesi (TablesScreen.jsx:635 occupied/total).
  // Bölgesiz sözde-grup için de (dolu/toplam) hesaplanır (Karar C(b)).
  const areaCounts = useMemo(() => {
    const map = new Map<string, { occupied: number; total: number }>();
    for (const area of areas) {
      const inArea = allTables.filter((t) => t.area_id === area.id);
      const occupied = inArea.filter((t) => t.status === 'occupied').length;
      map.set(area.id, { occupied, total: inArea.length });
    }
    const orphanOccupied = orphanTables.filter(
      (t) => t.status === 'occupied',
    ).length;
    map.set(UNASSIGNED_AREA, {
      occupied: orphanOccupied,
      total: orphanTables.length,
    });
    return map;
  }, [areas, allTables, orphanTables]);

  const sortedTables = useMemo(() => {
    return [...filteredTables].sort((a, b) =>
      a.code.localeCompare(b.code, 'tr', { numeric: true }),
    );
  }, [filteredTables]);

  // ADR-009 Amendment 2026-06-30 Karar A: pozisyonel ordinal yerine KALICI
  // per-bölge display_no. Bölgesiz orphan (null) → ham code. i18n key ile
  // formatlanır (hardcoded "Masa" yasağı). Tek noktadan üretilen etiket masa
  // kartı + işlem/ödeme modali + sipariş header'ı ile birebir aynı.
  const labelFor = useMemo(
    () =>
      (tbl: ApiTable): string => {
        const n = tableDisplayNumber(tbl);
        return n !== null ? t('tables.tableLabel', { number: n }) : tbl.code;
      },
    [t],
  );

  const tableLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const tbl of allTables) {
      map.set(tbl.id, labelFor(tbl));
    }
    return map;
  }, [allTables, labelFor]);

  const summary = useMemo(() => {
    const available = allTables.filter((tbl) => tbl.status === 'available').length;
    const occupied = allTables.filter((tbl) => tbl.status === 'occupied').length;
    return { available, occupied, total: allTables.length };
  }, [allTables]);

  const handleRefresh = () => window.location.reload();

  return (
    <AppShell>
      <PageHeader
        title={t('tables.title')}
        centerActions={
          <button
            type="button"
            onClick={() => navigate('/orders/new?type=takeaway')}
            className="inline-flex min-h-[40px] min-w-[132px] items-center justify-center gap-2 whitespace-nowrap rounded-lg border transition-all duration-[120ms] hover:[background:#f0fdf4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
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
        }
        actions={
          <>
            <div
              className="hidden items-center gap-x-3.5 gap-y-2 flex-wrap text-xs tabular-nums sm:flex"
              style={{ color: 'var(--v3-text-muted)' }}
            >
              <span>
                <span
                  className="font-bold"
                  style={{ color: 'var(--v3-success)' }}
                >
                  {summary.available}
                </span>{' '}
                {t('tables.summary.availableShort')}
              </span>
              <span>
                <span
                  className="font-bold"
                  style={{ color: 'var(--v3-warning)' }}
                >
                  {summary.occupied}
                </span>{' '}
                {t('tables.summary.occupiedShort')}
              </span>
            </div>
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
          </>
        }
      />

      {/* Header'ın ALTINDA: content + aside.
          v3 paritesi:
          - content padding: 16px top, 24px right (yok aside: 12px), 24px bottom, 24px left
          - grid gap: 18px (--v3 doesn't expose, hard-coded v3 :649)
          - tabs container margin-bottom: 12px (v3 :629 inline override)
          - aside width: 340px, padding: 16px, gap: 10px (v3 :851-864) */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6 lg:pr-3">
          {(areas.length > 0 || orphanCount > 0) && (
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
                const counts = areaCounts.get(area.id) ?? { occupied: 0, total: 0 };
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
                      // POS 52pt dokunma hedefi (HCI checklist).
                      minHeight: '52px',
                      padding: '14px 16px',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    <span>{area.name}</span>
                    <span className="tabular-nums opacity-70">
                      ({counts.occupied}/{counts.total})
                    </span>
                  </button>
                );
              })}

              {/* Karar C(b): "Bölgesiz" sözde-grup tab'ı — gerçek bölgelerden
                  SONRA, yalnız orphan masa varsa. Occupied orphan'lar burada
                  görünür ve reassign/sil ile kurtarılır. */}
              {orphanCount > 0 &&
                (() => {
                  const isActive = effectiveAreaId === UNASSIGNED_AREA;
                  const counts =
                    areaCounts.get(UNASSIGNED_AREA) ?? { occupied: 0, total: 0 };
                  return (
                    <button
                      type="button"
                      onClick={() => setActiveAreaId(UNASSIGNED_AREA)}
                      aria-pressed={isActive}
                      className="flex flex-1 items-center justify-center gap-1.5 transition-colors"
                      style={{
                        background: isActive ? 'var(--v3-surface-1)' : 'transparent',
                        color: isActive
                          ? 'var(--v3-text-primary)'
                          : 'var(--v3-text-muted)',
                        borderRadius: '6px',
                        boxShadow: isActive ? 'var(--v3-shadow-sm)' : 'none',
                        // POS 52pt dokunma hedefi (HCI checklist).
                        minHeight: '52px',
                        padding: '14px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                      }}
                    >
                      <span>{t('tables.group.unassigned')}</span>
                      <span className="tabular-nums opacity-70">
                        ({counts.occupied}/{counts.total})
                      </span>
                    </button>
                  );
                })()}
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
                {t('tables.empty.noTablesHint')}
              </p>
            </div>
          )}

          {tablesQuery.isSuccess && sortedTables.length > 0 && (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              style={{ gap: '18px', gridAutoRows: '180px' }}
            >
              {sortedTables.map((table) => {
                const isOccupied = table.status === 'occupied';
                const isOrphan = table.area_id === null;
                // Karar C(c): bölgesiz orphan masa kartı tıklanınca reassign/sil
                // modali açılır (sipariş ekranına gitmez) — önce bir bölgeye
                // taşınmalı. Occupied orphan'ın açık adisyonu bu yolla kurtarılır
                // (occupied "Öde/Hızlı Öde" akışına KARIŞTIRILMAZ).
                const actionsHandler =
                  !isOrphan && isOccupied
                    ? () => setActionsTarget(table)
                    : null;
                return (
                  <TableCard
                    key={table.id}
                    table={table}
                    displayName={tableLabels.get(table.id) ?? table.code}
                    isOrphan={isOrphan}
                    onClick={
                      isOrphan
                        ? () => setOrphanTarget(table)
                        : () => navigate(`/tables/${table.id}/order`)
                    }
                    {...(actionsHandler !== null
                      ? { onActionsClick: actionsHandler }
                      : {})}
                  />
                );
              })}
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
          <OpenTakeawayOrdersPanel />
        </aside>
      </div>

      <TableActionsModal
        open={actionsTarget !== null}
        onOpenChange={(v) => !v && setActionsTarget(null)}
        tableCode={actionsTarget !== null ? labelFor(actionsTarget) : ''}
        orderId={actionsTarget?.active_order_id ?? null}
        onPay={() => {
          if (actionsTarget !== null) {
            setDetailedTarget(actionsTarget);
            setActionsTarget(null);
          }
        }}
        onQuickPay={() => {
          if (actionsTarget !== null) {
            setQuickPayTarget(actionsTarget);
            setActionsTarget(null);
          }
        }}
        onTransfer={() => {
          toast.info(t('payment.tableActions.transferComingSoon'));
          setActionsTarget(null);
        }}
        onPrint={() => {
          toast.info(t('payment.tableActions.printComingSoon'));
          setActionsTarget(null);
        }}
        onCancelled={() => {
          invalidateTables();
        }}
      />
      <QuickPaymentModal
        open={quickPayTarget !== null}
        onOpenChange={(v) => !v && setQuickPayTarget(null)}
        orderId={quickPayTarget?.active_order_id ?? null}
        amountCents={quickPayTarget?.active_order_total_cents ?? 0}
        hasTable={true}
        onSuccess={() => {
          invalidateTables();
          setQuickPayTarget(null);
        }}
      />
      <DetailedPaymentModal
        open={detailedTarget !== null}
        onOpenChange={(v) => !v && setDetailedTarget(null)}
        tableCode={detailedTarget !== null ? labelFor(detailedTarget) : ''}
        orderId={detailedTarget?.active_order_id ?? null}
        hasTable={true}
        onCompleted={() => invalidateTables()}
      />
      {/* Karar C(c) — bölgesiz orphan masa: bölgeye ata / boşsa sil. */}
      <OrphanTableActionsModal
        open={orphanTarget !== null}
        onOpenChange={(v) => !v && setOrphanTarget(null)}
        tableLabel={orphanTarget !== null ? labelFor(orphanTarget) : ''}
        isOccupied={orphanTarget?.status === 'occupied'}
        areas={areas}
        isAssigning={assignArea.isPending}
        isDeleting={deleteTable.isPending}
        onReset={() => {
          // Modal kapanışında bekleyen mutation durumunu temizle — sonraki
          // açılışta bayat isPending/error kalmasın (#2).
          assignArea.reset();
          deleteTable.reset();
        }}
        onAssign={(areaId) => {
          if (orphanTarget === null) return;
          assignArea.mutate(
            { id: orphanTarget.id, areaId },
            {
              onSuccess: () => {
                toast.success(t('tables.orphan.assignSuccess'));
                setOrphanTarget(null);
              },
              onError: (err) =>
                toast.error(getErrorMessage(err) || t('tables.orphan.assignFailed')),
            },
          );
        }}
        onDelete={() => {
          if (orphanTarget === null) return;
          deleteTable.mutate(orphanTarget.id, {
            onSuccess: () => {
              toast.success(t('tables.orphan.deleteSuccess'));
              setOrphanTarget(null);
            },
            // Boş masa beklenir; yine de yarış sonucu dolu ise guard 409
            // (TABLE_ALREADY_OCCUPIED) Türkçe toast ile yüzeye çıkar.
            onError: (err) =>
              toast.error(getErrorMessage(err) || t('tables.orphan.deleteFailed')),
          });
        }}
      />
    </AppShell>
  );
}
