import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';

interface DeleteAreaDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  areaName: string;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

/**
 * Bölge silme onayı — V3 paritesi (DiningAreasSettingsPage.jsx:147-163).
 *
 * Backend davranışı (ADR-009 Amendment 2026-06-30 Karar C(a)):
 *   - Bölgede açık adisyonlu (aktif-siparişli) masa varsa silme ENGELLENİR
 *     (409 AREA_HAS_ACTIVE_TABLES) — toast ile Türkçe gösterilir.
 *   - Boş masalar silinmez; cascade NULL ile "Bölgesiz" grubuna düşer.
 * Dialog metni bu davranışla hizalı; inline ipucu guard'ı önceden bildirir.
 */
export function DeleteAreaDialog({ open, onOpenChange, areaName, onConfirm, isDeleting }: DeleteAreaDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !isDeleting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.diningAreas.deleteDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('admin.diningAreas.deleteDialog.body', { name: areaName })}
          </DialogDescription>
        </DialogHeader>
        <p
          className="text-[12px]"
          style={{ color: 'var(--v3-text-muted)', lineHeight: 1.45 }}
        >
          {t('admin.diningAreas.deleteDialog.activeTablesHint')}
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {t('admin.diningAreas.cancelButton')}
          </Button>
          <Button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
            style={{ background: 'var(--v3-danger, #dc2626)', color: '#fff' }}
          >
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('admin.diningAreas.deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
