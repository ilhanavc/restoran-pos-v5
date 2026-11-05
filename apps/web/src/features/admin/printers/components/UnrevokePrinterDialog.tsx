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

/**
 * Yazıcı **kilidini açma** onayı — ADR-004 Amd14'ün ertelenmiş işi
 * ("`pinnedPendingJobs > 0` iken kilit-açma onayı").
 *
 * 🔑 **Neden kilit AÇMAK da onay istiyor:** kilitliyken bu yazıcıya pinlenmiş
 * işler kuyrukta birikir ve `/jobs/next` yüklemi onları vermez. Kilit açılır
 * açılmaz ajan hepsini arka arkaya çeker → **biriken fişler topluca basılır**.
 * Üç fişte önemsiz, on beşte kağıt israfı ve mutfakta kafa karışıklığı. Müdür
 * kaç fişin çıkacağını önceden bilmeli.
 *
 * ⚠️ Bu diyalog **yalnız `pinnedPendingJobs > 0` iken** açılır. Bekleyen iş
 * yokken kilit açmak görünür bir sonuç doğurmaz; her seferinde onay sormak
 * sık yapılan zararsız bir işi yavaşlatır (pos-checklist: yoğun saatte
 * gereksiz tıklama yok). Sayı 0 ise `PrintersPage` doğrudan açar.
 *
 * Yıkıcı değil → `variant="destructive"` YOK; bu bir "devam et" onayı.
 */

interface UnrevokePrinterDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Etiket yoksa cihaz kimliği — hangi yazıcı olduğu belli olsun. */
  fallbackLabel: string;
  /** Kilit açılınca topluca basılacak iş sayısı (çağıran > 0 olduğunu garanti eder). */
  pinnedPendingJobs: number;
  isSubmitting: boolean;
  onConfirm: () => Promise<void>;
}

export function UnrevokePrinterDialog({
  open,
  onOpenChange,
  fallbackLabel,
  pinnedPendingJobs,
  isSubmitting,
  onConfirm,
}: UnrevokePrinterDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.printers.unrevoke.confirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('admin.printers.unrevoke.confirmDescription', {
              device: fallbackLabel,
            })}
          </DialogDescription>
        </DialogHeader>

        {/* `role="status"` YOK: statik içerik, diyalog açılışta zaten
            okunuyor — canlı bölge aynı metni ikinci kez okuturdu. */}
        <div
          data-testid="burst-warning"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-foreground"
        >
          <p className="font-semibold">
            {/* `count` DEĞİL `jobCount` — `count` çoğul anahtar araması
                tetikler; kardeş `orphanWarning` de `jobCount` kullanıyor. */}
            {t('admin.printers.unrevoke.burstWarningTitle', {
              jobCount: pinnedPendingJobs,
            })}
          </p>
          <p className="mt-1">{t('admin.printers.unrevoke.burstWarningBody')}</p>
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
            onClick={() => void onConfirm()}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? t('admin.printers.unrevoke.submitting')
              : t('admin.printers.unrevoke.confirmSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
