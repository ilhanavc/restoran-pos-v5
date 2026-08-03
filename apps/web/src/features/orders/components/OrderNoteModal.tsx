import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';

interface OrderNoteModalProps {
  /** false = kapalı. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mevcut not (varsa) — açılışta textarea'ya doldurulur. */
  initialNote: string | null;
  onSave: (note: string | null) => void;
  isSaving: boolean;
}

/**
 * Sipariş-seviyesi not modalı — 2026-08-03 canlı talep.
 *
 * Kalem notundan (ItemDetailModal içindeki "Ürün notu") FARKLI: bu not
 * adisyonun TAMAMINA aittir, tek satır olarak dört fiş şablonunun
 * (kitchen/bill/packing/cancel) ÜST BİLGİ bölümünde basılır. Kalem notu gibi
 * fiş BASMAZ kendi başına — yalnız bir SONRAKİ fişte görünür (K6 paritesi:
 * kullanıcı beklenmedik kâğıtla karşılaşmasın diye bu açıkça yazılır).
 */
export function OrderNoteModal({
  open,
  onOpenChange,
  initialNote,
  onSave,
  isSaving,
}: OrderNoteModalProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');

  // Her açılışta güncel notla başlar (K9 deseni — populate-effect, ADR-013
  // Amd5'teki fiyat kutusu dersinden: yalnız `open` değişince sıfırlanır,
  // arka planda `initialNote` referansı değişse bile kullanıcı yazarken
  // ÜZERİNE YAZILMAZ).
  useEffect(() => {
    if (open) setText(initialNote ?? '');
    // `initialNote` bilinçli olarak dışarıda: yalnız `open` geçişinde
    // sıfırlanır — arka planda not değişse (başka terminal) bile kullanıcı
    // yazarken üzerine yazılmaz (ADR-013 Amd5 K9 dersi).
  }, [open]);

  const trimmed = text.trim();
  const dirty = trimmed !== (initialNote ?? '').trim();

  const handleSave = () => {
    onSave(trimmed.length > 0 ? trimmed : null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !isSaving && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('order.adisyon.noteModal.title')}</DialogTitle>
          <DialogDescription>
            {t('order.adisyon.noteModal.description')}
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder={t('order.adisyon.noteModal.placeholder')}
          rows={4}
          autoFocus
          disabled={isSaving}
          className="w-full resize-y rounded-md border p-2 text-sm focus:outline-none focus:ring-2"
          style={{ borderColor: 'var(--v3-border-subtle)', minHeight: 96 }}
        />
        <span className="text-[11px]" style={{ color: 'var(--v3-text-muted)' }}>
          {t('order.adisyon.noteModal.hint')}
        </span>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !dirty}
            style={{ background: 'var(--v3-purple, #7c3aed)', color: '#fff' }}
          >
            {isSaving ? t('order.adisyon.noteModal.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
