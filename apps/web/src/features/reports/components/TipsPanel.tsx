import { useTranslation } from 'react-i18next';
import { HandCoins } from 'lucide-react';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { formatTryFromCents } from '../../dashboard/lib/format';
import { cn } from '../../../lib/utils';
import { useTips } from '../api';
import { formatDayShort } from '../lib/formatDay';

/**
 * ADR-015 Amendment 8 K9/K11 — Bahşiş paneli (`ReportsPage`, YALNIZ admin).
 *
 * Çağıran taraf `role === 'admin'` kontrolüyle render eder; kasiyerde bileşen
 * hiç mount edilmez (403 hata kutusu göstermek kötü UX). Gerçek kilit
 * sunucudadır (`authorize(['admin'])` + `reports.tips.read`) — client gizleme
 * yalnız UX.
 *
 * K10: bahşiş HİÇBİR ciro toplamına dahil değildir; panel bunu alt-metinle
 * açıkça söyler (kullanıcı "ciro neden tutmuyor" sorusunu sormasın).
 * K11: toplam 0 ise dürüst boş durum + giriş-kapsamı ipucu (bahşiş bugün yalnız
 * Detaylı Ödeme ekranından giriliyor).
 *
 * Trend paneliyle aynı sapma: kendi 7/30 anahtarını taşır (sayfa
 * `RangeFilter`'ından bağımsız), böylece iki panel aynı zaman ekseninde okunur.
 */

const TIPS_RANGES = ['last7', 'last30'] as const;
export type TipsRange = (typeof TIPS_RANGES)[number];

interface TipsPanelProps {
  /** Panel penceresi `ReportsPage`'de tutulur — CSV butonu aynı aralığı indirir. */
  value: TipsRange;
  onChange: (range: TipsRange) => void;
}

export function TipsPanel({ value: range, onChange }: TipsPanelProps): JSX.Element {
  const { t } = useTranslation();
  const rangeQuery: ReportRangeQuery = { range };
  const { data, isPending, isError } = useTips(rangeQuery);

  const maxTip = data === undefined ? 0 : Math.max(...data.byDay.map((d) => d.tipCents), 1);

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label={t('reports.tips.rangeLabel')}
        className="flex flex-wrap items-center gap-2"
      >
        {TIPS_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            aria-pressed={range === r}
            className={cn(
              'min-h-[44px] rounded-lg px-4 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500',
              range === r
                ? 'bg-stone-800 text-white'
                : 'bg-stone-100 text-stone-700 hover:bg-stone-200',
            )}
          >
            {t(`reports.tips.range.${r}`)}
          </button>
        ))}
      </div>

      {isPending ? (
        <div className="h-28 animate-pulse rounded-lg bg-stone-100/60" />
      ) : isError || !data ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('reports.tips.errors.loadFailed')}
        </p>
      ) : data.totalTipCents === 0 ? (
        <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <HandCoins className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground">{t('reports.tips.empty.title')}</p>
          <p className="max-w-md text-xs text-muted-foreground">
            {t('reports.tips.empty.hint')}
          </p>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-amber-50 px-3 py-2">
              <dt className="text-xs text-amber-800">{t('reports.tips.total')}</dt>
              <dd className="text-xl font-bold tabular-nums text-amber-900">
                {formatTryFromCents(data.totalTipCents)}
              </dd>
            </div>
            <div className="rounded-lg bg-stone-50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">
                {t('reports.tips.paymentCount')}
              </dt>
              <dd className="text-xl font-semibold tabular-nums text-foreground">
                {data.tipPaymentCount}
              </dd>
            </div>
          </dl>

          <ul className="space-y-1">
            {data.byDay.map((d) => (
              <li key={d.date} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatDayShort(d.date)}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
                  <span
                    className="block h-full rounded-full bg-amber-500"
                    style={{ width: `${(d.tipCents / maxTip) * 100}%` }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">
                  {formatTryFromCents(d.tipCents)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* K10 — ciroya dahil değildir; her durumda görünür (boş durumda da). */}
      <p className="text-xs text-muted-foreground">{t('reports.tips.notInRevenue')}</p>
    </div>
  );
}
