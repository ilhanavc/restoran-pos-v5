import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import type { ApiOrderItem } from '../api';

interface VoidItemConfirmDialogProps {
  /** null = kapalı; ApiOrderItem = açık + hedef satır. */
  target: ApiOrderItem | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  isVoiding: boolean;
}

/**
 * Persisted kalem void (soft cancel) onayı — ADR-013 §6 v3 paritesi.
 *
 * Mutfağa gönderilmiş kalemi (`status !== 'new'`) kasiyer/admin iptal eder;
 * yeni kalem (`status='new'`) tüm staff iptal edebilir. RBAC backend'de
 * (handler 403 dönerse toast).
 *
 * "kalıcı silinir" değil — soft cancel; status='cancelled' set edilir,
 * audit korunur, raporlama Phase 3'te bu satırları "iptal edilmiş" olarak
 * gösterir.
 */
export function VoidItemConfirmDialog({
  target,
  onOpenChange,
  onConfirm,
  isVoiding,
}: VoidItemConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(v) => !isVoiding && onOpenChange(v)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('order.adisyon.voidDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('order.adisyon.voidDialog.body', {
              name: target?.product_name ?? '',
              qty: target?.quantity ?? 0,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isVoiding}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isVoiding}
            style={{ background: 'var(--v3-danger, #dc2626)', color: '#fff' }}
          >
            {t('order.adisyon.voidDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
