import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Loader2, Undo2 } from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { getErrorMessage } from '../../../lib/error';
import { tableDisplayNumber } from '../../tables/utils/tableLabel';
import { TargetTablePicker } from '../../tables/components/TargetTablePicker';
import { useMoveOrderItem } from '../api';
import type { ApiOrderItem } from '../api';
import type { ApiTable } from '../../tables/api';
import type { Area } from '@restoran-pos/shared-types';

/**
 * MoveItemToTableModal — "Ürünü Başka Masaya Taşı" (ADR-035 S13, web).
 *
 * Kalem detay penceresinden (ItemDetailModal) açılır ve ANLIK çalışır: hedef
 * masa seçilir → onay → `POST /orders/:orderId/items/:itemId/move`. Bekleyen
 * (staged) düzenleme katmanına YAZMAZ — o yüzden çağıran, kaydedilmemiş
 * değişiklik varken "Taşı"yı zaten kapalı tutar (S13).
 *
 * MergeTableModal/MoveTableModal iki-adım desenini birebir izler; picker
 * TargetTablePicker ile ORTAK (ADR-035 S13 "MergeTableModal görünümü").
 * Fark: aday liste hem DOLU hem BOŞ masalar — boş hedefte sunucu yeni adisyon
 * açar (S3), kart üzerindeki "Boş" rozeti bunu seçmeden önce gösterir.
 *
 * Hata mesajı iki katmanlı: önce akışa özel `order.moveItem.errors.{CODE}`
 * (paylaşılan kodların birleştirme/silme diliyle yazılmış global karşılığı bu
 * akışta yanıltıcı olurdu), yoksa global `error.{CODE}` registry
 * (getErrorMessage) — MoveTableModal deseni.
 *
 * Yarış hataları (S12): kalem başka terminalce taşınmışsa (ORDER_ITEM_NOT_FOUND)
 * modal tamamen kapanır; hedef adisyon değiştiyse picker'a dönülür ve liste
 * tazelenir (onMoved('stale')).
 */
interface MoveItemToTableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Taşınacak KAYITLI kalem (sunucu gerçeği). null iken modal render edilmez. */
  item: ApiOrderItem | null;
  /** Kaynak (kalemin şu anki) sipariş id'si. */
  sourceOrderId: string | null;
  /** Kaynak masa id'si — hedef listeden hariç tutulur (ITEM_MOVE_SAME_ORDER). */
  sourceTableId: string | null;
  /** Kaynak masanın etiketi — başlık/onay metni için. */
  sourceLabel: string;
  /** Tüm masalar (board query) — dolu VEYA boş adaylar filtrelenir. */
  allTables: ApiTable[];
  areas: Area[];
  /**
   * Sonuç callback'i (MergeTableModal onMerged ikizi): `'moved'` = taşındı;
   * `'stale'` = yarış kaybı (hedef/kalem değişti) → parent listeyi tazelemeli.
   */
  onMoved?: (reason: 'moved' | 'stale') => void;
}

export function MoveItemToTableModal({
  open,
  onOpenChange,
  item,
  sourceOrderId,
  sourceTableId,
  sourceLabel,
  allTables,
  areas,
  onMoved,
}: MoveItemToTableModalProps) {
  const { t } = useTranslation();
  const moveItem = useMoveOrderItem();
  // Seçilen hedef masa (onay adımına geçince dolu; picker'da null).
  const [target, setTarget] = useState<ApiTable | null>(null);

  /**
   * Adaylar = MoveTableModal (boş masalar) ∪ MergeTableModal (dolu masalar),
   * kaynak masa hariç. `reserved`/`cleaning` masalar hedef değildir (Masayı
   * Değiştir akışıyla aynı sınır) — dolu olanlar `active_order_id` üzerinden
   * zaten girer.
   */
  const candidates = useMemo(
    () =>
      allTables.filter(
        (tbl) =>
          tbl.id !== sourceTableId &&
          (tbl.active_order_id !== null || tbl.status === 'available'),
      ),
    [allTables, sourceTableId],
  );

  const labelFor = (tbl: ApiTable): string => {
    const n = tableDisplayNumber(tbl);
    return n !== null ? t('tables.tableLabel', { number: n }) : tbl.code;
  };

  const closeAll = () => {
    setTarget(null);
    moveItem.reset();
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    if (item === null || sourceOrderId === null || target === null) return;
    try {
      await moveItem.mutateAsync({
        orderId: sourceOrderId,
        itemId: item.id,
        targetTableId: target.id,
      });
      toast.success(
        t('order.moveItem.success', {
          item: item.product_name,
          target: labelFor(target),
        }),
      );
      onMoved?.('moved');
      closeAll();
    } catch (err) {
      const code = isAxiosError(err)
        ? (err.response?.data as { error?: { code?: string } } | undefined)
            ?.error?.code
        : null;
      const localized = code
        ? t(`order.moveItem.errors.${code}`, { defaultValue: '' })
        : '';
      toast.error(localized !== '' ? localized : getErrorMessage(err));

      // Kalem artık kaynak adisyonda yok (başka terminal taşıdı/sildi) → burada
      // yapılacak bir şey kalmadı, kapat.
      if (code === 'ORDER_ITEM_NOT_FOUND') {
        onMoved?.('stale');
        closeAll();
        return;
      }
      // Hedefin durumu yarışta değişti → picker'a dön ki liste gerçeği
      // yansıtsın (parent ['tables'] invalidate eder).
      if (
        code === 'MERGE_TARGET_NOT_OCCUPIED' ||
        code === 'TABLE_ALREADY_OCCUPIED' ||
        code === 'ORDER_ALREADY_CLOSED'
      ) {
        setTarget(null);
        onMoved?.('stale');
      }
    }
  };

  if (item === null) return null;

  const targetIsEmpty = target !== null && target.active_order_id === null;

  return (
    <>
      {/* 1. Hedef-masa seçici (DOLU + BOŞ masalar) */}
      <Dialog
        open={open && target === null}
        onOpenChange={(v) => !v && closeAll()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('order.moveItem.pickTitle')}</DialogTitle>
            <DialogDescription>
              {t('order.moveItem.pickHint', {
                item: item.product_name,
                source: sourceLabel,
              })}
            </DialogDescription>
          </DialogHeader>

          <TargetTablePicker
            candidates={candidates}
            areas={areas}
            emptyText={t('order.moveItem.empty')}
            emptyBadge={t('order.moveItem.emptyTableBadge')}
            onSelect={setTarget}
          />
        </DialogContent>
      </Dialog>

      {/* 2. Onay */}
      <Dialog
        open={open && target !== null}
        onOpenChange={(v) => {
          if (moveItem.isPending) return;
          if (!v) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('order.moveItem.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('order.moveItem.confirmBody', {
                qty: item.quantity,
                item: item.product_name,
                source: sourceLabel,
                target: target !== null ? labelFor(target) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          {/* S3 — boş hedefte yeni adisyon açılacağı ÖNCEDEN söylenir. */}
          {targetIsEmpty && (
            <p className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
              {t('order.moveItem.confirmNoteEmptyTable')}
            </p>
          )}
          {/* S4 — yazıcı davranışı kullanıcıya açıkça söylenir (ADR-013 Amd3 K6
              ilkesi): bu işlem mutfağa kâğıt BASMAZ. */}
          <p className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
            {t('order.moveItem.confirmNoteNoPrint')}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTarget(null)}
              disabled={moveItem.isPending}
            >
              <Undo2 size={14} />
              {t('order.moveItem.confirmAbort')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={moveItem.isPending}
            >
              {moveItem.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowRightLeft size={14} />
              )}
              {t('order.moveItem.confirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
