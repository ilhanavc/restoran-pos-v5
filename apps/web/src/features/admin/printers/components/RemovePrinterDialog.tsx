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
 * Yazıcı kaydını **kaldırma** onayı — ADR-044 Amendment 1 K2.
 *
 * 🔑 **Neden var:** her işletme kurulumda bir `bootstrap-initial` satırıyla
 * doğuyor ve o satır hiç kullanılmasa bile ekranda **kalıcı** bir kart olarak
 * duruyordu; silme özelliği hiç yazılmamıştı. Tek restoranda pürüz, müşteriye
 * satılan üründe her müşterinin ilk gününde gördüğü bir kusur.
 *
 * ⚠️ **Kilitle/Kilidi aç çiftinin aksine bu işlem GERİ ALINAMAZ** ve diyalog
 * bunu açıkça yazar. "Geri al" bilerek eklenmedi: eklenseydi kaldırmanın bir
 * anlamı kalmazdı. Gerçek geri dönüş yolu yedekten restore.
 *
 * Yıkıcı → onay düğmesi `variant="destructive"`. Kardeş `RevokePrinterDialog`
 * ile aynı görsel dil; fark, orada gerekçe seçilmesi, burada seçilecek bir şey
 * olmaması — kapı zaten yalnız **hiç kullanılmamış** kaydı geçiriyor.
 *
 * Sunucu son söz sahibi: üç koşuldan biri tutmazsa uç `409` döner ve kullanıcı
 * hata metnini görür. İstemci düğmeyi yalnız iki koşulu görebildiği için
 * (kilitli + hiç görülmemiş) gösterir; üçüncüsü (hiç iş basmamış) yalnız
 * sunucuda bilinir.
 */

interface RemovePrinterDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Etiket yoksa cihaz kimliği — hangi kaydın gideceği belli olsun. */
  fallbackLabel: string;
  isSubmitting: boolean;
  onConfirm: () => Promise<void>;
}

export function RemovePrinterDialog({
  open,
  onOpenChange,
  fallbackLabel,
  isSubmitting,
  onConfirm,
}: RemovePrinterDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.printers.remove.confirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('admin.printers.remove.confirmDescription', {
              device: fallbackLabel,
            })}
          </DialogDescription>
        </DialogHeader>

        {/* Geri alınamazlık, başlıkta değil AYRI bir uyarı kutusunda: başlık
            hızlı okunur, kutu gözü durdurur. `role="status"` YOK — statik
            içerik, diyalog açılışında zaten okunuyor. */}
        <div
          data-testid="irreversible-warning"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[13px] text-foreground"
        >
          <p className="font-semibold">
            {t('admin.printers.remove.irreversibleTitle')}
          </p>
          <p className="mt-1">{t('admin.printers.remove.irreversibleBody')}</p>
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
            onClick={() => void onConfirm()}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? t('admin.printers.remove.submitting')
              : t('admin.printers.remove.confirmSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
