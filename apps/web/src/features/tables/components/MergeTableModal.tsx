import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitMerge, Loader2, Undo2 } from 'lucide-react';
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
import { useMergeOrderTable } from '../../orders/api';
import { getErrorMessage } from '../../../lib/error';
import { tableDisplayNumber } from '../utils/tableLabel';
import { TargetTablePicker } from './TargetTablePicker';
import type { ApiTable } from '../api';
import type { Area } from '@restoran-pos/shared-types';

/**
 * MergeTableModal — "Adisyon Aktar" (ADR-029 Karar H, web parite).
 *
 * MoveTableModal ("Masayı Değiştir") ikizi. Fark: hedef picker BOŞ değil DOLU
 * masalar (kaynak adisyon başka bir dolu masaya aktarılıp birleştirilir).
 *
 * Dolu-masa 3-nokta menüsünden (ya da sipariş ekranından) açılır. İki adım:
 *   1. Hedef-masa seçici: yalnız DOLU (occupied, active_order_id !== null)
 *      masalar, bölgeye göre gruplu, kaynak masa hariç, bölgesiz grup EN SONDA;
 *      her kartta adisyon tutarı (active_order_total_cents). Başka dolu masa
 *      yoksa boş-durum (boşa aktarmak = Masayı Değiştir).
 *   2. Onay: "‹kaynak› adisyonu ‹hedef› masasına aktarılıp birleştirilsin mi?"
 *      → POST /orders/:sourceOrderId/merge.
 *
 * Başarıda ['orders']+['tables'] invalidate (hook içinde) + toast + kapan.
 * Hata: 409 MERGE_TARGET_NOT_OCCUPIED (yarışta hedef boşaldı) → net toast +
 * picker'a dön + liste tazelen (onMerged('occupied')); diğer kodlar
 * (ORDER_HAS_PAYMENTS vb.) → error.{CODE} mesajı, onayda kal (mesaj görünür).
 * Reason ayrımı MoveTableModal onMoved (#244 task_47cd76cb) ikizi.
 */
interface MergeTableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kaynak masanın (aktarılan adisyonun bulunduğu) etiketi — başlık/onay için. */
  sourceLabel: string;
  /** Aktarılacak kaynak siparişin id'si. */
  sourceOrderId: string | null;
  /** Kaynak masa id'si — hedef listeden hariç tutulur. */
  sourceTableId: string | null;
  /** Tüm masalar (board query) — dolu olanlar filtrelenir. */
  allTables: ApiTable[];
  areas: Area[];
  /**
   * Sonuç callback'i (MoveTableModal onMoved ikizi, #244 task_47cd76cb):
   * `'merged'` = birleştirildi (parent kapatır/gider); `'occupied'` = hedef
   * masa yarışta boşaldı (parent picker'da KALMALI + listeyi tazelemeli).
   * Verilmezse no-op.
   */
  onMerged?: (reason: 'merged' | 'occupied') => void;
}

export function MergeTableModal({
  open,
  onOpenChange,
  sourceLabel,
  sourceOrderId,
  sourceTableId,
  allTables,
  areas,
  onMerged,
}: MergeTableModalProps) {
  const { t } = useTranslation();
  const mergeTable = useMergeOrderTable();
  // Seçilen hedef masa (onay adımına geçince dolu; picker'da null).
  const [target, setTarget] = useState<ApiTable | null>(null);

  // Aday hedefler: DOLU masalar, kaynak masa hariç. Gruplama/sıralama/boş-durum
  // TargetTablePicker'da (ADR-035 S13 ile ortaklaştırıldı; davranış aynı).
  const candidates = useMemo(
    () =>
      allTables.filter(
        (tbl) => tbl.active_order_id !== null && tbl.id !== sourceTableId,
      ),
    [allTables, sourceTableId],
  );

  const labelFor = (tbl: ApiTable): string => {
    const n = tableDisplayNumber(tbl);
    return n !== null ? t('tables.tableLabel', { number: n }) : tbl.code;
  };

  const closeAll = () => {
    setTarget(null);
    mergeTable.reset();
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    if (sourceOrderId === null || target === null) return;
    try {
      await mergeTable.mutateAsync({
        sourceOrderId,
        targetTableId: target.id,
      });
      toast.success(t('tables.merge.success', { target: labelFor(target) }));
      onMerged?.('merged');
      closeAll();
    } catch (err) {
      const code = isAxiosError(err)
        ? (err.response?.data as { error?: { code?: string } } | undefined)
            ?.error?.code
        : null;
      // Global error.{CODE} registry (getErrorMessage) — #241/#243 konvansiyonu.
      toast.error(getErrorMessage(err));
      // Hedef masa yarışla boşaldıysa (MERGE_TARGET_NOT_OCCUPIED): onaydan
      // picker'a dön ki liste gerçeği yansıtsın (board invalidate ile dolu-masa
      // listesi tazelenir). MoveTableModal TABLE_ALREADY_OCCUPIED ikizi (#244).
      if (code === 'MERGE_TARGET_NOT_OCCUPIED') {
        setTarget(null);
        onMerged?.('occupied');
      }
    }
  };

  return (
    <>
      {/* 1. Hedef-masa seçici (DOLU masalar) */}
      <Dialog
        open={open && target === null}
        onOpenChange={(v) => !v && closeAll()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tables.merge.pickTitle')}</DialogTitle>
            <DialogDescription>
              {t('tables.merge.pickHint', { source: sourceLabel })}
            </DialogDescription>
          </DialogHeader>

          <TargetTablePicker
            candidates={candidates}
            areas={areas}
            emptyText={t('tables.merge.empty')}
            onSelect={setTarget}
          />
        </DialogContent>
      </Dialog>

      {/* 2. Onay */}
      <Dialog
        open={open && target !== null}
        onOpenChange={(v) => {
          if (mergeTable.isPending) return;
          if (!v) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tables.merge.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('tables.merge.confirmBody', {
                source: sourceLabel,
                target: target !== null ? labelFor(target) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <p
            className="text-[12px]"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {t('tables.merge.confirmNote')}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTarget(null)}
              disabled={mergeTable.isPending}
            >
              <Undo2 size={14} />
              {t('tables.merge.confirmAbort')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={mergeTable.isPending}
            >
              {mergeTable.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <GitMerge size={14} />
              )}
              {t('tables.merge.confirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
