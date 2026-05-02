import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  Banknote,
  Check,
  CreditCard,
  Loader2,
  Printer,
  Save,
  X,
} from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { formatMoney } from '@restoran-pos/shared-domain';
import {
  Dialog,
  DialogContent,
} from '../../../components/ui/dialog';
import {
  useCloseOrderAsPaid,
  useCreatePayment,
  useSplitState,
  type PaymentType,
} from '../api';
import { useOrderById } from '../../orders/api';
import { SplitPaymentModal } from './SplitPaymentModal';

/**
 * DetailedPaymentModal — v3 `client/src/components/payments/PaymentScreen.jsx`
 * birebir paritesi (ADR-014 §11 Karar 11.1).
 *
 * Tetikleyiciler (Karar 11.2):
 *   - 3-nokta menü "Öde"
 *   - OrderScreen "Ödeme" butonu
 *
 * Layout (v3 ekran 1+2):
 *   - Header: "DETAYLI ÖDEME" + Masa N + chip'ler + X
 *   - 2-pane:
 *     * Sol: Kalemler kart + "Ayrı ayrı öde" buton
 *     * Sağ: Sayaç bloğu (Sipariş Toplamı/Ödenen + büyük KALAN/Hesap Tamamlandı)
 *            + 4 İşlem Aksiyonu + Nakit/Kart + ALINACAK TUTAR + BAHŞIŞ
 *   - Footer: "Ödeme Ekranını Kapat" + tek BÜYÜK selectedAction butonu
 */

interface DetailedPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableCode: string;
  orderId: string | null;
  hasTable?: boolean;
  onCompleted?: (closed: boolean) => void;
}

type ActionKey = 'save' | 'pay-close' | 'pay-print' | 'pay-print-close';

type LucideIconType = typeof Save;

interface PaymentAction {
  key: ActionKey;
  i18nLabelKey: string;
  closeOrder: boolean;
  printReceipt: boolean;
  tone: 'primary' | 'success' | 'secondary';
  Icon: LucideIconType;
}

const PAYMENT_ACTIONS: ReadonlyArray<PaymentAction> = [
  {
    key: 'save',
    i18nLabelKey: 'payment.detailed.action.save',
    closeOrder: false,
    printReceipt: false,
    tone: 'primary',
    Icon: Save,
  },
  {
    key: 'pay-close',
    i18nLabelKey: 'payment.detailed.action.payAndClose',
    closeOrder: true,
    printReceipt: false,
    tone: 'success',
    Icon: Check,
  },
  {
    key: 'pay-print',
    i18nLabelKey: 'payment.detailed.action.payAndPrint',
    closeOrder: false,
    printReceipt: true,
    tone: 'secondary',
    Icon: Printer,
  },
  {
    key: 'pay-print-close',
    i18nLabelKey: 'payment.detailed.action.payPrintClose',
    closeOrder: true,
    printReceipt: true,
    tone: 'secondary',
    Icon: Printer,
  },
];

export function DetailedPaymentModal({
  open,
  onOpenChange,
  tableCode,
  orderId,
  hasTable = true,
  onCompleted,
}: DetailedPaymentModalProps) {
  const { t } = useTranslation();
  const [paymentType, setPaymentType] = useState<PaymentType>('cash');
  const [actionKey, setActionKey] = useState<ActionKey>('save');
  const [amountInput, setAmountInput] = useState<string>('');
  const [tipInput, setTipInput] = useState<string>('');
  const [splitOpen, setSplitOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    crypto.randomUUID(),
  );

  const splitStateQuery = useSplitState(open ? orderId : null);
  const orderQuery = useOrderById(open ? orderId : null);
  const totals = splitStateQuery.data?.totals;
  const items = orderQuery.data?.items ?? [];
  const visibleItems = items.filter((it) => it.status !== 'cancelled');

  const orderTotal = totals?.order_total_cents ?? 0;
  const paidTotal = totals?.paid_total_cents ?? 0;
  const totalDue = totals?.remaining_total_cents ?? 0;
  const isFullyPaid = orderTotal > 0 && totalDue <= 2; // 2¢ tolerans (v3 0.02 TL)

  // Modal her açılışta state reset + yeni idempotencyKey
  useEffect(() => {
    if (open) {
      setIdempotencyKey(crypto.randomUUID());
      setActionKey('save');
      setPaymentType('cash');
      setAmountInput('');
      setTipInput('');
    }
  }, [open]);

  const selectedAction = useMemo(
    () => PAYMENT_ACTIONS.find((a) => a.key === actionKey) ?? PAYMENT_ACTIONS[0]!,
    [actionKey],
  );

  // ADR-014 §11 Karar 11.6 — payAmount clamp [0, totalDue]
  const requestedAmountCents = useMemo(() => {
    const raw = amountInput.trim().replace(',', '.');
    if (raw === '') return totalDue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.round(parsed * 100);
  }, [amountInput, totalDue]);
  const payAmountCents = Math.min(Math.max(0, requestedAmountCents), totalDue);

  // ADR-014 §11 Karar 11.4 — tipAmount + cashReceived = payAmount + tip
  const tipAmountCents = useMemo(() => {
    const raw = tipInput.trim().replace(',', '.');
    if (raw === '') return 0;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.round(parsed * 100);
  }, [tipInput]);

  const totalCollectionCents = payAmountCents + tipAmountCents;

  const createPayment = useCreatePayment();
  const closeAsPaid = useCloseOrderAsPaid();
  const isProcessing = createPayment.isPending || closeAsPaid.isPending;

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

  const closePaidOrder = async () => {
    if (orderId === null) return;
    try {
      await closeAsPaid.mutateAsync({ orderId });
      toast.success(
        hasTable
          ? t('payment.quick.tableClosedSuccess')
          : t('payment.quick.orderClosedSuccess'),
      );
      onCompleted?.(true);
      onOpenChange(false);
    } catch (err) {
      toast.error(extractError(err, t('payment.quick.closeError')));
    }
  };

  // ADR-014 §11 Karar 11.5 — guards
  const handleSubmit = async () => {
    if (orderId === null) return;
    if (isFullyPaid) {
      if (selectedAction.closeOrder || selectedAction.printReceipt) {
        await closePaidOrder();
      } else {
        toast.info(t('payment.detailed.noBalance'));
      }
      return;
    }
    if (payAmountCents <= 0) {
      toast.error(t('payment.detailed.amountMustBePositive'));
      return;
    }
    if (selectedAction.closeOrder && payAmountCents + 2 < totalDue) {
      toast.error(t('payment.detailed.closeRequiresFullPayment'));
      return;
    }

    try {
      const result = await createPayment.mutateAsync({
        orderId,
        paymentType,
        paymentScope: 'full',
        amountCents: payAmountCents,
        idempotencyKey,
        operation: selectedAction.closeOrder
          ? selectedAction.printReceipt
            ? 'pay_and_print_close'
            : 'pay_and_close'
          : selectedAction.printReceipt
            ? 'pay_and_print'
            : 'pay',
        cashReceivedCents: totalCollectionCents, // = payAmount + tip (v3 paritesi)
        ...(tipAmountCents > 0 ? { tipAmountCents } : {}),
      });
      toast.success(
        result.replay
          ? t('payment.replayDetected')
          : actionKey === 'save'
            ? t('payment.detailed.savedSuccess')
            : t('payment.paymentSuccess'),
      );
      // Yeni idempotencyKey (modal açık kalırsa ek payment için)
      setIdempotencyKey(crypto.randomUUID());
      setAmountInput('');
      setTipInput('');
      onCompleted?.(selectedAction.closeOrder);
      if (selectedAction.closeOrder) {
        onOpenChange(false);
      } else {
        // Refresh state
        void splitStateQuery.refetch();
        void orderQuery.refetch();
      }
    } catch (err) {
      toast.error(extractError(err, t('payment.paymentError')));
    }
  };

  const isLoading = splitStateQuery.isLoading || orderQuery.isLoading;
  const showFooterButton = !isFullyPaid;

  return (
    <>
      <Dialog open={open && !splitOpen} onOpenChange={(v) => !isProcessing && onOpenChange(v)}>
        <DialogContent
          className="!max-w-[1100px] !max-h-[92vh] flex flex-col gap-0 overflow-hidden p-0"
        >
          {/* Header — v3 modal-header */}
          <div
            className="flex items-start justify-between border-b px-5 py-4"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <div>
              <div
                className="mb-1 text-[11px] font-extrabold uppercase tracking-wider"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('payment.detailed.title')}
              </div>
              <h1
                className="text-[22px] font-extrabold"
                style={{ color: 'var(--v3-text-primary)' }}
              >
                {tableCode}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    background: 'var(--v3-surface-2, #F1F5FB)',
                    color: 'var(--v3-text-secondary)',
                  }}
                >
                  {t('payment.detailed.itemCount', { count: visibleItems.length })}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isProcessing}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-stone-100 disabled:opacity-50"
              aria-label={t('payment.detailed.close')}
            >
              <X size={16} />
            </button>
          </div>

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--v3-text-muted)' }} />
            </div>
          ) : (
            <div
              className="grid flex-1 grid-cols-2 gap-0 overflow-hidden"
              style={{ minHeight: 0 }}
            >
              {/* Sol panel — Kalemler */}
              <section
                className="flex flex-col overflow-hidden border-r"
                style={{ borderColor: 'var(--v3-border-subtle)' }}
              >
                <div
                  className="flex items-center justify-between border-b px-4 py-4"
                  style={{ borderColor: 'var(--v3-border-subtle)' }}
                >
                  <div>
                    <div
                      className="text-[15px] font-extrabold"
                      style={{ color: 'var(--v3-text-primary)' }}
                    >
                      {t('payment.itemsTitle')}
                    </div>
                    <div
                      className="mt-0.5 text-[12px]"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {t('payment.itemsSubtitle')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSplitOpen(true)}
                    disabled={isFullyPaid || isProcessing}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-white px-3 text-[12px] font-semibold disabled:opacity-50"
                    style={{ borderColor: 'var(--v3-border-subtle)' }}
                  >
                    <ArrowLeftRight size={14} />
                    {t('payment.splitByPerson')}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {visibleItems.map((it) => {
                    const lineTotal = it.unit_price_cents * it.quantity;
                    const isComped = it.is_comped;
                    return (
                      <div
                        key={it.id}
                        className="flex items-start gap-3 border-b px-4 py-3"
                        style={{
                          borderColor: 'var(--v3-border-subtle)',
                          opacity: isComped ? 0.55 : 1,
                        }}
                      >
                        <span
                          className="inline-flex h-7 min-w-[30px] items-center justify-center rounded-md px-2 text-[12px] font-bold tabular-nums"
                          style={{
                            background: 'var(--v3-surface-2, #F1F5FB)',
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
                      className="m-4 rounded-md border border-dashed p-6 text-center text-sm"
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
                  className="border-t px-4 py-3 text-[12px]"
                  style={{
                    background: 'var(--v3-surface-2, #F1F5FB)',
                    borderColor: 'var(--v3-border-subtle)',
                    color: 'var(--v3-text-muted)',
                  }}
                >
                  {t('payment.splitHint')}
                </div>
              </section>

              {/* Sağ panel — Sayaçlar + İşlem Aksiyonu + Tip + Alınacak Tutar + Bahşiş */}
              <section className="flex flex-col gap-3 overflow-y-auto p-5">
                {/* Sayaç bloğu — v3 paritesi */}
                <div
                  className="rounded-lg p-4"
                  style={{
                    background: 'var(--v3-surface-2, #F1F5FB)',
                    border: '1px solid var(--v3-border-subtle)',
                  }}
                >
                  <div className="mb-3 grid grid-cols-2 gap-2.5">
                    <SmallCounter
                      label={t('payment.summary.orderTotal')}
                      value={formatMoney(orderTotal)}
                    />
                    <SmallCounter
                      label={t('payment.summary.paid')}
                      value={formatMoney(paidTotal)}
                      color={paidTotal > 0 ? 'success' : 'neutral'}
                    />
                  </div>
                  <BigRemainingCard
                    label={
                      isFullyPaid
                        ? t('payment.detailed.accountSettled')
                        : t('payment.split.remaining')
                    }
                    value={formatMoney(totalDue)}
                    isFullyPaid={isFullyPaid}
                  />
                </div>

                {/* 4 İşlem Aksiyonu (sadece !isFullyPaid'de aktif) */}
                <div
                  className="rounded-lg p-4"
                  style={{
                    background: '#fff',
                    border: '1px solid var(--v3-border-subtle)',
                  }}
                >
                  <div
                    className="mb-2 text-[11px] font-extrabold uppercase tracking-wider"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    {t('payment.actionTitle')}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {PAYMENT_ACTIONS.map((act) => {
                      const selected = act.key === actionKey;
                      const Icon = act.Icon;
                      return (
                        <button
                          key={act.key}
                          type="button"
                          onClick={() => setActionKey(act.key)}
                          className="flex items-start justify-between gap-2 rounded-md border-2 p-3 text-left"
                          style={{
                            borderColor: selected
                              ? 'var(--v3-purple, #7C5CFA)'
                              : 'var(--v3-border-subtle)',
                            background: selected
                              ? 'var(--v3-purple-bg, #EEEAFE)'
                              : 'var(--v3-surface-2, #F1F5FB)',
                            minHeight: 60,
                          }}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-1.5">
                              <Icon size={14} />
                              <strong
                                className="text-[13px]"
                                style={{ color: 'var(--v3-text-primary)' }}
                              >
                                {t(act.i18nLabelKey)}
                              </strong>
                            </div>
                          </div>
                          <span
                            aria-hidden="true"
                            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                            style={{
                              border: `2px solid ${selected ? 'var(--v3-purple, #7C5CFA)' : 'var(--v3-border-strong)'}`,
                              background: selected ? 'var(--v3-purple, #7C5CFA)' : 'transparent',
                            }}
                          >
                            {selected && (
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{ background: '#fff' }}
                              />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Ödeme Tipi (Nakit / Kart) — sadece !isFullyPaid */}
                {!isFullyPaid && (
                  <div
                    className="rounded-lg p-4"
                    style={{
                      background: '#fff',
                      border: '1px solid var(--v3-border-subtle)',
                    }}
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <PaymentTypeBtn
                        active={paymentType === 'cash'}
                        icon={<Banknote size={16} />}
                        label={t('payment.type.cash')}
                        onClick={() => setPaymentType('cash')}
                      />
                      <PaymentTypeBtn
                        active={paymentType === 'card'}
                        icon={<CreditCard size={16} />}
                        label={t('payment.type.card')}
                        onClick={() => setPaymentType('card')}
                      />
                    </div>
                  </div>
                )}

                {/* ALINACAK TUTAR — sadece !isFullyPaid */}
                {!isFullyPaid && (
                  <div
                    className="rounded-lg p-4"
                    style={{
                      background: 'var(--v3-surface-2, #F1F5FB)',
                      border: '1px solid var(--v3-border-subtle)',
                    }}
                  >
                    <label
                      className="mb-2 block text-[11px] font-extrabold uppercase tracking-wider"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {t('payment.detailed.amountToCollect')}
                    </label>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amountInput}
                        onChange={(e) => setAmountInput(e.target.value)}
                        placeholder={(totalDue / 100).toFixed(2)}
                        className="h-12 rounded-md border px-3 text-center text-[18px] font-extrabold tabular-nums"
                        style={{ borderColor: 'var(--v3-border-subtle)' }}
                      />
                      <button
                        type="button"
                        onClick={() => setAmountInput((totalDue / 100).toFixed(2))}
                        className="inline-flex h-12 items-center rounded-md border bg-white px-3 text-[12px] font-semibold"
                        style={{ borderColor: 'var(--v3-border-subtle)' }}
                      >
                        {t('payment.detailed.takeRemaining')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAmountInput((orderTotal / 100).toFixed(2))}
                        className="inline-flex h-12 items-center rounded-md border bg-white px-3 text-[12px] font-semibold"
                        style={{ borderColor: 'var(--v3-border-subtle)' }}
                      >
                        {t('payment.detailed.takeAll')}
                      </button>
                    </div>
                    <div
                      className="mt-2.5 text-[12px]"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {t('payment.detailed.processingAmount')}:{' '}
                      <strong style={{ color: 'var(--v3-text-primary)' }}>
                        {formatMoney(payAmountCents)}
                      </strong>
                    </div>
                  </div>
                )}

                {/* BAHŞIŞ — sadece !isFullyPaid (v3 paritesi) */}
                {!isFullyPaid && (
                  <div
                    className="rounded-lg p-4"
                    style={{
                      background: 'var(--v3-surface-2, #F1F5FB)',
                      border: '1px solid var(--v3-border-subtle)',
                    }}
                  >
                    <label
                      className="mb-2 block text-[11px] font-extrabold uppercase tracking-wider"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {t('payment.detailed.tip')}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tipInput}
                      onChange={(e) => setTipInput(e.target.value)}
                      placeholder="0,00"
                      className="h-12 w-full rounded-md border px-3 text-center text-[18px] font-extrabold tabular-nums"
                      style={{ borderColor: 'var(--v3-border-subtle)' }}
                    />
                    <div
                      className="mt-2.5 text-[12px]"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {t('payment.detailed.totalCollection')}:{' '}
                      <strong style={{ color: 'var(--v3-text-primary)' }}>
                        {formatMoney(totalCollectionCents)}
                      </strong>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Footer — Ödeme Ekranını Kapat + (selectedAction varsa) tek BÜYÜK buton */}
          <div
            className="flex items-center justify-between gap-3 border-t px-5 py-4"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isProcessing}
              className="inline-flex h-11 items-center rounded-md border bg-white px-4 text-[13px] font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              {t('payment.closeScreen')}
            </button>
            {showFooterButton && (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={isProcessing}
                className="inline-flex h-12 min-w-[240px] items-center justify-center gap-2 rounded-md text-[15px] font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background:
                    selectedAction.tone === 'success'
                      ? 'var(--v3-success, #1F9D68)'
                      : 'var(--v3-purple, #7C5CFA)',
                }}
              >
                {isProcessing ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <selectedAction.Icon size={18} />
                )}
                {t(selectedAction.i18nLabelKey)}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <SplitPaymentModal
        open={splitOpen}
        onOpenChange={setSplitOpen}
        tableCode={tableCode}
        orderId={orderId}
        onPayerCommitted={() => {
          void splitStateQuery.refetch();
          void orderQuery.refetch();
        }}
      />
    </>
  );
}

function SmallCounter({
  label,
  value,
  color = 'neutral',
}: {
  label: string;
  value: string;
  color?: 'neutral' | 'success';
}) {
  const valueColor =
    color === 'success'
      ? 'var(--v3-success, #1F9D68)'
      : 'var(--v3-text-primary)';
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: '#fff',
        border: '1px solid var(--v3-border-subtle)',
      }}
    >
      <div
        className="text-[10px] font-extrabold uppercase tracking-wider"
        style={{ color: 'var(--v3-text-muted)' }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-[19px] font-extrabold tabular-nums"
        style={{ color: valueColor }}
      >
        {value}
      </div>
    </div>
  );
}

function BigRemainingCard({
  label,
  value,
  isFullyPaid,
}: {
  label: string;
  value: string;
  isFullyPaid: boolean;
}) {
  const accent = isFullyPaid
    ? 'var(--v3-success, #1F9D68)'
    : 'var(--v3-warning, #D48806)';
  const bg = isFullyPaid
    ? 'var(--v3-success-soft, rgba(31, 157, 104, 0.12))'
    : 'var(--v3-warning-soft, rgba(212, 136, 6, 0.14))';
  return (
    <div
      className="rounded-md p-4 text-center"
      style={{ border: `1px solid ${accent}`, background: bg }}
    >
      <div
        className="text-[11px] font-extrabold uppercase tracking-wider"
        style={{ color: accent }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-[36px] font-black tabular-nums"
        style={{
          color: isFullyPaid ? accent : 'var(--v3-text-primary)',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function PaymentTypeBtn({
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
      className="inline-flex h-12 items-center justify-center gap-2 rounded-md text-[13px] font-bold"
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
