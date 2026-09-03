import { useTranslation } from 'react-i18next';
import { Info, LayoutGrid } from 'lucide-react';
import type { ReportRangeQuery, TablePerformanceRow } from '@restoran-pos/shared-types';
import { formatTryFromCents } from '../../dashboard/lib/format';
import { useTablePerformance } from '../api';

/**
 * ADR-015 Amendment 9 K14 — Masa Performansı paneli (`ReportsPage`).
 *
 * Sayfanın ORTAK `RangeFilter`'ına bağlıdır (kendi dönem anahtarı YOKTUR):
 * `ChannelMixPanel` ile aralarındaki toplam invariantı (K11) ancak aynı
 * pencerede okunursa tutar; iki panel farklı aralık gösterirse kullanıcı
 * gözünde "rakamlar tutmuyor" sınıfı yeniden açılır.
 *
 * HCI zorunlulukları (A9.7):
 *   - İKİ AYRI PAYDA görünür olmalı: "adisyon" (ciro payda'sı) ≠ "süre örneklemi"
 *     (K3.g). Süre örneklemi boşsa "—" basılır, "0 dk" DEĞİL.
 *   - Masa taşıma atıf notu (K2) panelde yazılı olmalı.
 * Tüm metinler `reports.tablePerformance.*` anahtarlarından gelir (hardcoded yok).
 */

interface TablePerformancePanelProps {
  range?: ReportRangeQuery;
}

/** Süre ortalamasına giremeyen satırda basılan işaret (0 yazmak yalan olurdu). */
const EMPTY_MARK = '—';

export function TablePerformancePanel({
  range,
}: TablePerformancePanelProps = {}): JSX.Element {
  const { t } = useTranslation();
  // Varsayılan `limit` (25) bilinçli: CSV butonu `limit` taşımaz, panel ile
  // indirilen dosya AYNI satır kümesini göstersin (restoran 25 masalı, K8).
  // Kırpma olursa `totalTableCount` özeti bunu görünür kılar.
  const { data, isPending, isError } = useTablePerformance(range);

  /** Saniyeyi Türkçe "s sa d dk" biçimine indirger; örneklem yoksa `—`. */
  const formatOccupancy = (seconds: number | null): string => {
    if (seconds === null) return EMPTY_MARK;
    const totalMinutes = Math.round(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours === 0
      ? t('reports.tablePerformance.duration.minutes', { minutes })
      : t('reports.tablePerformance.duration.hoursMinutes', { hours, minutes });
  };

  /** `turnsPerThousand` integer kontratı — gösterimde /1000, TR ondalık ayracı. */
  const formatTurns = (turnsPerThousand: number | null): string =>
    turnsPerThousand === null
      ? EMPTY_MARK
      : (turnsPerThousand / 1000).toLocaleString('tr-TR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

  if (isPending) {
    return <div className="h-40 animate-pulse rounded-lg bg-stone-100/60" />;
  }
  if (isError || !data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t('reports.tablePerformance.error')}
      </p>
    );
  }
  if (data.tables.length === 0) {
    return (
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <LayoutGrid className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('reports.tablePerformance.empty')}
        </p>
      </div>
    );
  }

  const rows: TablePerformanceRow[] = data.tables;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-2 pr-3">
                {t('reports.tablePerformance.columns.tableCode')}
              </th>
              <th scope="col" className="py-2 pr-3">
                {t('reports.tablePerformance.columns.areaName')}
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                {t('reports.tablePerformance.columns.billCount')}
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                {t('reports.tablePerformance.columns.revenue')}
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                {t('reports.tablePerformance.columns.averageBill')}
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                {t('reports.tablePerformance.columns.avgOccupancy')}
              </th>
              <th scope="col" className="py-2 text-right">
                {t('reports.tablePerformance.columns.turnsPerDay')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.tableCode}
                className="border-b border-stone-100 last:border-0 hover:bg-stone-50"
              >
                <th scope="row" className="py-2 pr-3 text-left font-medium text-foreground">
                  {row.tableCode}
                </th>
                <td className="py-2 pr-3 text-muted-foreground">
                  {row.areaName ?? EMPTY_MARK}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{row.billCount}</td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                  {formatTryFromCents(row.revenueCents)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatTryFromCents(row.averageBillCents)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  <span>{formatOccupancy(row.avgOccupancySeconds)}</span>
                  {/* K3.g — süre payda'sı ciro payda'sından FARKLI; görünür olmalı. */}
                  <span className="block text-[11px] text-muted-foreground">
                    {t('reports.tablePerformance.durationSample', {
                      count: row.durationSampleSize,
                    })}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatTurns(row.turnsPerThousand)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-stone-50 px-3 py-2">
          <dt className="text-xs text-muted-foreground">
            {t('reports.tablePerformance.summary.activeDayCount')}
          </dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">
            {data.activeDayCount}
          </dd>
        </div>
        <div className="rounded-lg bg-stone-50 px-3 py-2">
          <dt className="text-xs text-muted-foreground">
            {t('reports.tablePerformance.summary.tableCount')}
          </dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">
            {data.totalTableCount}
          </dd>
        </div>
        <div className="rounded-lg bg-stone-50 px-3 py-2">
          <dt className="text-xs text-muted-foreground">
            {t('reports.tablePerformance.summary.durationExcluded')}
          </dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">
            {data.durationExcludedCount}
          </dd>
        </div>
      </dl>

      {/* K7/K16.f — masasız adisyon SESSİZCE yok sayılmaz; varsa dürüstçe söylenir. */}
      {data.unassignedOrderCount > 0 ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          <Info aria-hidden="true" className="mt-px h-4 w-4 shrink-0 text-amber-600" />
          <span>
            {t('reports.tablePerformance.info.unassigned', {
              count: data.unassignedOrderCount,
              amount: formatTryFromCents(data.unassignedRevenueCents),
            })}
          </span>
        </p>
      ) : null}

      {/* A9.7 — iki-denominatör ipucu (K3.g) + masa taşıma atıf notu (K2). */}
      <div className="space-y-1 rounded-lg bg-stone-50 px-3 py-2 text-xs text-muted-foreground">
        <p className="flex items-start gap-2">
          <Info aria-hidden="true" className="mt-px h-4 w-4 shrink-0 text-stone-400" />
          <span>{t('reports.tablePerformance.info.twoDenominators')}</span>
        </p>
        <p className="pl-6">{t('reports.tablePerformance.info.mergedExcluded')}</p>
        <p className="pl-6">{t('reports.tablePerformance.info.movedTable')}</p>
        <p className="pl-6">{t('reports.tablePerformance.info.turnsPerDay')}</p>
      </div>
    </div>
  );
}
