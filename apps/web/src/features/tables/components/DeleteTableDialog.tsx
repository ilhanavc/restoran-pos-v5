import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { TableRow } from '@restoran-pos/shared-types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { useDeleteTable } from '../api';
import { getErrorMessage } from '../../../lib/error';

interface DeleteTableDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  table: TableRow | null;
}

export function DeleteTableDialog({ open, onOpenChange, table }: DeleteTableDialogProps) {
  const { t } = useTranslation();
  const mut = useDeleteTable();

  const handleConfirm = () => {
    if (!table) return;
    mut.mutate(table.id, {
      onSuccess: () => {
        toast.success(`${table.label} silindi`);
        onOpenChange(false);
      },
      onError: (err) => toast.error(getErrorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <DialogTitle>{t('tables.delete.title')}</DialogTitle>
              <DialogDescription className="mt-2">
                {table && t('tables.delete.body', { code: table.label })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mut.isPending}
          >
            {t('tables.delete.cancel')}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={mut.isPending}>
            {mut.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('tables.delete.confirm')}
              </>
            ) : (
              t('tables.delete.confirm')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
