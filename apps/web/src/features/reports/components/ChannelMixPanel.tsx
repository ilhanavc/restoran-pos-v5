import { useTranslation } from 'react-i18next';
import { Info, PieChart } from 'lucide-react';
import type { ChannelMixChannel, ReportRangeQuery } from '@restoran-pos/shared-types';
import { formatTryFromCents } from '../../dashboard/lib/format';
import { useChannelMix } from '../api';

/**
 * ADR-015 Amendment 9 K9/K10/K12 — Kanal Dağılımı paneli (`ReportsPage`).
 *
 * Sayfanın ORTAK `RangeFilter`'ına bağlıdır (K14) — `TablePerformancePanel`
 * ile aynı pencere, çünkü aralarında toplam invariantı vardır (K11).
 *
 * K12 — "Paket" (= paket + kurye) birleştirmesi TEK yerde, BURADA yapılır;
 * sunucu üç `order_type`'ı ayrı basar (enum genişlerse yanıt additive büyür).
 * Sıfır kanal BASTIRILMAZ: dürüst gösterim.
 *
 * K9 — Oran alanı sunucudan GELMEZ; pay burada, tek yerde hesaplanır.
 * K10 — Saatlik kova SİPARİŞ anıdır ("ne zaman sipariş geliyor" = personel
 * planlaması); "para ne zaman tahsil ediliyor" sorusunu Saatlik Ciro paneli
 * yanıtlar. İki panel çelişmez, farklı soruları yanıtlar — ipuçları bunu söyler.
 */

interface ChannelMixPanelProps {
  range?: ReportRangeQuery;
}

/** "Paket" grubuna giren sunucu kanalları (K12). */
const PACKAGE_TYPES: ReadonlySet<string> = new Set(['takeaway', 'delivery']);

/** Kanal kimliğine göre şerit rengi — salon sıcak, paket soğuk (görsel ayrım). */
const CHANNEL_BAR: Record<string, string> = {
  dine_in: 'bg-amber-500',
  takeaway: 'bg-sky-500',
  delivery: 'bg-indigo-500',
};

export function ChannelMixPanel({ range }: ChannelMixPanelProps = {}): JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError } = useChannelMix(range);

  if (isPending) {
    return <div className="h-40 animate-pulse rounded-lg bg-stone-100/60" />;
  }
  if (isError || !data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t('reports.channelMix.error')}
      </p>
    );
  }

  const channels: ChannelMixChannel[] = data.channels;
  const totalRevenueCents = channels.reduce((sum, c) => sum + c.revenueCents, 0);
  const totalOrderCount = channels.reduce((sum, c) => sum + c.orderCount, 0);

  if (totalOrderCount === 0) {
    return (
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <PieChart className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">{t('reports.channelMix.empty')}</p>
      </div>
    );
  }

  /** K9 — pay YALNIZ burada hesaplanır (sunucu yuvarlama politikası icat etmez). */
  const sharePercent = (cents: number): number =>
    totalRevenueCents === 0 ? 0 : Math.round((cents / totalRevenueCents) * 100);

  // K12 — "Salon" ↔ "Paket" (paket + kurye) ikili özeti.
  const hallRevenue = channels
    .filter((c) => !PACKAGE_TYPES.has(c.orderType))
    .reduce((s, c) => s + c.revenueCents, 0);
  const packageRevenue = totalRevenueCents - hallRevenue;

  // Saatlik kova: salon ↔ paket yığılmış sütun; ölçek en yoğun saate göre.
  const hourTotals = data.byHour.map((bucket) => {
    let hall = 0;
    let pack = 0;
    for (const cell of bucket.channels) {
      if (PACKAGE_TYPES.has(cell.orderType)) pack += cell.orderCount;
      else hall += cell.orderCount;
    }
    return { hour: bucket.hour, hall, pack, total: hall + pack };
  });
  const maxHourTotal = Math.max(...hourTotals.map((h) => h.total), 1);

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-amber-50 px-3 py-2">
          <dt className="text-xs text-amber-800">{t('reports.channelMix.group.hall')}</dt>
          <dd className="text-xl font-bold tabular-nums text-amber-900">
            {formatTryFromCents(hallRevenue)}
            <span className="ml-2 text-sm font-medium">
              {t('reports.channelMix.sharePercent', { percent: sharePercent(hallRevenue) })}
            </span>
          </dd>
        </div>
        <div className="rounded-lg bg-sky-50 px-3 py-2">
          <dt className="text-xs text-sky-800">{t('reports.channelMix.group.package')}</dt>
          <dd className="text-xl font-bold tabular-nums text-sky-900">
            {formatTryFromCents(packageRevenue)}
            <span className="ml-2 text-sm font-medium">
              {t('reports.channelMix.sharePercent', {
                percent: sharePercent(packageRevenue),
              })}
            </span>
          </dd>
        </div>
      </dl>

      {/* Sunucu üç kanalı ayrı basar; sıfır olan da GÖRÜNÜR (K9 dürüst gösterim). */}
      <ul className="space-y-2">
        {channels.map((channel) => (
          <li key={channel.orderType} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs font-medium text-foreground">
              {t(`reports.channelMix.orderType.${channel.orderType}`)}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
              <span
                className={`block h-full rounded-full ${CHANNEL_BAR[channel.orderType] ?? 'bg-stone-400'}`}
                style={{ width: `${sharePercent(channel.revenueCents)}%` }}
              />
            </span>
            <span className="w-28 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
              {formatTryFromCents(channel.revenueCents)}
            </span>
            <span className="w-32 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
              {t('reports.channelMix.orderCountShort', { count: channel.orderCount })} ·{' '}
              {t('reports.channelMix.avgShort')}{' '}
              {formatTryFromCents(channel.averageBillCents)}
            </span>
          </li>
        ))}
      </ul>

      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('reports.channelMix.byHour.title')}
        </h4>
        <div className="flex h-32 items-end justify-between gap-1 rounded-lg bg-gradient-to-b from-stone-50 to-white p-2 ring-1 ring-stone-100">
          {hourTotals.map((h) => (
            <div
              key={h.hour}
              className="group relative flex h-full w-full max-w-[22px] flex-col justify-end"
              title={t('reports.channelMix.byHour.tooltip', {
                hour: String(h.hour).padStart(2, '0'),
                hall: h.hall,
                package: h.pack,
              })}
            >
              <div
                className="w-full rounded-t-sm bg-sky-500"
                style={{ height: `${(h.pack / maxHourTotal) * 100}%` }}
              />
              <div
                className="w-full bg-amber-500"
                style={{ height: `${(h.hall / maxHourTotal) * 100}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between px-2 text-[10px] font-medium text-stone-400">
          {[0, 4, 8, 12, 16, 20, 23].map((hour) => (
            <span key={hour}>{String(hour).padStart(2, '0')}:00</span>
          ))}
        </div>
      </div>

      {/* K10 — kova anlamı + çoklu-gün üst üste toplama davranışı yazılı olmalı. */}
      <div className="space-y-1 rounded-lg bg-stone-50 px-3 py-2 text-xs text-muted-foreground">
        <p className="flex items-start gap-2">
          <Info aria-hidden="true" className="mt-px h-4 w-4 shrink-0 text-stone-400" />
          <span>{t('reports.channelMix.info.orderTimeBucket')}</span>
        </p>
        <p className="pl-6">{t('reports.channelMix.info.multiDayStacking')}</p>
        <p className="pl-6">{t('reports.channelMix.info.packageGrouping')}</p>
      </div>
    </div>
  );
}
