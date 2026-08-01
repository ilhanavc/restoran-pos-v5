import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

/**
 * Müşteri ismi düzenleme — CustomerDetailPage + CustomersPage'de aynı
 * pencere (ürün sahibi talebi, 2026-08-01: "ikisinden de" düzenlenebilsin).
 * Backend `PATCH /customers/:id` zaten `fullName`'i kabul ediyordu; eksik
 * olan yalnızca bu UI'ydı.
 */
interface EditCustomerNameDialogProps {
  /** null = kapalı. */
  customer: { id: string; fullName: string } | null;
  onOpenChange: (open: boolean) => void;
  isSaving: boolean;
  onSave: (fullName: string) => void;
}

export function EditCustomerNameDialog({
  customer,
  onOpenChange,
  isSaving,
  onSave,
}: EditCustomerNameDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');

  useEffect(() => {
    if (customer === null) return;
    setName(customer.fullName);
  }, [customer]);

  const trimmed = name.trim();
  const valid = trimmed.length >= 2;
  const dirty = customer !== null && trimmed !== customer.fullName;

  return (
    <Dialog
      open={customer !== null}
      onOpenChange={(v) => !isSaving && onOpenChange(v)}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('customers.editName.editTitle')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('customers.editName.editTitle')}
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-bold">
            {t('customers.editName.nameLabel')}
          </span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSaving}
            autoFocus
            className="h-11 text-[15px]"
          />
          {!valid && name.length > 0 && (
            <span className="text-[12px] text-destructive">
              {t('customers.editName.errors.nameRequired')}
            </span>
          )}
          {/* HCI review: dirty-disabled Save butonunun "bozuk" sanılmaması için
              neden pasif olduğu açıkça yazılır (Nielsen #1 — sistem durumu görünür). */}
          {valid && !dirty && (
            <span className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
              {t('customers.editName.noChangeHint')}
            </span>
          )}
        </label>

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
            onClick={() => onSave(trimmed)}
            disabled={isSaving || !valid || !dirty}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
