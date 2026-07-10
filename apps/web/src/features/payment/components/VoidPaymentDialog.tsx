import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, CreditCard, Landmark, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney } from '@restoran-pos/shared-domain';
import type { PaymentVoidReason } from '@restoran-pos/shared-types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { getErrorMessage } from '../../../lib/error';
import {
  usePaymentsForOrder,
  useVoidPayment,
  type ApiPayment,
  type PaymentType,
} from '../api';

/**
 * Ödeme geri alma onayı — ADR-033 K7 (2 giriş, tek endpoint).
 *
 * Giriş noktaları: ClosedOrdersPanel satırı (paymentId'siz — ödemeler burada
 * listelenir, tek aktif ödeme otomatik seçilir) + SplitPaymentModal ödeme
 * satırı (paymentId önceden seçili). Sebep ZORUNLU enum (K6, serbest metin
 * YOK — PII önlemi); seçilmeden onay butonu kapalı. Voided satırlar üstü
 * çizili ve seçilemez (K7). Backend paid order'da void'i otomatik reopen'a
 * çevirir (K3) — başarı mesajı `reopened`'a göre ayrışır. Fiş yeniden
 * BASILMAZ (K8 i) — operatör müşterideki fişi fiziksel iptal eder.
 */

const VOID_REASONS: readonly PaymentVoidReason[] = [
  'wrong_payment_type',
  'wrong_amount',
  'wrong_table',
  'duplicate',
  'other',
] as const;

const TYPE_ICONS: Record<PaymentType, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  transfer: Landmark,
};

interface VoidPaymentDialogProps {
  /** null = kapalı; dolu = açık + hedef sipariş. */
  orderId: string | null;
  /** Önceden seçili ödeme (split satırından); yoksa listeden seçilir. */
  paymentId?: string | null;
  /** Başlıkta masa bağlamı (yanlış satır void'ine karşı görünürlük). */
  tableCode?: string | null;
  onOpenChange: (open: boolean) => void;
}

export function VoidPaymentDialog({
  orderId,
  paymentId = null,
  tableCode = null,
  onOpenChange,
}: VoidPaymentDialogProps) {
  const { t } = useTranslation();
  const [manualPaymentId, setManualPaymentId] = useState<string | null>(null);
  const [reason, setReason] = useState<PaymentVoidReason | null>(null);

  const paymentsQuery = usePaymentsForOrder(orderId);
  const payments = useMemo(
    () => paymentsQuery.data ?? [],
    [paymentsQuery.data],
  );
  const activePayments = useMemo(
    () => payments.filter((p) => p.voided_at === null),
    [payments],
  );

  // Her açılışta seçim state'i sıfırlanır (önceki void'in sebebi taşınmasın).
  useEffect(() => {
    setManualPaymentId(null);
    setReason(null);
  }, [orderId]);

  const selectedPaymentId =
    manualPaymentId ??
    paymentId ??
    (activePayments.length === 1 ? activePayments[0]!.id : null);

  const voidPayment = useVoidPayment();
  const isPending = voidPayment.isPending;
  const canConfirm =
    orderId !== null &&
    selectedPaymentId !== null &&
    reason !== null &&
    !isPending;

  const handleConfirm = async () => {
    if (orderId === null || selectedPaymentId === null || reason === null) {
      return;
    }
    try {
      const result = await voidPayment.mutateAsync({
        orderId,
        paymentId: selectedPaymentId,
        reasonCode: reason,
      });
      toast.success(
        t(result.reopened ? 'payment.void.successReopened' : 'payment.void.success'),
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <Dialog
      open={orderId !== null}
      onOpenChange={(v) => !isPending && onOpenChange(v)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tableCode !== null && tableCode !== ''
              ? t('payment.void.dialog.titleWithTable', { code: tableCode })
              : t('payment.void.dialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('payment.void.dialog.body')}{' '}
            {t('payment.void.dialog.receiptNote')}
          </DialogDescription>
        </DialogHeader>

        {/* Ödeme listesi */}
        <div className="flex flex-col gap-2">
          <span
            className="text-[12px] font-bold uppercase"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {t('payment.void.dialog.selectPayment')}
          </span>
          {paymentsQuery.isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          {paymentsQuery.isError && (
            <p className="py-2 text-sm" style={{ color: 'var(--v3-danger, #D64545)' }}>
              {t('payment.void.dialog.loadFailed')}
            </p>
          )}
          {!paymentsQuery.isLoading && !paymentsQuery.isError && (
            <div role="radiogroup" className="flex flex-col gap-1.5">
              {payments.map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  selected={p.id === selectedPaymentId}
                  disabled={isPending}
                  onSelect={() => setManualPaymentId(p.id)}
                />
              ))}
              {activePayments.length === 0 && (
                <p
                  className="rounded-md border border-dashed p-3 text-center text-sm"
                  style={{
                    borderColor: 'var(--v3-border-subtle)',
                    color: 'var(--v3-text-muted)',
                  }}
                >
                  {t('payment.void.dialog.noPayments')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Sebep (zorunlu enum — ADR-033 K6) */}
        <div className="mt-3 flex flex-col gap-2">
          <span
            className="text-[12px] font-bold uppercase"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {t('payment.void.dialog.selectReason')}
          </span>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {VOID_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                disabled={isPending}
                className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50"
                style={{
                  background:
                    reason === r ? 'var(--v3-danger, #dc2626)' : '#fff',
                  color: reason === r ? '#fff' : 'var(--v3-text-primary)',
                  border:
                    reason === r
                      ? '1px solid var(--v3-danger, #dc2626)'
                      : '1px solid var(--v3-border-subtle)',
                }}
              >
                {t(`payment.void.reason.${r}`)}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!canConfirm}
            style={{ background: 'var(--v3-danger, #dc2626)', color: '#fff' }}
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            {t('payment.void.dialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentRow({
  payment,
  selected,
  disabled,
  onSelect,
}: {
  payment: ApiPayment;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const isVoided = payment.voided_at !== null;
  const Icon = TYPE_ICONS[payment.payment_type];
  const time = new Date(payment.created_at).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled || isVoided}
      className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left disabled:cursor-not-allowed"
      style={{
        background: selected ? 'var(--v3-surface-2, #F1F5FB)' : '#fff',
        border: selected
          ? '1.5px solid var(--v3-danger, #dc2626)'
          : '1px solid var(--v3-border-subtle)',
        opacity: isVoided ? 0.55 : 1,
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon size={15} style={{ color: 'var(--v3-text-muted)' }} />
        <span
          className={`truncate text-[13px] font-bold ${isVoided ? 'line-through' : ''}`}
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {payment.payer_label !== null && payment.payer_label !== ''
            ? `${payment.payer_label} · `
            : ''}
          {t(`dashboard.paymentType.${payment.payment_type}`)} · {time}
        </span>
        {isVoided && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold"
            style={{
              background: 'var(--v3-surface-2, #F1F5FB)',
              color: 'var(--v3-text-muted)',
            }}
          >
            {t('payment.void.dialog.voidedTag')}
          </span>
        )}
      </span>
      <span
        className={`shrink-0 text-[13px] font-extrabold tabular-nums ${isVoided ? 'line-through' : ''}`}
        style={{ color: 'var(--v3-text-primary)' }}
      >
        {formatMoney(payment.amount_cents)}
      </span>
    </button>
  );
}
