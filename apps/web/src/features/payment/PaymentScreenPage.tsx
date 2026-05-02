import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  Banknote,
  Check,
  CreditCard,
  Loader2,
  Printer,
  Save,
} from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { formatMoney } from '@restoran-pos/shared-domain';
import { useTables } from '../tables/api';
import { useOpenOrderForTable, useOrderById } from '../orders/api';
import {
  useCreatePayment,
  usePaymentsForOrder,
  type PaymentOperation,
  type PaymentType,
} from './api';
import { SplitByPersonModal } from './components/SplitByPersonModal';

/**
 * PaymentScreenPage — ADR-014 §5 + §9 (full-screen page, modal değil).
 *
 * Layout v3 birebir paritesi (DETAYLI ÖDEME ekran 2/3):
 *   - Header: "DETAYLI ÖDEME" small-caps + Masa N büyük + chip'ler
 *   - Sol: Kalemler listesi (cancelled/comped strikethrough)
 *   - Sağ üst: Sipariş Toplamı + Ödenen (KALAN YOK — Karar 9.2)
 *   - Sağ orta: İşlem Aksiyonu 4-grid (Kaydet / Öde ve Kapat / Öde ve Yazdır / Hepsi)
 *   - Sağ alt: Ödeme Tipi (Nakit/Kart 2-buton)
 *   - Footer: "Ödeme Ekranını Kapat" sol + "✓ Kaydet" sağ
 *
 * Kapsam (PR-7b):
 *   - Tek-payment full scope (tüm sipariş için)
 *   - 4 işlem aksiyonu (operation enum)
 *   - 2 ödeme tipi
 *   - "Ayrı ayrı öde" buton placeholder (PR-7c)
 *
 * Idempotency: modal her açılışta `crypto.randomUUID()` üretilir; kullanıcı
 * Kaydet/Öde basana kadar AYNI key. Network retry idempotent (200 + replay).
 */
export default function PaymentScreenPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const tablesQuery = useTables();
  const table = useMemo(
    () => tablesQuery.data?.find((tbl) => tbl.id === tableId) ?? null,
    [tablesQuery.data, tableId],
  );

  const openOrderQuery = useOpenOrderForTable(tableId ?? null);
  const orderId = openOrderQuery.data?.id ?? null;
  const orderQuery = useOrderById(orderId);
  const paymentsQuery = usePaymentsForOrder(orderId);

  const order = orderQuery.data?.order;
  const items = orderQuery.data?.items ?? [];
  const visibleItems = items.filter((it) => it.status !== 'cancelled');

  const orderTotalCents = order?.total_cents ?? 0;
  const paidCents = useMemo(
    () => (paymentsQuery.data ?? []).reduce((sum, p) => sum + p.amount_cents, 0),
    [paymentsQuery.data],
  );
  const remainingCents = Math.max(0, orderTotalCents - paidCents);

  const [paymentType, setPaymentType] = useState<PaymentType>('cash');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    crypto.randomUUID(),
  );

  const createPayment = useCreatePayment();
  const isProcessing = createPayment.isPending;

  const handleClose = () => navigate('/tables');
  const [splitOpen, setSplitOpen] = useState(false);
  const handleSplitByPerson = () => setSplitOpen(true);

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { code?: string; message?: string } }
        | undefined;
      const code = data?.error?.code;
      if (code !== undefined) {
        const localized = t(`payment.errors.${code}`, { defaultValue: '' });
        if (localized !== '') return localized;
      }
      return data?.error?.message ?? fallback;
    }
    return fallback;
  };

  const submitPayment = async (operation: PaymentOperation) => {
    if (orderId === null || remainingCents <= 0) return;
    try {
      const result = await createPayment.mutateAsync({
        orderId,
        paymentType,
        paymentScope: 'full',
        amountCents: remainingCents,
        idempotencyKey,
        operation,
      });
      toast.success(
        result.replay
          ? t('payment.replayDetected')
          : t('payment.paymentSuccess'),
      );
      // Yeni payment için yeni key (modal kapanmadığında bile)
      setIdempotencyKey(crypto.randomUUID());
      if (
        operation === 'pay_and_close' ||
        operation === 'pay_and_print_close'
      ) {
        navigate('/tables');
      }
    } catch (err) {
      toast.error(extractError(err, t('payment.paymentError')));
    }
  };

  if (tablesQuery.isPending || orderQuery.isPending) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ background: 'var(--v3-bg-app, #F4F7FB)' }}
      >
        <Loader2
          className="h-8 w-8 animate-spin"
          style={{ color: 'var(--v3-text-muted)' }}
        />
      </div>
    );
  }

  if (!table || !order) {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center gap-3 px-6"
        style={{ background: 'var(--v3-bg-app, #F4F7FB)' }}
      >
        <p
          className="text-base font-medium"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('payment.errors.orderNotFound')}
        </p>
        <button
          type="button"
          onClick={handleClose}
          className="inline-flex h-10 items-center rounded-lg border bg-white px-4 text-[13px] font-semibold"
          style={{ borderColor: 'var(--v3-border-subtle)' }}
        >
          {t('payment.errors.backToTables')}
        </button>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen overflow-y-auto"
      style={{ background: 'var(--v3-bg-app, #F4F7FB)' }}
    >
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <div
            className="mb-1 text-[11px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {t('payment.title')}
          </div>
          <div className="flex items-center justify-between">
            <h1
              className="text-[28px] font-extrabold"
              style={{ color: 'var(--v3-text-primary)' }}
            >
              {table.code}
            </h1>
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-10 items-center rounded-lg border bg-white px-4 text-[13px] font-semibold transition-colors"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              {t('payment.closeScreen')}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {order.waiter_user_id !== null && (
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
                style={{
                  background: 'var(--v3-surface-2, #F1F5FB)',
                  color: 'var(--v3-text-secondary)',
                }}
              >
                {t('payment.waiterChip', { name: t('payment.unknown') })}
              </span>
            )}
            <span
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
              style={{
                background: 'var(--v3-surface-2, #F1F5FB)',
                color: 'var(--v3-text-secondary)',
              }}
            >
              {t('payment.itemCount', { count: visibleItems.length })}
            </span>
          </div>
        </div>

        {/* 2-column grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Sol — Kalemler */}
          <div
            className="rounded-2xl p-5"
            style={{
              background: '#fff',
              border: '1px solid var(--v3-border-subtle)',
            }}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div
                  className="text-[15px] font-bold"
                  style={{ color: 'var(--v3-text-primary)' }}
                >
                  {t('payment.itemsTitle')}
                </div>
                <div
                  className="text-[12px]"
                  style={{ color: 'var(--v3-text-muted)' }}
                >
                  {t('payment.itemsSubtitle')}
                </div>
              </div>
              <button
                type="button"
                onClick={handleSplitByPerson}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-white px-3 text-[12px] font-semibold transition-colors"
                style={{ borderColor: 'var(--v3-border-subtle)' }}
              >
                <ArrowLeftRight size={14} />
                {t('payment.splitByPerson')}
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {visibleItems.map((it) => {
                const lineTotal = it.unit_price_cents * it.quantity;
                const isComped = it.is_comped;
                return (
                  <div
                    key={it.id}
                    className="flex items-start gap-3 rounded-lg p-3"
                    style={{
                      background: 'var(--v3-surface-2, #F1F5FB)',
                      opacity: isComped ? 0.5 : 1,
                    }}
                  >
                    <span
                      className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-md px-1.5 text-[12px] font-bold tabular-nums"
                      style={{
                        background: '#fff',
                        color: 'var(--v3-text-muted)',
                      }}
                    >
                      {it.quantity}×
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[14px] font-bold uppercase"
                        style={{ color: 'var(--v3-text-primary)' }}
                      >
                        {it.product_name}
                      </div>
                      <div
                        className="text-[12px]"
                        style={{ color: 'var(--v3-text-secondary)' }}
                      >
                        {it.variant_name_snapshot ?? 'Tam'}
                      </div>
                      {isComped && (
                        <span
                          className="mt-0.5 inline-block text-[10px] font-bold uppercase"
                          style={{ color: 'var(--v3-warning, #D48806)' }}
                        >
                          {t('payment.compedTag')}
                        </span>
                      )}
                    </div>
                    <span
                      className="shrink-0 text-[14px] font-extrabold tabular-nums"
                      style={{
                        color: 'var(--v3-text-primary)',
                        textDecoration: isComped ? 'line-through' : 'none',
                      }}
                    >
                      {formatMoney(lineTotal)}
                    </span>
                  </div>
                );
              })}
              {visibleItems.length === 0 && (
                <div
                  className="rounded-md border border-dashed p-8 text-center text-sm"
                  style={{
                    borderColor: 'var(--v3-border-subtle)',
                    color: 'var(--v3-text-muted)',
                  }}
                >
                  {t('payment.noItems')}
                </div>
              )}
            </div>

            <div
              className="mt-4 rounded-md p-3 text-[12px]"
              style={{
                background: 'var(--v3-surface-2, #F1F5FB)',
                color: 'var(--v3-text-muted)',
              }}
            >
              {t('payment.splitHint')}
            </div>
          </div>

          {/* Sağ — Sayaçlar + İşlem Aksiyonu + Ödeme Tipi */}
          <div className="flex flex-col gap-4">
            {/* Sayaç trio (KALAN YOK — Karar 9.2) */}
            <div className="grid grid-cols-2 gap-3">
              <SummaryCard
                label={t('payment.summary.orderTotal')}
                value={formatMoney(orderTotalCents)}
              />
              <SummaryCard
                label={t('payment.summary.paid')}
                value={formatMoney(paidCents)}
                accent={paidCents > 0 ? 'success' : 'neutral'}
              />
            </div>

            {/* İşlem Aksiyonu 4-grid */}
            <div
              className="rounded-2xl p-5"
              style={{
                background: '#fff',
                border: '1px solid var(--v3-border-subtle)',
              }}
            >
              <div
                className="mb-3 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('payment.actionTitle')}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ActionButton
                  variant="primary"
                  icon={<Save size={16} />}
                  label={t('payment.action.save')}
                  onClick={() => submitPayment('pay')}
                  disabled={isProcessing || remainingCents === 0}
                />
                <ActionButton
                  variant="outline"
                  icon={<Check size={16} />}
                  label={t('payment.action.payAndClose')}
                  onClick={() => submitPayment('pay_and_close')}
                  disabled={isProcessing || remainingCents === 0}
                />
                <ActionButton
                  variant="outline"
                  icon={<Printer size={16} />}
                  label={t('payment.action.payAndPrint')}
                  onClick={() => submitPayment('pay_and_print')}
                  disabled={isProcessing || remainingCents === 0}
                />
                <ActionButton
                  variant="outline"
                  icon={<Printer size={16} />}
                  label={t('payment.action.payPrintClose')}
                  onClick={() => submitPayment('pay_and_print_close')}
                  disabled={isProcessing || remainingCents === 0}
                />
              </div>
            </div>

            {/* Ödeme Tipi 2-buton */}
            <div
              className="rounded-2xl p-5"
              style={{
                background: '#fff',
                border: '1px solid var(--v3-border-subtle)',
              }}
            >
              <div
                className="mb-3 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('payment.typeTitle')}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <PaymentTypeButton
                  active={paymentType === 'cash'}
                  icon={<Banknote size={18} />}
                  label={t('payment.type.cash')}
                  onClick={() => setPaymentType('cash')}
                />
                <PaymentTypeButton
                  active={paymentType === 'card'}
                  icon={<CreditCard size={18} />}
                  label={t('payment.type.card')}
                  onClick={() => setPaymentType('card')}
                />
              </div>
            </div>

            {/* Bottom save (full-width sticky tarz) */}
            <button
              type="button"
              onClick={() => submitPayment('pay')}
              disabled={isProcessing || remainingCents === 0}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg text-[14px] font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: 'var(--v3-purple, #7C5CFA)' }}
            >
              {isProcessing ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Check size={18} />
              )}
              {t('payment.action.save')}
            </button>
          </div>
        </div>
      </div>

      <SplitByPersonModal
        open={splitOpen}
        onOpenChange={setSplitOpen}
        tableCode={table.code}
        orderId={orderId}
        orderItems={items}
        orderTotalCents={orderTotalCents}
        existingPayments={paymentsQuery.data ?? []}
        onPayerCommitted={() => {
          void paymentsQuery.refetch();
          void orderQuery.refetch();
        }}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent = 'neutral',
}: {
  label: string;
  value: string;
  accent?: 'neutral' | 'success';
}) {
  const color =
    accent === 'success'
      ? 'var(--v3-success, #1F9D68)'
      : 'var(--v3-text-primary)';
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: '#fff',
        border: '1px solid var(--v3-border-subtle)',
      }}
    >
      <div
        className="mb-1 text-[11px] font-bold uppercase tracking-wider"
        style={{ color: 'var(--v3-text-muted)' }}
      >
        {label}
      </div>
      <div
        className="text-[22px] font-extrabold tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  variant,
  icon,
  label,
  onClick,
  disabled,
}: {
  variant: 'primary' | 'outline';
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const isPrimary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg text-[13px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        background: isPrimary ? 'var(--v3-purple, #7C5CFA)' : '#fff',
        color: isPrimary ? '#fff' : 'var(--v3-text-primary)',
        border: isPrimary
          ? 'none'
          : '1px solid var(--v3-border-subtle)',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function PaymentTypeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg text-[13px] font-bold transition-colors"
      style={{
        background: active ? 'var(--v3-purple, #7C5CFA)' : '#fff',
        color: active ? '#fff' : 'var(--v3-text-primary)',
        border: active ? 'none' : '1px solid var(--v3-border-subtle)',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
