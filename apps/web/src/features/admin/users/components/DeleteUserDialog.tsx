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

interface DeleteUserDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userLabel: string;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

/**
 * Kullanıcı silme onayı (soft delete). Backend rate-limit 10/dakika/IP.
 * Kendi kullanıcısı + son admin korumaları backend tarafında.
 */
export function DeleteUserDialog({
  open,
  onOpenChange,
  userLabel,
  onConfirm,
  isDeleting,
}: DeleteUserDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !isDeleting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.users.deleteDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('admin.users.deleteDialog.body', { name: userLabel })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
            style={{ background: 'var(--v3-danger, #dc2626)', color: '#fff' }}
          >
            {t('admin.users.deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
