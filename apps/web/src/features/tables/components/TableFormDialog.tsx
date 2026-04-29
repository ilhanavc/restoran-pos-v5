import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  TableCreateRequestSchema,
  type TableCreateRequest,
  type TableRow,
} from '@restoran-pos/shared-types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Button } from '../../../components/ui/button';
import { useCreateTable, useUpdateTable } from '../api';
import { getErrorMessage } from '../../../lib/error';

interface TableFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Düzenleme modu için mevcut masa; yoksa create. */
  table?: TableRow | null;
}

interface FormValues {
  code: string;
  capacity: string; // input'tan string gelir, submit'te number'a çevrilir
}

export function TableFormDialog({ open, onOpenChange, table }: TableFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!table;
  const createMut = useCreateTable();
  const updateMut = useUpdateTable();
  const pending = createMut.isPending || updateMut.isPending;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { code: '', capacity: '' },
  });

  // Dialog açıldığında: edit modunda mevcut değerleri yükle, create'te sıfırla
  useEffect(() => {
    if (open) {
      reset({
        code: table?.label ?? '',
        capacity: table?.capacity?.toString() ?? '',
      });
    }
  }, [open, table, reset]);

  const onSubmit = handleSubmit((values) => {
    const capacityNum = values.capacity.trim() === '' ? null : Number(values.capacity);
    if (capacityNum !== null && (Number.isNaN(capacityNum) || capacityNum <= 0)) {
      toast.error('Kapasite pozitif sayı olmalıdır');
      return;
    }

    if (isEdit && table) {
      const patch = {
        ...(values.code.trim() !== table.label && { code: values.code.trim() }),
        ...(capacityNum !== table.capacity && { capacity: capacityNum }),
      };
      // En az bir alan değişmiş olmalı
      if (Object.keys(patch).length === 0) {
        onOpenChange(false);
        return;
      }
      updateMut.mutate(
        { id: table.id, patch },
        {
          onSuccess: () => {
            toast.success(t('common.save'));
            onOpenChange(false);
          },
          onError: (err) => toast.error(getErrorMessage(err)),
        },
      );
    } else {
      const parsed = TableCreateRequestSchema.safeParse({
        code: values.code.trim(),
        ...(capacityNum !== null && { capacity: capacityNum }),
      });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? 'Geçersiz form');
        return;
      }
      createMut.mutate(parsed.data, {
        onSuccess: () => {
          toast.success(t('common.save'));
          onOpenChange(false);
        },
        onError: (err) => toast.error(getErrorMessage(err)),
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('tables.form.editTitle') : t('tables.form.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="table-code">{t('tables.form.code.label')}</Label>
            <Input
              id="table-code"
              placeholder={t('tables.form.code.placeholder')}
              autoFocus
              maxLength={32}
              aria-invalid={errors.code ? 'true' : 'false'}
              {...register('code', { required: true, minLength: 1, maxLength: 32 })}
            />
            {errors.code && (
              <p className="text-xs text-destructive" role="alert">
                Masa kodu zorunludur
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="table-capacity">{t('tables.form.capacity.label')}</Label>
            <Input
              id="table-capacity"
              type="number"
              min={1}
              placeholder={t('tables.form.capacity.placeholder')}
              {...register('capacity')}
            />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={pending}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600"
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('tables.form.submitting')}
                </>
              ) : (
                t('tables.form.submit')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
