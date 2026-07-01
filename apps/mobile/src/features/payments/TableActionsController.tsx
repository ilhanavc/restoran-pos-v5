import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Toast } from '../../components/Toast';
import type { TableActionKind } from '../orders/actions';
import { TableActionSheet } from '../orders/components/TableActionSheet';
import { QuickPaySheet } from './QuickPaySheet';
import { usePrintBill } from './queries';

/** The table whose 3-dot menu is open (null → closed). */
export interface TableActionTarget {
  orderId: string;
  tableLabel: string;
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
  const printMutation = usePrintBill();
  const [step, setStep] = useState<'menu' | 'quickPay'>('menu');
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

  function handlePaid(): void {
    setToast({ message: t('payment.result.paidClosed'), tone: 'success' });
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
