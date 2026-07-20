import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  CreditCard,
  GitMerge,
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
import {
  OrderCancelReasonSchema,
  type OrderCancelReason,
} from '@restoran-pos/shared-types';

import { useCancelOrder } from '../api';

/**
 * K7 — sebepler ŞEMADAN türetilir (mobil `CancelOrderSheet` ile aynı kaynak).
 * Elle kopyalanırsa web'de seçilebilen bir sebep sunucuda 400 alabilir.
 */
const CANCEL_REASONS: readonly OrderCancelReason[] =
  OrderCancelReasonSchema.options;

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
  /** ADR-029 Karar H — "Adisyon Aktar": aktif siparişi başka dolu masaya birleştir. */
  onMergeTable: () => void;
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
  onMergeTable,
  onPrint,
  onCancelled,
}: TableActionsModalProps) {
  const { t } = useTranslation();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState<OrderCancelReason | null>(
    null,
  );
  const cancelOrder = useCancelOrder();

  const handleCancelConfirm = async () => {
    if (orderId === null) return;
    try {
      if (cancelReason === null) return; // buton zaten pasif; savunma amaçlı
      await cancelOrder.mutateAsync({ orderId, reason: cancelReason });
      setCancelReason(null);
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
            className="flex h-16 w-full items-center justify-center gap-2 rounded-xl border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
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

          {/* Orta — 4 outline buton (2×2): Hızlı Öde / Masayı Değiştir /
              Adisyon Aktar / Yazdır */}
          <div className="mt-2 grid grid-cols-2 gap-2">
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
              icon={<GitMerge size={20} />}
              label={t('tables.merge.action')}
              testId="table-actions-merge"
              onClick={() => {
                onOpenChange(false);
                onMergeTable();
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
            className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
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
        onOpenChange={(v) => {
          if (cancelOrder.isPending) return;
          setConfirmCancel(v);
          // Kapanışta sebebi SIFIRLA: aksi hâlde bir sonraki iptalde önceki
          // sebep seçili gelir ve kullanıcı fark etmeden YANLIŞ sebep denetim
          // kaydına yazılır. Mobil `CancelOrderSheet` de her açılışta sıfırlar.
          if (!v) setCancelReason(null);
        }}
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

          {/* ADR-027 Amd2 K7 — sebep ZORUNLU, mobil ile aynı 5 seçenek.
              Seçilene kadar "İptal Et" pasif: boş bir "emin misiniz?" yerine
              kasıt kanıtı üreten bir adım (audit'e enum kodu yazılır). */}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold text-muted-foreground">
              {t('payment.tableActions.cancelReasonLabel')}
            </legend>
            {CANCEL_REASONS.map((code) => (
              <label
                key={code}
                className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm"
                style={
                  cancelReason === code
                    ? {
                        borderColor: 'var(--v3-danger, #D64545)',
                        background: 'rgba(214,69,69,0.06)',
                      }
                    : undefined
                }
              >
                <input
                  type="radio"
                  name="cancel-reason"
                  value={code}
                  checked={cancelReason === code}
                  onChange={() => setCancelReason(code)}
                  disabled={cancelOrder.isPending}
                />
                {t(`payment.tableActions.cancelReason.${code}`)}
              </label>
            ))}
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmCancel(false);
                setCancelReason(null);
              }}
              disabled={cancelOrder.isPending}
            >
              <Undo2 size={14} />
              {t('payment.tableActions.cancelConfirmAbort')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleCancelConfirm()}
              disabled={cancelOrder.isPending || cancelReason === null}
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
      className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
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
