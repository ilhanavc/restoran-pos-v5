import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  CreditCard,
  Loader2,
  Printer,
  Undo2,
  XCircle,
  Zap,
} from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { useCancelOrder } from '../api';

/**
 * TableActionsModal — ADR-014 §3 + §9 Karar 9.6.
 *
 * Dolu masa kart 3-nokta (⋮) menü.
 * 4 aksiyon (Öde / Hızlı Öde / Masayı Taşı / Yazdır) +
 * 1 iptal (Siparişi İptal Et — kırmızı, gerçek cancel).
 *
 * Onay dialog: "Bu siparişi iptal etmek istediğinizden emin misiniz? Geri alınamaz."
 */
interface TableActionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableCode: string;
  orderId: string | null;
  onPay: () => void;
  onQuickPay: () => void;
  /** ADR-028 Karar H — "Masayı Değiştir": aktif siparişi boş masaya taşı. */
  onMoveTable: () => void;
  onPrint: () => void;
  /** Siparişi iptal başarılı olduğunda — masa listesi invalidate. */
  onCancelled?: () => void;
}

export function TableActionsModal({
  open,
  onOpenChange,
  tableCode,
  orderId,
  onPay,
  onQuickPay,
  onMoveTable,
  onPrint,
  onCancelled,
}: TableActionsModalProps) {
  const { t } = useTranslation();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelOrder = useCancelOrder();

  const handleCancelConfirm = async () => {
    if (orderId === null) return;
    try {
      await cancelOrder.mutateAsync({ orderId });
      toast.success(t('payment.tableActions.cancelSuccess'));
      onCancelled?.();
      setConfirmCancel(false);
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
        localized !== '' ? localized : t('payment.tableActions.cancelError'),
      );
    }
  };

  return (
    <>
      <Dialog open={open && !confirmCancel} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('payment.tableActions.title', { code: tableCode })}
            </DialogTitle>
            <DialogDescription>
              {t('payment.tableActions.subtitle')}
            </DialogDescription>
          </DialogHeader>

          {/* Üst — Öde primary full-width */}
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onPay();
            }}
            className="flex h-16 w-full items-center justify-center gap-2 rounded-xl border-2"
            style={{
              borderColor: 'var(--v3-purple, #7C5CFA)',
              background: 'var(--v3-purple-bg, #EEEAFE)',
              color: 'var(--v3-purple, #7C5CFA)',
            }}
          >
            <CreditCard size={20} />
            <span className="text-[15px] font-bold">
              {t('payment.tableActions.pay')}
            </span>
          </button>

          {/* Orta — 3 outline buton */}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <ActionTile
              icon={<Zap size={20} />}
              label={t('payment.tableActions.quickPay')}
              testId="table-actions-quick-pay"
              onClick={() => {
                onOpenChange(false);
                onQuickPay();
              }}
            />
            <ActionTile
              icon={<ArrowLeftRight size={20} />}
              label={t('tables.move.action')}
              testId="table-actions-move"
              onClick={() => {
                onOpenChange(false);
                onMoveTable();
              }}
            />
            <ActionTile
              icon={<Printer size={20} />}
              label={t('payment.tableActions.print')}
              onClick={() => {
                onOpenChange(false);
                onPrint();
              }}
            />
          </div>

          {/* Alt — Siparişi İptal Et (kırmızı outline, gerçek cancel) */}
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2"
            style={{
              borderColor: 'var(--v3-danger, #D64545)',
              background: 'var(--v3-danger-soft, rgba(214, 69, 69, 0.14))',
              color: 'var(--v3-danger, #D64545)',
            }}
          >
            <XCircle size={18} />
            <span className="text-[14px] font-bold">
              {t('payment.tableActions.cancelOrder')}
            </span>
          </button>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog */}
      <Dialog
        open={confirmCancel}
        onOpenChange={(v) => !cancelOrder.isPending && setConfirmCancel(v)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('payment.tableActions.cancelConfirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('payment.tableActions.cancelConfirmBody', {
                code: tableCode,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmCancel(false)}
              disabled={cancelOrder.isPending}
            >
              <Undo2 size={14} />
              {t('payment.tableActions.cancelConfirmAbort')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleCancelConfirm()}
              disabled={cancelOrder.isPending}
              style={{
                background: 'var(--v3-danger, #D64545)',
                color: '#fff',
              }}
            >
              {cancelOrder.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <XCircle size={14} />
              )}
              {t('payment.tableActions.cancelConfirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActionTile({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-xl border transition-colors"
      style={{
        borderColor: 'var(--v3-border-subtle)',
        background: '#fff',
        color: 'var(--v3-purple, #7C5CFA)',
      }}
    >
      {icon}
      <span
        className="text-[12px] font-semibold"
        style={{ color: 'var(--v3-text-primary)' }}
      >
        {label}
      </span>
    </button>
  );
}
