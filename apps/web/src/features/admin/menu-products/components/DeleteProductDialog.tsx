import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';

interface DeleteProductDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productName: string;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

/**
 * Ürün silme onayı — S138.
 *
 * ⚠️ NEDEN VAR: ürün silme, uygulamadaki **tek** yıkıcı aksiyondu ki tarayıcının
 * çıplak `window.confirm`'ünü kullanıyordu (`ProductEditorPage.tsx`). Diğer beş
 * silme işlemi (kategori, bölge, kullanıcı, özellik grubu, müşteri toplu) özel
 * Dialog kullanıyor. Çıplak `confirm` POS dokunmatik ekranında uygulamanın
 * stiline yabancı, dokunma hedefi kontrol edilemiyor, `destructive` görsel
 * işaretlemesi ve odak yönetimi uygulamanın desenine uymuyordu
 * (`docs/hci/pos-checklist.md` ölçütleri uygulanamıyordu).
 *
 * Bu bileşen `menu-categories/components/DeleteCategoryDialog.tsx`'in birebir
 * kardeşidir — yeni bir görsel dil İCAT EDİLMEDİ, mevcut desen izlendi.
 *
 * Backend ürünü **soft delete** eder (`deleted_at`) ve varyantları da soft
 * siler; sipariş kalemleri snapshot tuttuğu için geçmiş etkilenmez — gövde
 * metni bu güvenceyi ("Sipariş geçmişi etkilenmez") kullanıcıya söyler.
 */
export function DeleteProductDialog({
  open,
  onOpenChange,
  productName,
  onConfirm,
  isDeleting,
}: DeleteProductDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !isDeleting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('admin.menuDefinitions.products.deleteProduct')}
          </DialogTitle>
          <DialogDescription>
            {t('admin.menuDefinitions.products.deleteConfirm', {
              name: productName,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {t('admin.menuDefinitions.drawer.cancelButton')}
          </Button>
          <Button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
            data-testid="confirm-delete-product"
            style={{ background: 'var(--v3-danger, #dc2626)', color: '#fff' }}
          >
            {t('admin.menuDefinitions.deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
