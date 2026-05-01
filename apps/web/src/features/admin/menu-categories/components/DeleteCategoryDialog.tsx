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

interface DeleteCategoryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categoryName: string;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

/**
 * Kategori silme onayı — Sprint 8c PR-D2.
 *
 * Backend cascade YAPMAZ (ADR-003 §8.6 Amendment 2026-04-28b Seçenek A): aktif
 * ürünlü kategori 409 MENU_CATEGORY_HAS_PRODUCTS döner. Hata mesajı toast'a
 * çağıran sayfada (MenuDefinitionsPage.handleDelete) extractError ile yansır.
 */
export function DeleteCategoryDialog({
  open,
  onOpenChange,
  categoryName,
  onConfirm,
  isDeleting,
}: DeleteCategoryDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !isDeleting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('admin.menuDefinitions.deleteDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('admin.menuDefinitions.deleteDialog.body', { name: categoryName })}
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
            style={{ background: 'var(--v3-danger, #dc2626)', color: '#fff' }}
          >
            {t('admin.menuDefinitions.deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
