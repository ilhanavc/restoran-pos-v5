import { Banknote, CreditCard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import type { PlannedPaymentType } from '../api';

interface PaymentMethodModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sadece 'cash' | 'card' (transfer MVP'de yok). */
  onSelect: (method: 'cash' | 'card') => void;
  /** Mutation in-flight — butonları kilitle. */
  isSubmitting?: boolean;
}

/**
 * Paket sipariş ödeme tipi seçim modalı (ADR-017 §Frontend, ekran 4).
 *
 * - 2 büyük yan yana kart: Nakit + Kredi Kartı.
 * - Tıklanınca onSelect('cash'|'card') → caller siparişi POST eder.
 * - Esc / overlay click / Vazgeç butonu kapatır.
 *
 * Notlar:
 * - 'transfer' PlannedPaymentType backend'de tanımlı ama bu MVP modalında
 *   gösterilmiyor (admin paneli backlog).
 * - Tıklama sonrası modal'ı kapatma sorumluluğu caller'da: hata durumunda
 *   açık kalmalı.
 */
export function PaymentMethodModal({
  open,
  onOpenChange,
  onSelect,
  isSubmitting = false,
}: PaymentMethodModalProps) {
  const { t } = useTranslation();

  const choose = (method: PlannedPaymentType & ('cash' | 'card')) => {
    if (isSubmitting) return;
    onSelect(method);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl p-0"
        aria-modal="true"
        role="dialog"
      >
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-[18px] font-bold">
            {t('takeaway.payment.modalTitle')}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {t('takeaway.payment.modalDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 px-6 pb-2 pt-2">
          <button
            type="button"
            onClick={() => choose('cash')}
            disabled={isSubmitting}
            className="flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-xl border-2 bg-white p-6 transition-all duration-[120ms] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-primary)',
            }}
          >
            <Banknote
              className="h-10 w-10"
              strokeWidth={1.75}
              style={{ color: 'var(--v3-success, #16a34a)' }}
            />
            <span className="text-[15px] font-bold">
              {t('takeaway.payment.cash')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => choose('card')}
            disabled={isSubmitting}
            className="flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-xl border-2 bg-white p-6 transition-all duration-[120ms] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-primary)',
            }}
          >
            <CreditCard
              className="h-10 w-10"
              strokeWidth={1.75}
              style={{ color: 'var(--v3-purple, #7c3aed)' }}
            />
            <span className="text-[15px] font-bold">
              {t('takeaway.payment.card')}
            </span>
          </button>
        </div>

        <div className="flex items-center justify-end border-t px-6 py-3">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('takeaway.payment.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
