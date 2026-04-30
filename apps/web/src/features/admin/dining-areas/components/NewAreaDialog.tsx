import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';

interface NewAreaDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (vars: { name: string; initialTableCount: number }) => Promise<void>;
  isSubmitting: boolean;
}

/**
 * "Yeni bölge" modal — V3 paritesi (DiningAreasSettingsPage.jsx:278-319).
 * 2 alan: Bölge adı (zorunlu), İlk masa sayısı (default 0). Submit:
 * POST /areas. Initial > 0 ise PR-C'de masa ekleme — şu an placeholder toast.
 */
export function NewAreaDialog({ open, onOpenChange, onSubmit, isSubmitting }: NewAreaDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [initial, setInitial] = useState('0');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setInitial('0');
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('admin.diningAreas.errors.nameRequired'));
      return;
    }
    const n = Math.floor(Number(initial));
    if (!Number.isFinite(n) || n < 0) {
      setError(t('admin.diningAreas.errors.invalidCount'));
      return;
    }
    setError(null);
    await onSubmit({ name: trimmed, initialTableCount: n });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('admin.diningAreas.newAreaDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div>
              <Label htmlFor="newArea-name" className="mb-1.5 block">
                {t('admin.diningAreas.newAreaDialog.nameLabel')}
              </Label>
              <Input
                id="newArea-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('admin.diningAreas.newAreaDialog.namePlaceholder')}
                autoFocus
                disabled={isSubmitting}
              />
            </div>
            <div>
              <Label htmlFor="newArea-initial" className="mb-1.5 block">
                {t('admin.diningAreas.newAreaDialog.initialCountLabel')}
              </Label>
              <Input
                id="newArea-initial"
                type="number"
                min={0}
                value={initial}
                onChange={(e) => setInitial(e.target.value)}
                disabled={isSubmitting}
                className="max-w-[120px]"
              />
              <p className="mt-1.5 text-[11px]" style={{ color: 'var(--v3-text-muted)' }}>
                {t('admin.diningAreas.newAreaDialog.initialCountHint')}
              </p>
            </div>
            {error && (
              <p className="text-sm" style={{ color: 'var(--v3-danger, #dc2626)' }}>
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('admin.diningAreas.cancelButton')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t('admin.diningAreas.newAreaDialog.submitting')
                : t('admin.diningAreas.newAreaDialog.submitButton')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
