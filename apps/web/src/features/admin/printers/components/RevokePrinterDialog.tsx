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
import { Label } from '../../../../components/ui/label';
import {
  PRINTER_REVOKE_REASONS,
  type PrinterRevokeReason,
} from '@restoran-pos/shared-types';

/**
 * Yazıcı **kilitleme** onayı — ADR-004 Amendment 14 K1.
 *
 * Yıkıcı aksiyon: kilitlenen yazıcı o andan sonra iş çekemez (JWT'si bir
 * sonraki istekte ölür). Bu yüzden `window.confirm` değil **Dialog** —
 * emsal `DeleteProductDialog` (S138 #701).
 *
 * 🔒 **Gerekçe SABİT LİSTEDEN seçilir, serbest metin DEĞİL.** Gerekçe hem
 * `agents.revoke_reason`'a hem `audit_logs.payload`'a (uzun retention)
 * yazılıyor; serbest metin olsaydı buraya yazılan bir kişi adı/telefon
 * KVKK açısından iki yere de girerdi ve iki koruma katmanı da bunu
 * yakalamazdı (ikisi de anahtar-adı bazlı, değeri denetlemiyor). Liste
 * `PRINTER_REVOKE_REASONS`'tan türer — yeni gerekçe eklenirse burada
 * kendiliğinden görünür, ama i18n etiketi de eklenmelidir.
 */

interface RevokePrinterDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Etiket yoksa cihaz kimliği — hangi yazıcı olduğu belli olsun. */
  fallbackLabel: string;
  isSubmitting: boolean;
  onConfirm: (reason: PrinterRevokeReason) => Promise<void>;
}

export function RevokePrinterDialog({
  open,
  onOpenChange,
  fallbackLabel,
  isSubmitting,
  onConfirm,
}: RevokePrinterDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<PrinterRevokeReason | ''>('');

  useEffect(() => {
    // Her açılışta sıfırla: önceki yazıcının gerekçesi yanlışlıkla
    // yenisine uygulanmasın.
    if (open) setReason('');
  }, [open]);

  const canSubmit = reason !== '' && !isSubmitting;

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.printers.revoke.title')}</DialogTitle>
          <DialogDescription>
            {t('admin.printers.revoke.description', { device: fallbackLabel })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="printer-revoke-reason">
            {t('admin.printers.revoke.reasonLabel')}
          </Label>
          <select
            id="printer-revoke-reason"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
            value={reason}
            disabled={isSubmitting}
            onChange={(e) => setReason(e.target.value as PrinterRevokeReason)}
          >
            <option value="" disabled>
              {t('admin.printers.revoke.reasonPlaceholder')}
            </option>
            {PRINTER_REVOKE_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`admin.printers.revoke.reasons.${r}`)}
              </option>
            ))}
          </select>
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
            variant="destructive"
            onClick={() => {
              if (reason !== '') void onConfirm(reason);
            }}
            disabled={!canSubmit}
          >
            {isSubmitting
              ? t('admin.printers.revoke.submitting')
              : t('admin.printers.revoke.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
