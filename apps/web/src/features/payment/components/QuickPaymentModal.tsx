import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, CreditCard, Loader2 } from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { formatMoney } from '@restoran-pos/shared-domain';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import {
  useCreatePayment,
  type PaymentOperation,
  type PaymentType,
} from '../api';

/**
 * QuickPaymentModal — ADR-014 §1 (Hızlı Öde 4-operation).
 *
 * Layout v3 paritesi (ekran 1):
 *   - Header: "Hızlı Öde" + "Tek hamlede ödeme al"
 *   - Büyük tutar bloğu: ÖDENECEK TOPLAM + ₺xxx,xx (40-50px)
 *   - İŞLEM TİPİ SEÇİMİ 2x2 radio grid (default 'pay')
 *   - 2 büyük buton (Nakit / Kredi Kartı) — tıkla → POST /payments
 *
 * State machine (ADR-014 §9 Karar 9.5 — her zaman tam tutar):
 *   amount = order.total - SUM(existing payments) → kalan tam tutar
 */
interface QuickPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  amountCents: number;
  onSuccess?: (closed: boolean) => void;
}

const OPERATIONS: ReadonlyArray<{
  key: PaymentOperation;
  i18nKey: string;
  i18nDescKey: string;
}> = [
  { key: 'pay', i18nKey: 'payment.quick.opPay', i18nDescKey: 'payment.quick.opPayDesc' },
  {
    key: 'pay_and_close',
    i18nKey: 'payment.quick.opPayClose',
    i18nDescKey: 'payment.quick.opPayCloseDesc',
  },
  {
    key: 'pay_and_print',
    i18nKey: 'payment.quick.opPayPrint',
    i18nDescKey: 'payment.quick.opPayPrintDesc',
  },
  {
    key: 'pay_and_print_close',
    i18nKey: 'payment.quick.opAll',
    i18nDescKey: 'payment.quick.opAllDesc',
  },
];

export function QuickPaymentModal({
  open,
  onOpenChange,
  orderId,
  amountCents,
  onSuccess,
}: QuickPaymentModalProps) {
  const { t } = useTranslation();
  const [operation, setOperation] = useState<PaymentOperation>('pay');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    crypto.randomUUID(),
  );

  // Modal her açılışta yeni key + default operation
  useEffect(() => {
    if (open) {
      setIdempotencyKey(crypto.randomUUID());
      setOperation('pay');
    }
  }, [open]);

  const createPayment = useCreatePayment();
  const isProcessing = createPayment.isPending;

  const handlePay = async (paymentType: PaymentType) => {
    if (orderId === null || amountCents <= 0) return;
    try {
      const result = await createPayment.mutateAsync({
        orderId,
        paymentType,
        paymentScope: 'full',
        amountCents,
        idempotencyKey,
        operation,
      });
      toast.success(
        result.replay
          ? t('payment.replayDetected')
          : t('payment.paymentSuccess'),
      );
      const closed =
        operation === 'pay_and_close' ||
        operation === 'pay_and_print_close';
      onSuccess?.(closed);
      onOpenChange(false);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data as { error?: { code?: string } } | undefined)
            ?.error?.code
        : null;
      const localized = message
        ? t(`payment.errors.${message}`, { defaultValue: '' })
        : '';
      toast.error(
        localized !== '' ? localized : t('payment.paymentError'),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !isProcessing && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('payment.quick.title')}</DialogTitle>
          <DialogDescription>{t('payment.quick.subtitle')}</DialogDescription>
        </DialogHeader>

        {/* Büyük tutar bloğu */}
        <div
          className="rounded-2xl p-6 text-center"
          style={{ background: 'var(--v3-purple-bg, #EEEAFE)' }}
        >
          <div
            className="mb-1 text-[11px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {t('payment.quick.amountLabel')}
          </div>
          <div
            className="text-[36px] font-extrabold tabular-nums"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {formatMoney(amountCents)}
          </div>
        </div>

        {/* 4-op grid */}
        <div className="mt-2">
          <div
            className="mb-2 text-[11px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {t('payment.quick.operationTitle')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {OPERATIONS.map((op) => {
              const active = operation === op.key;
              return (
                <button
                  key={op.key}
                  type="button"
                  onClick={() => setOperation(op.key)}
                  className="flex items-start gap-2 rounded-lg border-2 p-3 text-left transition-colors"
                  style={{
                    borderColor: active
                      ? 'var(--v3-purple, #7C5CFA)'
                      : 'var(--v3-border-subtle)',
                    background: active ? 'var(--v3-purple-bg, #EEEAFE)' : '#fff',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[13px] font-bold"
                      style={{ color: 'var(--v3-text-primary)' }}
                    >
                      {t(op.i18nKey)}
                    </div>
                    <div
                      className="mt-0.5 text-[11px]"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {t(op.i18nDescKey)}
                    </div>
                  </div>
                  <span
                    className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                    style={{
                      border: `2px solid ${active ? 'var(--v3-purple, #7C5CFA)' : 'var(--v3-border-strong)'}`,
                      background: active ? 'var(--v3-purple, #7C5CFA)' : 'transparent',
                    }}
                  >
                    {active && (
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

        {/* 2 büyük buton */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handlePay('cash')}
            disabled={isProcessing || amountCents <= 0}
            className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              background: '#fff',
              color: 'var(--v3-text-primary)',
            }}
          >
            {isProcessing ? (
              <Loader2 size={28} className="animate-spin" />
            ) : (
              <Banknote size={28} />
            )}
            <span className="text-[14px] font-bold">
              {t('payment.type.cash')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handlePay('card')}
            disabled={isProcessing || amountCents <= 0}
            className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              background: '#fff',
              color: 'var(--v3-text-primary)',
            }}
          >
            {isProcessing ? (
              <Loader2 size={28} className="animate-spin" />
            ) : (
              <CreditCard size={28} />
            )}
            <span className="text-[14px] font-bold">
              {t('payment.type.card')}
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
