import type { OrderCancelReason } from '@restoran-pos/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '../../api/errors';
import { Toast } from '../../components/Toast';
import type { TableActionKind } from '../orders/actions';
import { useActiveOrderForTable } from '../orders/queries';
import { CancelOrderSheet } from '../orders/components/CancelOrderSheet';
import { TableActionSheet } from '../orders/components/TableActionSheet';
import { MergeTableSheet } from '../tables/MergeTableSheet';
import { MoveTableSheet } from '../tables/MoveTableSheet';
import { QuickPaySheet } from './QuickPaySheet';
import { useCancelOrder, usePrintBill } from './queries';

/** The table whose 3-dot menu is open (null → closed). */
export interface TableActionTarget {
  orderId: string;
  tableLabel: string;
  /** Source table id — the move-table picker excludes it + filters its area. */
  tableId: string;
}

interface TableActionsControllerProps {
  target: TableActionTarget | null;
  /** Clear the target (close the whole flow). */
  onClose: () => void;
  /** After a successful quick payment (order closed) — e.g. Order screen goes back. */
  onPaid: () => void;
}

interface ToastState {
  message: string;
  tone: 'success' | 'error';
}

/**
 * Masa 3-nokta akış denetleyicisi (ADR-027 Faz A).
 *
 * Hem Masalar hem Order ekranı bunu render eder; `target` ile kontrol edilir.
 * Aksiyon sheet'i (menü) → Hızlı Öde alt-sheet'i (ödeme) arasındaki tek-modal
 * geçişi burada yönetilir (aynı anda tek Modal görünür — RN modal-üstü-modal
 * kaçınması). Yazdır fire-and-forget (sheet kapanır, sonuç toast'ta). Toast
 * `target` temizlense de kalır (baskı sonucu gecikmeli gelebilir).
 */
export function TableActionsController({
  target,
  onClose,
  onPaid,
}: TableActionsControllerProps): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const printMutation = usePrintBill();
  const cancelMutation = useCancelOrder();
  // Sheet kapalıyken (target null) sorgu da kapalı — boşa istek yok.
  const activeOrderQuery = useActiveOrderForTable(target?.tableId ?? null);
  const [step, setStep] = useState<
    'menu' | 'quickPay' | 'moveTable' | 'mergeTable' | 'cancelOrder'
  >('menu');
  const [toast, setToast] = useState<ToastState | null>(null);

  // New target (or closed) always starts at the menu.
  useEffect(() => {
    setStep('menu');
  }, [target?.orderId]);

  function handleSelect(action: TableActionKind): void {
    if (target === null) {
      return;
    }
    if (action === 'quickPay') {
      setStep('quickPay');
      return;
    }
    if (action === 'moveTable') {
      setStep('moveTable');
      return;
    }
    if (action === 'mergeTable') {
      setStep('mergeTable');
      return;
    }
    if (action === 'cancelOrder') {
      setStep('cancelOrder');
      return;
    }
    // printBill — enqueue and close the sheet; report the result via toast.
    const orderId = target.orderId;
    onClose();
    printMutation.mutate(orderId, {
      onSuccess: () =>
        setToast({ message: t('order.print.sent'), tone: 'success' }),
      onError: () =>
        setToast({ message: t('order.print.error'), tone: 'error' }),
    });
  }

  // İptal onay ekranı "ne kaybediyorsun" bilgisini gösterir: kaç kalem ve
  // kaçı mutfağa gitti (gitmişse ürün çöpe gider — ayrı uyarı).
  const items = activeOrderQuery.data?.items ?? [];
  const cancelItemCount = items.length;
  const cancelSentItemCount = items.filter(
    (item) => item.status !== 'new' && item.status !== 'cancelled',
  ).length;

  function handleCancelConfirmed(reason: OrderCancelReason): void {
    if (target === null) return;
    cancelMutation.mutate(
      { orderId: target.orderId, reason },
      {
        onSuccess: async () => {
          setToast({ message: t('order.cancelOrder.success'), tone: 'success' });
          onClose();
          // Masa boşaldı → tahta + bu masanın aktif siparişi tazelenir.
          await queryClient.invalidateQueries({ queryKey: ['tables'] });
          await queryClient.invalidateQueries({
            queryKey: ['orders', 'by-table', target.tableId, 'active'],
          });
          // Order ekranı açıksa geri gider (masa artık boş) — mergeTable emsali.
          onPaid();
        },
        onError: (err: Error) => {
          // Sunucu REDDİN SEBEBİNİ ayırt ediyor; garsona anlamlı mesaj gösterilir
          // ("işlem yapılamadı" yerine "bu adisyonun ödemesi alınmış").
          const code = isApiError(err) ? err.code : null;
          const message =
            code === 'ORDER_HAS_PAYMENTS'
              ? t('order.cancelOrder.errorHasPayments')
              : code === 'ORDER_CANCEL_NOT_ALLOWED'
                ? t('order.cancelOrder.errorNotAllowed')
                : t('order.cancelOrder.error');
          setToast({ message, tone: 'error' });
        },
      },
    );
  }

  function handlePaid(): void {
    setToast({ message: t('payment.result.paidClosed'), tone: 'success' });
    onClose();
    onPaid();
  }

  // Masa taşındı: sheet kapanır, sonuç toast'ta (query invalidation tahtayı
  // tazeler). onPaid ÇAĞRILMAZ — sipariş kapanmadı, sadece masası değişti;
  // Order ekranı geri gitmez, masa hâlâ dolu.
  function handleMoved(): void {
    setToast({ message: t('tables.move.success'), tone: 'success' });
    onClose();
  }

  // Adisyon aktarıldı: kaynak sipariş `merged` kapandı, kaynak masa boşaldı
  // (ADR-029 K4). onPaid ÇAĞRILIR — kaynak Order ekranı açıksa geri gitmeli
  // (masa artık boş); QuickPay'in kapanış davranışıyla aynı.
  function handleMerged(): void {
    setToast({ message: t('tables.merge.success'), tone: 'success' });
    onClose();
    onPaid();
  }

  return (
    <>
      {target !== null ? (
        <>
          <TableActionSheet
            visible={step === 'menu'}
            onClose={onClose}
            tableLabel={target.tableLabel}
            orderId={target.orderId}
            onSelect={handleSelect}
          />
          <QuickPaySheet
            visible={step === 'quickPay'}
            onClose={onClose}
            tableLabel={target.tableLabel}
            orderId={target.orderId}
            onPaid={handlePaid}
          />
          <MoveTableSheet
            visible={step === 'moveTable'}
            onClose={onClose}
            sourceTableId={target.tableId}
            sourceTableLabel={target.tableLabel}
            orderId={target.orderId}
            onMoved={handleMoved}
          />
          <MergeTableSheet
            visible={step === 'mergeTable'}
            onClose={onClose}
            sourceTableId={target.tableId}
            sourceTableLabel={target.tableLabel}
            orderId={target.orderId}
            onMerged={handleMerged}
          />
          <CancelOrderSheet
            visible={step === 'cancelOrder'}
            tableLabel={target.tableLabel}
            itemCount={cancelItemCount}
            sentItemCount={cancelSentItemCount}
            submitting={cancelMutation.isPending}
            onCancel={onClose}
            onConfirm={handleCancelConfirmed}
          />
        </>
      ) : null}
      <Toast
        message={toast?.message ?? null}
        tone={toast?.tone}
        onDismiss={() => setToast(null)}
      />
    </>
  );
}
