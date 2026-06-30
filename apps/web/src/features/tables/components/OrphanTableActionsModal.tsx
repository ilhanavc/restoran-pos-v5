import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MapPin, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import type { Area } from '@restoran-pos/shared-types';

interface OrphanTableActionsModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Orphan masanın görünen etiketi (kanonik labelFor çıktısı). */
  tableLabel: string;
  /** Bu masanın boş (silinebilir) olup olmadığı — dolu ise sil engellenir. */
  isOccupied: boolean;
  /** Atanabilir gerçek bölgeler. */
  areas: Area[];
  /** Bir bölge seçildiğinde PATCH /tables/:id/area tetikler. */
  onAssign: (areaId: string) => void;
  /** Boş orphan masayı DELETE /tables/:id ile siler. */
  onDelete: () => void;
  isAssigning: boolean;
  isDeleting: boolean;
  /**
   * Modal kapanırken çağrılır — bekleyen mutation'ların React Query reset()'i
   * burada yapılır ki bir sonraki açılışta bayat isPending kalmasın. Modal
   * meşgulken (busy) bile kapanabilir; kullanıcı asla kilitlenmez.
   */
  onReset: () => void;
}

/**
 * Bölgesiz (orphan) masa işlem modali — ADR-009 Amendment 2026-06-30 Karar C(c).
 *
 * Mevcut endpoint'leri wire eder:
 *   - PATCH /tables/:id/area → masayı bir bölgeye atar (area picker)
 *   - DELETE /tables/:id → boş orphan masayı siler (guard: dolu → 409 toast)
 *
 * NOT: dolu masa "Öde/Hızlı Öde" akışına ASLA bağlanmaz (o akış occupied
 * masalar için TableActionsModal'da). Burada dolu orphan için sadece "Bölgeye
 * Ata" sunulur — açık adisyon kurtarılıp tahtaya geri taşınır; sil gizlenir.
 */
export function OrphanTableActionsModal({
  open,
  onOpenChange,
  tableLabel,
  isOccupied,
  areas,
  onAssign,
  onDelete,
  isAssigning,
  isDeleting,
  onReset,
}: OrphanTableActionsModalProps) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Hangi bölge butonuna basıldığını izler — yalnız o butonda spinner gösterilir
  // (diğerleri spinner'sız disabled). Atama bitince/modal kapanınca sıfırlanır.
  const [assigningAreaId, setAssigningAreaId] = useState<string | null>(null);
  const busy = isAssigning || isDeleting;

  // Meşgul olsa bile kapanmaya izin verilir (PATCH askıda kalsa kullanıcı
  // kilitlenmesin). Kapanışta confirm/state temizlenir ve bekleyen mutation
  // reset edilir.
  const close = (v: boolean) => {
    if (!v) {
      setConfirmDelete(false);
      setAssigningAreaId(null);
      onReset();
    }
    onOpenChange(v);
  };

  const handleAssign = (areaId: string) => {
    setAssigningAreaId(areaId);
    onAssign(areaId);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('tables.orphan.assignAreaTitleWithLabel', { label: tableLabel })}
          </DialogTitle>
          <DialogDescription>
            {t('tables.orphan.assignAreaHint')}
          </DialogDescription>
        </DialogHeader>

        {areas.length === 0 ? (
          <p
            className="text-[13px]"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {t('tables.orphan.noAreas')}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {areas.map((area) => {
              const isThisAssigning = isAssigning && assigningAreaId === area.id;
              return (
                <button
                  key={area.id}
                  type="button"
                  disabled={busy}
                  onClick={() => handleAssign(area.id)}
                  className="inline-flex min-h-[52px] items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[14px] font-semibold transition-colors hover:[background:var(--v3-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 disabled:opacity-50"
                  style={{
                    background: 'var(--v3-surface-1)',
                    border: '1px solid var(--v3-border-subtle)',
                    color: 'var(--v3-text-primary)',
                  }}
                >
                  {isThisAssigning ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <MapPin size={16} strokeWidth={2} />
                  )}
                  <span className="truncate">{area.name}</span>
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          {/* Üst-düzey kapatma — meşgulken bile tıklanabilir kalır ki askıda
              mutation kullanıcıyı kilitlemesin (#2). */}
          <Button
            type="button"
            variant="outline"
            onClick={() => close(false)}
          >
            {t('common.cancel')}
          </Button>
          {/* Sil yalnızca BOŞ orphan masa için — dolu masa silinemez (guard). */}
          {!isOccupied &&
            (confirmDelete ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  {t('tables.orphan.cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={onDelete}
                  style={{ background: 'var(--v3-danger, #dc2626)', color: '#fff' }}
                >
                  {isDeleting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t('tables.orphan.delete')}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
                className="gap-1.5"
                style={{ color: 'var(--v3-danger, #dc2626)' }}
              >
                <Trash2 size={16} />
                {t('tables.orphan.delete')}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
