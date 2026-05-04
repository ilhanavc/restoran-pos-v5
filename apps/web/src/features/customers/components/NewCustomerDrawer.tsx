import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { normalizePhoneTr } from '@restoran-pos/shared-domain';
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

export interface NewCustomerDrawerSubmit {
  fullName: string;
  rawPhone: string;
  notes: string | null;
  address: {
    title: string;
    addressLine: string;
    district: string | null;
    neighborhood: string | null;
    addressNote: string | null;
    isDefault: boolean;
  } | null;
}

interface NewCustomerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Caller ID popup'tan prefill (URL ?phone=). */
  initialPhone?: string | undefined;
  isSubmitting: boolean;
  /** PHONE_ALREADY_EXISTS gibi inline mesajlar. */
  phoneError?: string | null | undefined;
  onSubmit: (values: NewCustomerDrawerSubmit) => Promise<void> | void;
}

/**
 * Yeni müşteri drawer (Dialog). Telefon + isim zorunlu; adres opsiyonel.
 * react-hook-form yerine controlled state — küçük form, pattern v3 paritesi.
 */
export function NewCustomerDrawer({
  open,
  onOpenChange,
  initialPhone,
  isSubmitting,
  phoneError,
  onSubmit,
}: NewCustomerDrawerProps): JSX.Element {
  const { t } = useTranslation();
  const defaultAddrTitle = t('customers.drawer.addressDefaultTitle');

  const [fullName, setFullName] = useState('');
  const [rawPhone, setRawPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [showAddress, setShowAddress] = useState(false);
  const [addrTitle, setAddrTitle] = useState(defaultAddrTitle);
  const [addrLine, setAddrLine] = useState('');
  const [district, setDistrict] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [addrNote, setAddrNote] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setRawPhone(initialPhone ?? '');
    setNotes('');
    setShowAddress(false);
    setAddrTitle(defaultAddrTitle);
    setAddrLine('');
    setDistrict('');
    setNeighborhood('');
    setAddrNote('');
    setTouched(false);
  }, [open, initialPhone, defaultAddrTitle]);

  // Telefon: normalize sonrası boş olmamalı (sadece harf giren red).
  const phoneTrimmed = rawPhone.trim();
  const phoneEmpty = phoneTrimmed.length === 0;
  const phoneInvalid = !phoneEmpty && normalizePhoneTr(phoneTrimmed) === '';
  const phoneValid = !phoneEmpty && !phoneInvalid;
  // İsim: en az 2 karakter VE en az 1 harf (sadece rakam giren red).
  const nameTrimmed = fullName.trim();
  const nameTooShort = nameTrimmed.length < 2;
  const nameNoLetter = nameTrimmed.length >= 2 && !/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(nameTrimmed);
  const nameValid = !nameTooShort && !nameNoLetter;
  const addressValid = !showAddress || addrLine.trim().length >= 5;
  const formValid = phoneValid && nameValid && addressValid;

  const phoneErrorKey = phoneEmpty
    ? 'customers.drawer.errors.phoneRequired'
    : phoneInvalid
      ? 'customers.drawer.errors.phoneInvalid'
      : null;
  const nameErrorKey = nameTooShort
    ? 'customers.drawer.errors.nameRequired'
    : nameNoLetter
      ? 'customers.drawer.errors.nameNoLetter'
      : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!formValid) return;
    const trimmedNotes = notes.trim();
    await onSubmit({
      fullName: fullName.trim(),
      rawPhone: rawPhone.trim(),
      notes: trimmedNotes.length > 0 ? trimmedNotes : null,
      address: showAddress
        ? {
            title: addrTitle.trim().length > 0 ? addrTitle.trim() : defaultAddrTitle,
            addressLine: addrLine.trim(),
            district: district.trim().length > 0 ? district.trim() : null,
            neighborhood: neighborhood.trim().length > 0 ? neighborhood.trim() : null,
            addressNote: addrNote.trim().length > 0 ? addrNote.trim() : null,
            isDefault: true,
          }
        : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('customers.drawer.createTitle')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="cust-phone" className="mb-1.5 block">
              {t('customers.drawer.phoneLabel')}
            </Label>
            <Input
              id="cust-phone"
              type="tel"
              inputMode="tel"
              value={rawPhone}
              onChange={(e) => setRawPhone(e.target.value)}
              autoComplete="off"
              aria-invalid={(touched && !phoneValid) || Boolean(phoneError)}
              disabled={isSubmitting}
              placeholder={t('customers.drawer.phonePlaceholder')}
            />
            {touched && phoneErrorKey && (
              <p className="mt-1 text-[12px] text-destructive">
                {t(phoneErrorKey)}
              </p>
            )}
            {phoneError && (
              <p className="mt-1 text-[12px] text-destructive">{phoneError}</p>
            )}
          </div>

          <div>
            <Label htmlFor="cust-name" className="mb-1.5 block">
              {t('customers.drawer.nameLabel')}
            </Label>
            <Input
              id="cust-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="off"
              aria-invalid={touched && !nameValid}
              disabled={isSubmitting}
              placeholder={t('customers.drawer.namePlaceholder')}
            />
            {touched && nameErrorKey && (
              <p className="mt-1 text-[12px] text-destructive">
                {t(nameErrorKey)}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="cust-notes" className="mb-1.5 block">
              {t('customers.drawer.notesLabel')}
            </Label>
            <textarea
              id="cust-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isSubmitting}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="border-t pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAddress((v) => !v)}
              className="min-h-[44px] text-orange-700 hover:bg-orange-50 hover:text-orange-800"
            >
              {showAddress
                ? t('customers.drawer.addressHide')
                : t('customers.drawer.addressShow')}
            </Button>
          </div>

          {showAddress && (
            <div className="flex flex-col gap-3 rounded-md border bg-stone-50/40 p-3">
              <div>
                <Label htmlFor="addr-title" className="mb-1.5 block">
                  {t('customers.drawer.addressTitleLabel')}
                </Label>
                <Input
                  id="addr-title"
                  value={addrTitle}
                  onChange={(e) => setAddrTitle(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <Label htmlFor="addr-line" className="mb-1.5 block">
                  {t('customers.drawer.addressLineLabel')}
                </Label>
                <textarea
                  id="addr-line"
                  value={addrLine}
                  onChange={(e) => setAddrLine(e.target.value)}
                  disabled={isSubmitting}
                  rows={2}
                  aria-invalid={touched && !addressValid}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                {touched && !addressValid && (
                  <p className="mt-1 text-[12px] text-destructive">
                    {t('customers.drawer.errors.addressLineRequired')}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="addr-district" className="mb-1.5 block">
                    {t('customers.drawer.districtLabel')}
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
                    {t('customers.drawer.neighborhoodLabel')}
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
                  {t('customers.drawer.addressNoteLabel')}
                </Label>
                <Input
                  id="addr-note"
                  value={addrNote}
                  onChange={(e) => setAddrNote(e.target.value)}
                  disabled={isSubmitting}
                  placeholder={t('customers.drawer.addressNotePlaceholder')}
                />
              </div>
            </div>
          )}

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
              {t('customers.drawer.createSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
