import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Printer } from 'lucide-react';
import type { AvailablePrinter, PrinterStatus } from '@restoran-pos/shared-types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { useAvailablePrinters } from '../../payment/api';

/**
 * Hedef yazıcı seçim modali — ADR-032 Amendment 4 (K6).
 *
 * "Yazdır" butonuna basıldığında fişin HANGİ fiziksel yazıcıdan çıkacağını
 * sorar. İki tetikleyici de (sipariş ekranı başlığı + paket kart 3-nokta) bu
 * TEK bileşeni kullanır.
 *
 * Davranış sözleşmesi:
 *   K6.3 — liste tam 1 öğe ise modal AÇILMAZ, o yazıcıyla doğrudan basılır
 *          (tek seçenekli soru, sorunun kendisi değil gürültüsüdür).
 *   K6.5 — liste hatası veya BOŞ liste → modal açılmaz, baskı HEDEFSİZ gönderilir
 *          (bugünkü davranışa güvenli geri düşüş). Yazıcı listesi ikincil bir
 *          kolaylıktır; adisyon basmayı bloke etme yetkisi yoktur.
 *   K6.4 — çevrimdışı/gecikmeli yazıcı SEÇİLEBİLİR (disabled YOK), ama onay
 *          öncesi KALICI satır-içi uyarı gösterilir (toast değil — geçici UI
 *          kullanıcının gözünden kaçar).
 *   K6.7 — seçim HATIRLANMAZ; modal her açılışta sıfırdan başlar.
 *
 * Durum rozeti metinleri Amd2'nin MEVCUT `admin.printers.status.*`
 * anahtarlarından okunur — ikinci bir çeviri tablosu açmak kardeş-artefakt
 * drift'idir.
 */

/** Uyarı gerektiren durumlar: yazıcı şu an basamayacak durumda. */
const WARNING_STATUSES: readonly PrinterStatus[] = [
  'delayed',
  'offline',
  'pending',
];

function statusToneClass(status: PrinterStatus): string {
  switch (status) {
    case 'online':
      return 'bg-emerald-100 text-emerald-800';
    case 'delayed':
      return 'bg-amber-100 text-amber-800';
    default:
      return 'bg-rose-100 text-rose-800';
  }
}

export interface PrintTargetDialogProps {
  /** Kullanıcı "Yazdır"a bastı mı (modal isteği). false → hiç istek atılmaz. */
  requested: boolean;
  /**
   * Baskıya devam: `targetPrinterId` seçilen yazıcı, `undefined` ise hedefsiz
   * (bugünkü davranış). Çağıran bu callback'te `printBill.mutateAsync` çağırır.
   */
  onResolved: (targetPrinterId: string | undefined) => void;
  /** ESC / dışarı tıklama / İptal → baskı YOK. */
  onCancel: () => void;
}

export function PrintTargetDialog({
  requested,
  onResolved,
  onCancel,
}: PrintTargetDialogProps) {
  const { t } = useTranslation();
  const { data, isError, isSuccess } = useAvailablePrinters(requested);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Liste hazır olmadan modal AÇILMAZ: seçenek sayısı bilinmeden "sor ya da
  // sorma" kararı verilemez (K6.3/K6.5). Kısa gecikme, butonun kendi pending
  // göstergesiyle zaten örtülür.
  const printers: AvailablePrinter[] = data ?? [];
  const shouldAsk = requested && isSuccess && printers.length > 1;

  // Otomatik karar (modal açmadan basma) istek başına EN FAZLA BİR KEZ verilir:
  // `onResolved` çağıranda memoize edilmemiş olabilir ve tekrar tetiklenmesi
  // çift print-job demektir.
  const autoResolvedRef = useRef(false);

  useEffect(() => {
    if (!requested) {
      // K6.7 — seçim hatırlanmaz; sonraki istek sıfırdan başlar.
      setSelectedId(null);
      autoResolvedRef.current = false;
      return;
    }
    if (autoResolvedRef.current) return;
    const list = data ?? [];
    if (isError) {
      autoResolvedRef.current = true;
      onResolved(undefined); // K6.5 — hedefsiz bas, kullanıcıyı bloke etme
      return;
    }
    if (!isSuccess) return;
    if (list.length === 0) {
      autoResolvedRef.current = true;
      onResolved(undefined); // K6.5 — boş liste de hedefsiz akışa düşer
      return;
    }
    if (list.length === 1) {
      autoResolvedRef.current = true;
      onResolved(list[0]!.id); // K6.3 — tek yazıcı: soru sorma
    }
  }, [requested, isError, isSuccess, data, onResolved]);

  const selected = printers.find((p) => p.id === selectedId) ?? null;
  const showWarning =
    selected !== null && WARNING_STATUSES.includes(selected.status);

  return (
    <Dialog open={shouldAsk} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('order.printTarget.title')}</DialogTitle>
          <DialogDescription>
            {t('order.printTarget.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2" role="radiogroup">
          {printers.map((printer) => {
            const isSelected = printer.id === selectedId;
            return (
              <button
                key={printer.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid={`print-target-${printer.id}`}
                onClick={() => setSelectedId(printer.id)}
                className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-lg border-2 px-4 py-3 text-right transition ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Printer className="h-5 w-5 shrink-0 text-slate-500" />
                  <span className="flex flex-col items-start">
                    <span className="text-base font-semibold text-slate-900">
                      {printer.displayName}
                    </span>
                    {printer.isBillPrinter ? (
                      <span className="text-xs text-slate-500">
                        {t('order.printTarget.billPrinterHint')}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${statusToneClass(
                    printer.status,
                  )}`}
                >
                  {t(`admin.printers.status.${printer.status}`)}
                </span>
              </button>
            );
          })}
        </div>

        {/* K6.4 — kalıcı satır-içi uyarı (toast DEĞİL). delayed/offline/pending
            operasyonel olarak farklı durumlar (Amd2 K10 eşikleri) — hci-review
            bulgusu: tek "çevrimdışı" metni rozetle çelişiyordu, üçü ayrıldı. */}
        {showWarning && selected !== null ? (
          <p
            role="status"
            data-testid="print-target-offline-warning"
            className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {t(`order.printTarget.warning.${selected.status}`)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={selected === null}
            onClick={() => selected !== null && onResolved(selected.id)}
          >
            {t('order.printTarget.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
