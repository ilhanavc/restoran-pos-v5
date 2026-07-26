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

interface LeaveStagedConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Onaylandı — ekrandan çık (bekleyen değişiklikler atılır). */
  onConfirm: () => void;
}

/**
 * Kaydedilmemiş KAYITLI-kalem değişikliğiyle çıkış onayı — ADR-013 Amd4 K9
 * (S105 ürün sahibi revizyonu).
 *
 * Neden yalnız kayıtlı kalemler için: yeni ürün sepeti Kaydet'siz çıkışta
 * sessizce atılır (S84 kararı, kayıp maliyeti düşük — ürün yeniden eklenir).
 * Kayıtlı kalemde ise kullanıcı ya onaydan geçmiş bir SİLME kararı vermiştir ya
 * da mutfağa çoktan gitmiş bir kalemi düzeltmiştir; bunun sessizce kaybolması
 * yoğun saatte fark edilmez ve fiş/tutar yanlış kalır.
 */
export function LeaveStagedConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: LeaveStagedConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('order.adisyon.leaveDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('order.adisyon.leaveDialog.body')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            style={{ minHeight: 48 }}
          >
            {t('order.adisyon.leaveDialog.stay')}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            style={{
              minHeight: 48,
              background: 'var(--v3-danger, #dc2626)',
              color: '#fff',
            }}
          >
            {t('order.adisyon.leaveDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
