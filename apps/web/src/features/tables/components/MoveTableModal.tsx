import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Loader2, Undo2 } from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { UNASSIGNED_AREA } from '@restoran-pos/shared-domain';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { useMoveOrderTable } from '../../orders/api';
import { tableDisplayNumber } from '../utils/tableLabel';
import type { ApiTable } from '../api';
import type { Area } from '@restoran-pos/shared-types';

/**
 * MoveTableModal — "Masayı Değiştir" (ADR-028 Karar H, web parite).
 *
 * Dolu-masa 3-nokta menüsünden açılır. İki adım:
 *   1. Hedef-masa seçici: yalnız BOŞ (available) masalar, bölgeye göre gruplu,
 *      kaynak masa hariç, bölgesiz grup EN SONDA. Hiç boş masa yoksa boş-durum.
 *   2. Onay: "‹kaynak› adisyonu ‹hedef› masasına taşınsın mı?" → PATCH.
 *
 * Başarıda ['orders']+['tables'] invalidate (hook içinde) + toast + kapan.
 * Hata: TABLE_ALREADY_OCCUPIED → net "hedef masa artık dolu" + liste tazelen
 * (picker gerçeği yansıtsın); diğer kodlar → Türkçe fallback. Hata görünür kalır.
 */
interface MoveTableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kaynak masanın (taşınan siparişin bulunduğu) etiketi — başlık/onay için. */
  sourceLabel: string;
  /** Taşınacak aktif siparişin id'si. */
  orderId: string | null;
  /** Kaynak masa id'si — hedef listeden hariç tutulur. */
  sourceTableId: string | null;
  /** Tüm masalar (board query) — boş olanlar filtrelenir. */
  allTables: ApiTable[];
  areas: Area[];
  /**
   * Sonuç callback'i (task_47cd76cb): `'moved'` = taşındı (parent kapatır/gider),
   * `'occupied'` = hedef masa yarışta doldu (parent picker'da KALMALI + listeyi
   * tazelemeli — toast "başka masa seç" ile uyumlu). Verilmezse no-op.
   */
  onMoved?: (reason: 'moved' | 'occupied') => void;
}

export function MoveTableModal({
  open,
  onOpenChange,
  sourceLabel,
  orderId,
  sourceTableId,
  allTables,
  areas,
  onMoved,
}: MoveTableModalProps) {
  const { t } = useTranslation();
  const moveTable = useMoveOrderTable();
  // Seçilen hedef masa (onay adımına geçince dolu; picker'da null).
  const [target, setTarget] = useState<ApiTable | null>(null);

  // Boş masalar bölgeye göre gruplu; kaynak masa hariç. Bölgesiz grup en sonda.
  const groups = useMemo(() => {
    const available = allTables.filter(
      (tbl) => tbl.status === 'available' && tbl.id !== sourceTableId,
    );
    const byArea: { areaId: string | null; name: string; tables: ApiTable[] }[] =
      [];
    for (const area of areas) {
      const tables = available.filter((tbl) => tbl.area_id === area.id);
      if (tables.length > 0) {
        byArea.push({ areaId: area.id, name: area.name, tables });
      }
    }
    // Bölgesiz orphan grup EN SONA.
    const orphans = available.filter((tbl) => tbl.area_id === null);
    if (orphans.length > 0) {
      byArea.push({
        areaId: UNASSIGNED_AREA,
        name: t('tables.group.unassigned'),
        tables: orphans,
      });
    }
    return byArea;
  }, [allTables, areas, sourceTableId, t]);

  const hasAnyAvailable = groups.length > 0;

  const labelFor = (tbl: ApiTable): string => {
    const n = tableDisplayNumber(tbl);
    return n !== null ? t('tables.tableLabel', { number: n }) : tbl.code;
  };

  const closeAll = () => {
    setTarget(null);
    moveTable.reset();
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    if (orderId === null || target === null) return;
    try {
      await moveTable.mutateAsync({ orderId, tableId: target.id });
      toast.success(t('tables.move.success', { target: labelFor(target) }));
      onMoved?.('moved');
      closeAll();
    } catch (err) {
      const code = isAxiosError(err)
        ? (err.response?.data as { error?: { code?: string } } | undefined)
            ?.error?.code
        : null;
      const localized = code
        ? t(`tables.move.errors.${code}`, { defaultValue: '' })
        : '';
      toast.error(localized !== '' ? localized : t('tables.move.error'));
      // Hedef masa yarışla dolduysa: onaydan picker'a dön ki liste gerçeği
      // yansıtsın (board invalidate ile boş-masa listesi tazelenir).
      if (code === 'TABLE_ALREADY_OCCUPIED') {
        setTarget(null);
        onMoved?.('occupied');
      }
    }
  };

  return (
    <>
      {/* 1. Hedef-masa seçici */}
      <Dialog
        open={open && target === null}
        onOpenChange={(v) => !v && closeAll()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tables.move.pickTitle')}</DialogTitle>
            <DialogDescription>
              {t('tables.move.pickHint', { source: sourceLabel })}
            </DialogDescription>
          </DialogHeader>

          {!hasAnyAvailable ? (
            <div
              className="rounded-xl border border-dashed p-8 text-center text-sm"
              style={{
                borderColor: 'var(--v3-border-subtle)',
                color: 'var(--v3-text-muted)',
              }}
            >
              {t('tables.move.empty')}
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto">
              {groups.map((group) => (
                <div key={group.areaId ?? UNASSIGNED_AREA}>
                  <p
                    className="mb-2 text-[12px] font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    {group.name}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {group.tables.map((tbl) => (
                      <button
                        key={tbl.id}
                        type="button"
                        onClick={() => setTarget(tbl)}
                        className="flex h-16 items-center justify-center rounded-xl border text-[14px] font-semibold transition-colors hover:[background:var(--v3-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
                        style={{
                          borderColor: 'var(--v3-border-subtle)',
                          background: '#fff',
                          color: 'var(--v3-text-primary)',
                        }}
                      >
                        {labelFor(tbl)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 2. Onay */}
      <Dialog
        open={open && target !== null}
        onOpenChange={(v) => {
          if (moveTable.isPending) return;
          if (!v) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tables.move.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('tables.move.confirmBody', {
                source: sourceLabel,
                target: target !== null ? labelFor(target) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTarget(null)}
              disabled={moveTable.isPending}
            >
              <Undo2 size={14} />
              {t('tables.move.confirmAbort')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={moveTable.isPending}
            >
              {moveTable.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowLeftRight size={14} />
              )}
              {t('tables.move.confirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
