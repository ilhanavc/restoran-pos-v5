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

interface DeleteGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

/**
 * Özellik grubu silme onayı — Sprint 8c PR-F2b.
 * DiningAreas.DeleteAreaDialog pattern'i. Backend cascade option'ları siler.
 */
export function DeleteGroupDialog({
  open,
  onOpenChange,
  groupName,
  onConfirm,
  isDeleting,
}: DeleteGroupDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !isDeleting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('admin.attributeGroups.deleteDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('admin.attributeGroups.deleteDialog.message', { name: groupName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {t('admin.attributeGroups.cancelButton')}
          </Button>
          <Button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
            style={{ background: 'var(--v3-danger, #dc2626)', color: '#fff' }}
          >
            {t('admin.attributeGroups.deleteButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
