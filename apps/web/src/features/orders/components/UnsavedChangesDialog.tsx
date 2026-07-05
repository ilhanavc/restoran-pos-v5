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

interface UnsavedChangesDialogProps {
  /** true = açık (kaydedilmemiş ürün var, çıkış onayı bekleniyor). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Onaylanırsa ekrandan çıkılır (kaydedilmemiş sepet atılır). */
  onConfirm: () => void;
}

/**
 * Kaydedilmemiş sepet çıkış onayı — sipariş ekranından geri/kapat aksiyonunda
 * `cart.isDirty` ise gösterilir (chip task_341abb30). Kazara ✕ dokunuşunda
 * pending kalemlerin sessizce kaybını önler. Ödeme/kayıt sonrası otomatik
 * navigasyon bu guard'dan geçmez — yalnız explicit geri/kapat aksiyonları korunur.
 */
export function UnsavedChangesDialog({
  open,
  onOpenChange,
  onConfirm,
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('order.adisyon.unsavedDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('order.adisyon.unsavedDialog.body')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('order.adisyon.unsavedDialog.cancel')}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            style={{ background: 'var(--v3-danger, #dc2626)', color: '#fff' }}
          >
            {t('order.adisyon.unsavedDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
