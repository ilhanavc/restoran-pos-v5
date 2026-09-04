import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ReceiptText,
} from 'lucide-react';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { AppShell } from '../../components/layout/AppShell';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAuthStore } from '../../store/auth';
import { useClosedOrders } from '../dashboard/api/reports';
import {
  formatTryFromCents,
  formatDateTimeShort,
} from '../dashboard/lib/format';
import { VoidPaymentDialog } from '../payment/components/VoidPaymentDialog';
import { RangeFilter } from './components/RangeFilter';
import { cn } from '../../lib/utils';

/**
 * `/kapanan-siparisler` — ADR-015 Amendment 10 (Session 119).
 *
 * Kapanan tüm adisyonların (masa + paket) tarih-aralıklı, SAYFALANABILIR tam
 * listesi. Dashboard'daki 5-limitli `ClosedOrdersPanel`'in tam hâli; asıl
 * ürün-sahibi ihtiyacı budur (Amd9 revert'inin doğru karşılığı — "hepsini
 * görmek istiyorum" = liste/browse, analitik DEĞİL).
 *
 * Endpoint: GET /reports/closed-orders?limit=25&offset=…&range=… (offset-tabanlı
 * sayfalama, `totalClosedCount` toplam sayfa için yeterli). Kalem-düzeyi
 * drill-down ve CSV export = v5.1 (kapsam kilidi).
 */

const PAGE_SIZE = 25;

export default function ClosedOrdersPage(): JSX.Element {
  const { t } = useTranslation();

  const [rangeQuery, setRangeQuery] = useState<ReportRangeQuery>({
    range: 'today',
  });
  const [page, setPage] = useState(0);

  // ADR-033 K7a — kapalı adisyon reopen/void; RBAC admin+cashier (K6),
  // takeaway satırında buton yok (K5 — backend zaten 409 döner).
  const role = useAuthStore((s) => s.user?.role);
  const canVoid = role === 'admin' || role === 'cashier';
  const [voidTarget, setVoidTarget] = useState<{
    orderId: string;
    tableCode: string;
  } | null>(null);

  const { data, isPending, isError, isPlaceholderData } = useClosedOrders(
    PAGE_SIZE,
    rangeQuery,
    page * PAGE_SIZE,
  );

  const total = data?.totalClosedCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** Aralık değişince ilk sayfaya dön (aksi halde boş sayfada kalınabilir). */
  const onRangeChange = (next: ReportRangeQuery) => {
    setRangeQuery(next);
    setPage(0);
  };

  return (
    <AppShell>
      <PageHeader
        title={t('closedOrdersPage.title')}
        subtitle={t('closedOrdersPage.subtitle')}
        icon={ReceiptText}
      />

      <div className="flex-1 space-y-6 overflow-auto p-6">
        <RangeFilter value={rangeQuery} onChange={onRangeChange} />

        <div className="rounded-2xl border border-border bg-white shadow-sm">
          {/* Başlık şeridi: toplam kayıt + sayfa göstergesi */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-foreground">
              {t('closedOrdersPage.totalCount', { count: total })}
            </span>
            {total > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {t('closedOrdersPage.pageOf', {
                  page: page + 1,
                  total: totalPages,
                })}
              </span>
            )}
          </div>

          {isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-lg bg-stone-100/70"
                />
              ))}
            </div>
          ) : isError ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t('dashboard.errors.loadFailed')}
            </p>
          ) : total === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="text-sm text-muted-foreground">
                {t('closedOrdersPage.empty')}
              </p>
            </div>
          ) : (
            <ul
              className={cn(
                'divide-y divide-border',
                isPlaceholderData && 'opacity-60',
              )}
            >
              {data!.orders.map((o) => (
                <li
                  key={o.orderId}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-9 min-w-[3rem] items-center justify-center rounded-md bg-emerald-100 px-2 text-xs font-bold text-emerald-800">
                      {o.tableCode ?? t('dashboard.takeaway')}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-foreground tabular-nums">
                        {formatDateTimeShort(o.paidAt)}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {o.paymentTypeMix
                          .map((p) => t(`dashboard.paymentType.${p}`))
                          .join(' + ')}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatTryFromCents(o.totalCents)}
                    </span>
                    {canVoid && o.tableCode !== null && (
                      <button
                        type="button"
                        onClick={() =>
                          setVoidTarget({
                            orderId: o.orderId,
                            tableCode: o.tableCode!,
                          })
                        }
                        className="inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-2.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        {t('payment.void.action')}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Sayfalama kontrolleri — yalnız birden fazla sayfa varken */}
          {total > 0 && totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex h-11 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-stone-50"
              >
                <ChevronLeft className="h-4 w-4" />
                {t('closedOrdersPage.prev')}
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t('closedOrdersPage.pageOf', {
                  page: page + 1,
                  total: totalPages,
                })}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={page >= totalPages - 1}
                className="inline-flex h-11 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-stone-50"
              >
                {t('closedOrdersPage.next')}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <VoidPaymentDialog
        orderId={voidTarget?.orderId ?? null}
        tableCode={voidTarget?.tableCode ?? null}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
      />
    </AppShell>
  );
}
