import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, Check, CreditCard, Loader2 } from 'lucide-react';
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
  useCloseOrderAsPaid,
  useCreatePayment,
  useSplitState,
  type PaymentOperation,
  type PaymentType,
} from '../api';

/**
 * QuickPaymentModal — ADR-014 §1 (Hızlı Öde 4-operation).
 *
 * Layout v3 paritesi (ekran 1):
 *   - Header: "Hızlı Öde" + "Tek hamlede ödeme al"
 *   - Büyük tutar bloğu: ÖDENECEK TOPLAM + ₺xxx,xx (40-50px)
 *   - İŞLEM TİPİ SEÇİMİ 2x2 radio grid (default 'pay_and_print_close' — S104)
 *   - 2 büyük buton (Nakit / Kredi Kartı) — tıkla → POST /payments
 *
 * State machine (ADR-014 §9 Karar 9.5 — her zaman tam tutar):
 *   amount = order.total - SUM(existing payments) → kalan tam tutar
 */
interface QuickPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  /** Order.total_cents — kalan tutar split-state'ten hesaplanır. */
  amountCents: number;
  /** ADR-014 §10 Karar 10.6 — Mod B "Masayı Kapat" buton label. */
  hasTable?: boolean;
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

/**
 * Varsayılan işlem tipi — S104 (ürün sahibi): "öde, yazdır ve kapat".
 *
 * Önceden `'pay'` (yalnız tahsil, masa açık kalır) seçiliydi; kasadaki baskın
 * akış ise tam tutarı al → fişi ver → masayı kapat. Varsayılanın en sık
 * yapılan işi göstermesi tuş sayısını düşürür ve "fiş basılmadı / masa açık
 * kaldı" hatalarını azaltır. Mobil zaten `pay_and_print_close` gönderiyor
 * (ADR-014 Amd2) → web onunla hizalandı.
 *
 * `hasTable=false` (paket) durumunda da geçerli: aynı işlem masa yerine
 * SİPARİŞİ kapatır, yalnız etiket değişir.
 */
const DEFAULT_OPERATION: PaymentOperation = 'pay_and_print_close';

export function QuickPaymentModal({
  open,
  onOpenChange,
  orderId,
  amountCents,
  hasTable = true,
  onSuccess,
}: QuickPaymentModalProps) {
  const { t } = useTranslation();
  const [operation, setOperation] = useState<PaymentOperation>(DEFAULT_OPERATION);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    crypto.randomUUID(),
  );
  // W9-HCI-02 (pos-checklist §hata-önleme): >1000₺ tek-tık tahsilatta yanlışlıkla
  // büyük tutar alınmasın → önce ikinci "Onayla" adımı. Bu paymentType "armed".
  const [pendingConfirm, setPendingConfirm] = useState<PaymentType | null>(null);
  // "Onayla" butonu panel açıldıktan ~400ms sonra aktifleşir — düğmeye acele
  // çift-dokunuşun (rush-hour) Onayla'ya düşüp onayı ıskalamasını DETERMİNİSTİK
  // engeller (layout-yüksekliği tesadüfüne dayanmaz; hci gate).
  const [confirmArmed, setConfirmArmed] = useState(false);

  useEffect(() => {
    if (open) {
      setIdempotencyKey(crypto.randomUUID());
      setOperation(DEFAULT_OPERATION);
      setPendingConfirm(null);
    }
  }, [open]);

  useEffect(() => {
    if (pendingConfirm === null) {
      setConfirmArmed(false);
      return;
    }
    setConfirmArmed(false);
    const timer = setTimeout(() => setConfirmArmed(true), 400);
    return () => clearTimeout(timer);
  }, [pendingConfirm]);

  // ADR-014 §10 Karar 10.2 — Hızlı Öde'de gerçek "kalan" tutar split-state'ten;
  // amountCents prop fallback (split-state yüklenmediyse).
  const splitStateQuery = useSplitState(open ? orderId : null);
  const remainingCents =
    splitStateQuery.data?.totals.remaining_total_cents ?? amountCents;
  const isFullyPaid = remainingCents <= 0;
  // 1000₺ (kuruş) — üstünde tek-tık tahsilat ikinci onay ister (W9-HCI-02).
  const requiresConfirm = remainingCents > 100_000;
  // Onay panelinde seçili işlemi (Öde / Öde & Kapat …) restate etmek için.
  const selectedOp = OPERATIONS.find((op) => op.key === operation);

  const createPayment = useCreatePayment();
  const closeAsPaid = useCloseOrderAsPaid();
  const isProcessing = createPayment.isPending || closeAsPaid.isPending;

  // Mod B (isFullyPaid) — PATCH /orders/:id { status: 'paid' }
  const handleCloseAsPaid = async () => {
    if (orderId === null) return;
    try {
      await closeAsPaid.mutateAsync({ orderId });
      toast.success(
        hasTable
          ? t('payment.quick.tableClosedSuccess')
          : t('payment.quick.orderClosedSuccess'),
      );
      onSuccess?.(true);
      onOpenChange(false);
    } catch (err) {
      const code = isAxiosError(err)
        ? (err.response?.data as { error?: { code?: string } } | undefined)
            ?.error?.code
        : null;
      const localized = code
        ? t(`payment.errors.${code}`, { defaultValue: '' })
        : '';
      toast.error(
        localized !== '' ? localized : t('payment.quick.closeError'),
      );
    }
  };

  // Gerçek tahsilat (küçük tutarda doğrudan, büyük tutarda onay sonrası).
  const doCharge = async (paymentType: PaymentType) => {
    if (orderId === null || remainingCents <= 0) return;
    try {
      const result = await createPayment.mutateAsync({
        orderId,
        paymentType,
        paymentScope: 'full',
        amountCents: remainingCents, // ADR-014 §9.5 — kalan tam tutar
        idempotencyKey,
        operation,
        // v3 paritesi: Hızlı Öde nakit modunda cash_received = amount (otomatik)
        ...(paymentType === 'cash' ? { cashReceivedCents: remainingCents } : {}),
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
      setPendingConfirm(null); // hata → onay panelinden butonlara dön (retry)
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

  // Buton tıklama: küçük tutar → doğrudan tahsil; büyük tutar → onay adımını arm et.
  const handlePay = (paymentType: PaymentType) => {
    if (orderId === null || remainingCents <= 0) return;
    if (requiresConfirm) {
      setPendingConfirm(paymentType);
      return;
    }
    void doCharge(paymentType);
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
            {formatMoney(remainingCents)}
          </div>
        </div>

        {/* ADR-014 §10 Karar 10.6 — Mod B: sipariş tamamen ödenmiş */}
        {isFullyPaid ? (
          <button
            type="button"
            data-testid="quick-pay-close-table"
            onClick={() => void handleCloseAsPaid()}
            disabled={isProcessing}
            className="mt-3 inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-extrabold text-white disabled:opacity-60"
            style={{ background: 'var(--v3-purple, #7C5CFA)' }}
          >
            {closeAsPaid.isPending ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Check size={20} />
            )}
            {hasTable
              ? t('payment.quick.closeTable')
              : t('payment.quick.closeOrder')}
          </button>
        ) : pendingConfirm !== null ? (
          /* W9-HCI-02 — büyük tutar (>1000₺) ikinci onay adımı */
          <div className="mt-3 space-y-3">
            <div
              className="rounded-xl border-2 p-4 text-center"
              style={{
                borderColor: 'var(--v3-warning, #F59E0B)',
                background: 'var(--v3-warning-bg, #FFF7ED)',
              }}
            >
              <div
                className="text-[13px] font-bold"
                style={{ color: 'var(--v3-text-primary)' }}
              >
                {t('payment.quick.confirmLargeTitle')}
              </div>
              <div
                className="mt-1 text-sm"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('payment.quick.confirmLargeBody', {
                  method: t(
                    pendingConfirm === 'cash'
                      ? 'payment.type.cash'
                      : 'payment.type.card',
                  ),
                  amount: formatMoney(remainingCents),
                })}
              </div>
              {selectedOp && operation !== 'pay' && (
                <div
                  className="mt-1 text-[13px] font-semibold"
                  style={{ color: 'var(--v3-text-primary)' }}
                >
                  {t(selectedOp.i18nKey)}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                disabled={isProcessing}
                className="flex h-14 items-center justify-center rounded-xl border-2 text-[14px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  borderColor: 'var(--v3-border-subtle)',
                  background: '#fff',
                  color: 'var(--v3-text-primary)',
                }}
              >
                {t('payment.quick.confirmCancel')}
              </button>
              <button
                type="button"
                data-testid="quick-pay-confirm-large"
                onClick={() => {
                  if (pendingConfirm) void doCharge(pendingConfirm);
                }}
                disabled={isProcessing || !confirmArmed}
                className="flex h-14 items-center justify-center gap-2 rounded-xl text-[14px] font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: 'var(--v3-purple, #7C5CFA)' }}
              >
                {isProcessing ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Check size={20} />
                )}
                {t('payment.quick.confirmLargeConfirm')}
              </button>
            </div>
          </div>
        ) : (
        <>
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
            disabled={isProcessing || remainingCents <= 0}
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
            disabled={isProcessing || remainingCents <= 0}
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
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
