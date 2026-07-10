import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, CheckCircle2 } from 'lucide-react';
import { useClosedOrders } from '../api/reports';
import { formatTryFromCents, formatTimeHm } from '../lib/format';
import { useAuthStore } from '../../../store/auth';
import { VoidPaymentDialog } from '../../payment/components/VoidPaymentDialog';

export function ClosedOrdersPanel() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useClosedOrders(5);
  // ADR-033 K7a — kapalı adisyon reopen girişi. RBAC admin+cashier (K6);
  // takeaway satırında buton yok (K5 — backend zaten 409 döner).
  const role = useAuthStore((s) => s.user?.role);
  const canVoid = role === 'admin' || role === 'cashier';
  const [voidTarget, setVoidTarget] = useState<{
    orderId: string;
    tableCode: string;
  } | null>(null);

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-lg bg-stone-100/60" />;
  }
  if (isError || !data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t('dashboard.errors.loadFailed')}
      </p>
    );
  }
  if (data.orders.length === 0) {
    return (
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('dashboard.empty.noClosedOrdersToday')}
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {data.orders.map((o) => (
          <li
            key={o.orderId}
            className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-stone-50"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-8 min-w-[2.5rem] items-center justify-center rounded-md bg-emerald-100 px-2 text-xs font-bold text-emerald-800">
                {o.tableCode ?? t('dashboard.takeaway')}
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] text-muted-foreground">
                  {formatTimeHm(o.paidAt)}
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
      <VoidPaymentDialog
        orderId={voidTarget?.orderId ?? null}
        tableCode={voidTarget?.tableCode ?? null}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
      />
    </>
  );
}
