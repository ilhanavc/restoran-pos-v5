import { useEffect, useState } from 'react';
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
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';

/**
 * Yazıcıya istasyon etiketi verme — ADR-032 Amendment 2 K1 (Dilim A).
 *
 * Etiket insan içindir ("Fırın" / "Izgara" / "Kasa"); fiş üstündeki
 * FIRIN/IZGARA yazısı AYRI katmandır ve bu değerden ETKİLENMEZ. Boş etiket
 * kabul edilmez (backend min 1); etiket verilmemişse liste cihaz kimliğini
 * gösterir.
 */

const MAX_LABEL_LENGTH = 60;

interface RenamePrinterDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Etiket yoksa cihaz kimliği — kullanıcının hangi yazıcı olduğunu anlaması için. */
  fallbackLabel: string;
  initialName: string | null;
  isSubmitting: boolean;
  onConfirm: (displayName: string) => Promise<void>;
}

export function RenamePrinterDialog({
  open,
  onOpenChange,
  fallbackLabel,
  initialName,
  isSubmitting,
  onConfirm,
}: RenamePrinterDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue(initialName ?? '');
  }, [open, initialName]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !isSubmitting;

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.printers.rename.title')}</DialogTitle>
          <DialogDescription>
            {t('admin.printers.rename.description', { device: fallbackLabel })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="printer-display-name">
            {t('admin.printers.rename.label')}
          </Label>
          <Input
            id="printer-display-name"
            value={value}
            maxLength={MAX_LABEL_LENGTH}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('admin.printers.rename.placeholder')}
            disabled={isSubmitting}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void onConfirm(trimmed)}
            disabled={!canSubmit}
          >
            {t('admin.printers.rename.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
