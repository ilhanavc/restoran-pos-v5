import { useTranslation } from 'react-i18next';
import { Construction } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';

interface TableDetailPlaceholderProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Görüntüde "Masa N — ..." başlığında kullanılır. null ise sadece title. */
  displayName?: string | null;
}

/**
 * Phase 3 modal — masaya tıklayınca açılır. Sipariş alma + adisyon
 * Phase 3'te aktifleşecek; şu an placeholder.
 */
export function TableDetailPlaceholder({ open, onOpenChange, displayName }: TableDetailPlaceholderProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Construction className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <DialogTitle>{displayName ? `${displayName} — ${t('tables.phase3Modal.title')}` : t('tables.phase3Modal.title')}</DialogTitle>
              <DialogDescription className="mt-2">
                {t('tables.phase3Modal.body')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('tables.phase3Modal.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
