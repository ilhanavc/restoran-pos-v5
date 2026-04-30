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

interface DeleteAreaDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  areaName: string;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

/**
 * Bölge silme onayı — V3 paritesi (DiningAreasSettingsPage.jsx:147-163).
 * Backend cascade NULL yapar (AreaService.softDelete); aktif masa varsa
 * silmez ama backend hatası yine de toast ile gösterilir.
 */
export function DeleteAreaDialog({ open, onOpenChange, areaName, onConfirm, isDeleting }: DeleteAreaDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !isDeleting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.diningAreas.deleteDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('admin.diningAreas.deleteDialog.body', { name: areaName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {t('admin.diningAreas.cancelButton')}
          </Button>
          <Button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
            style={{ background: 'var(--v3-danger, #dc2626)', color: '#fff' }}
          >
            {t('admin.diningAreas.deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
