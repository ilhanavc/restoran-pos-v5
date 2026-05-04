import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { CustomerAddress } from '@restoran-pos/shared-types';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';

export interface AddressDrawerSubmit {
  title: string;
  addressLine: string;
  district: string | null;
  neighborhood: string | null;
  addressNote: string | null;
  isDefault: boolean;
}

interface AddressDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  existingAddress?: CustomerAddress | null;
  isSubmitting: boolean;
  onSubmit: (values: AddressDrawerSubmit) => Promise<void> | void;
}

/**
 * Adres oluştur/düzenle drawer.
 */
export function AddressDrawer({
  open,
  onOpenChange,
  mode,
  existingAddress,
  isSubmitting,
  onSubmit,
}: AddressDrawerProps): JSX.Element {
  const { t } = useTranslation();
  const defaultTitle = t('customers.drawer.addressDefaultTitle');
  const [title, setTitle] = useState(defaultTitle);
  const [addressLine, setAddressLine] = useState('');
  const [district, setDistrict] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [addressNote, setAddressNote] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && existingAddress) {
      setTitle(existingAddress.title);
      setAddressLine(existingAddress.addressLine);
      setDistrict(existingAddress.district ?? '');
      setNeighborhood(existingAddress.neighborhood ?? '');
      setAddressNote(existingAddress.addressNote ?? '');
      setIsDefault(existingAddress.isDefault);
    } else {
      setTitle(defaultTitle);
      setAddressLine('');
      setDistrict('');
      setNeighborhood('');
      setAddressNote('');
      setIsDefault(false);
    }
    setTouched(false);
  }, [open, mode, existingAddress, defaultTitle]);

  const lineValid = addressLine.trim().length >= 5;
  const formValid = lineValid;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!formValid) return;
    await onSubmit({
      title: title.trim().length > 0 ? title.trim() : defaultTitle,
      addressLine: addressLine.trim(),
      district: district.trim().length > 0 ? district.trim() : null,
      neighborhood: neighborhood.trim().length > 0 ? neighborhood.trim() : null,
      addressNote: addressNote.trim().length > 0 ? addressNote.trim() : null,
      isDefault,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? t('customers.address.createTitle')
              : t('customers.address.editTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="addr-title" className="mb-1.5 block">
              {t('customers.address.titleLabel')}
            </Label>
            <Input
              id="addr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div>
            <Label htmlFor="addr-line" className="mb-1.5 block">
              {t('customers.address.lineLabel')}
            </Label>
            <textarea
              id="addr-line"
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              disabled={isSubmitting}
              rows={2}
              aria-invalid={touched && !lineValid}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {touched && !lineValid && (
              <p className="mt-1 text-[12px] text-destructive">
                {t('customers.address.errors.lineRequired')}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="addr-district" className="mb-1.5 block">
                {t('customers.address.districtLabel')}
              </Label>
              <Input
                id="addr-district"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div>
              <Label htmlFor="addr-neighborhood" className="mb-1.5 block">
                {t('customers.address.neighborhoodLabel')}
              </Label>
              <Input
                id="addr-neighborhood"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="addr-note" className="mb-1.5 block">
              {t('customers.address.noteLabel')}
            </Label>
            <Input
              id="addr-note"
              value={addressNote}
              onChange={(e) => setAddressNote(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              disabled={isSubmitting}
              className="h-4 w-4"
            />
            {t('customers.address.isDefaultLabel')}
          </label>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-1.5">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'create'
                ? t('customers.address.createSubmit')
                : t('customers.address.editSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
