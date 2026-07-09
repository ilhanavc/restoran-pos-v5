import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Search, X } from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import {
  useCreateCustomer,
  useSearchCustomers,
} from '../../customers/api/customers';
import {
  NewCustomerDrawer,
  type NewCustomerDrawerSubmit,
} from '../../customers/components/NewCustomerDrawer';
import { formatTrPhone } from '../../../lib/phone';

export interface PickedCustomer {
  id: string;
  fullName: string;
  primaryPhone: string | null;
}

interface CustomerPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (customer: PickedCustomer) => void;
  /**
   * Açılışta arama kutusuna ön-doldurulacak telefon (Caller ID "Sipariş Aç" —
   * bilinmeyen arayan; ADR-016 §11). Verilmezse boş açılır.
   */
  initialPhone?: string | null;
}

/**
 * Müşteri seçim modalı (ADR-017 ekran 3).
 *
 * - Arama: GET /customers/search (debounced 300ms, isim VEYA telefon).
 * - Boş aramada açıklama; eşleşme yoksa "noResults".
 * - "+ Yeni Müşteri" → NewCustomerDrawer açar; başarı sonrası yeni müşteri
 *   otomatik seçilir + modal kapanır.
 */
export function CustomerPickerModal({
  open,
  onOpenChange,
  onPick,
  initialPhone,
}: CustomerPickerModalProps) {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  // Modal kapanınca state reset.
  useEffect(() => {
    if (!open) {
      setSearch('');
      setDebouncedSearch('');
      setPhoneError(null);
    }
  }, [open]);

  // Caller ID "Sipariş Aç" (bilinmeyen arayan, ADR-016 §11): açılışta telefonu
  // arama kutusuna ön-doldur → eşleşen müşteri hemen görünür / hızlı oluşturulur.
  useEffect(() => {
    if (open && initialPhone !== null && initialPhone !== undefined && initialPhone.length > 0) {
      setSearch(initialPhone);
    }
  }, [open, initialPhone]);

  const searchQuery = useSearchCustomers(debouncedSearch, 50);
  const createCustomer = useCreateCustomer();

  const customers = searchQuery.data?.customers ?? [];

  const handleCreate = async (values: NewCustomerDrawerSubmit) => {
    setPhoneError(null);
    try {
      const created = await createCustomer.mutateAsync({
        fullName: values.fullName,
        phones: values.rawPhone
          ? [{ rawPhone: values.rawPhone, isPrimary: true }]
          : [],
        addresses: values.address
          ? [
              {
                title: values.address.title,
                addressLine: values.address.addressLine,
                district: values.address.district,
                neighborhood: values.address.neighborhood,
                addressNote: values.address.addressNote,
                isDefault: values.address.isDefault,
              },
            ]
          : [],
        ...(values.notes ? { notes: values.notes } : {}),
      });
      const primary = created.phones.find((p) => p.isPrimary) ?? created.phones[0] ?? null;
      onPick({
        id: created.id,
        fullName: created.fullName,
        primaryPhone: primary?.normalizedPhone ?? null,
      });
      setDrawerOpen(false);
      onOpenChange(false);
    } catch (err) {
      if (isAxiosError(err)) {
        const data = err.response?.data as
          | { error?: { code?: string; message?: string } }
          | undefined;
        if (data?.error?.code === 'PHONE_ALREADY_EXISTS') {
          setPhoneError(t('customers.errors.phoneExists', { defaultValue: 'Bu telefon zaten kayıtlı' }));
          return;
        }
        toast.error(data?.error?.message ?? 'Müşteri eklenemedi');
        return;
      }
      toast.error('Müşteri eklenemedi');
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg p-0">
          <DialogHeader className="px-6 pt-5 pb-3">
            <DialogTitle className="text-[16px] font-bold">
              {t('takeaway.customer.modalTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 pb-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ color: 'var(--v3-text-muted)' }}
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('takeaway.customer.searchPlaceholder')}
                  className="pl-9"
                  autoFocus
                />
              </div>
              <Button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="shrink-0 gap-1"
              >
                <Plus className="h-4 w-4" />
                {t('takeaway.customer.newCustomer')}
              </Button>
            </div>
          </div>

          <div className="max-h-[420px] min-h-[280px] overflow-y-auto px-2 pb-2">
            {debouncedSearch === '' && (
              <div
                className="flex h-full min-h-[260px] items-center justify-center px-6 text-center text-sm"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('takeaway.customer.searchHint')}
              </div>
            )}

            {debouncedSearch !== '' && searchQuery.isPending && (
              <div className="flex min-h-[200px] items-center justify-center">
                <Loader2
                  className="h-5 w-5 animate-spin"
                  style={{ color: 'var(--v3-text-muted)' }}
                />
              </div>
            )}

            {debouncedSearch !== '' &&
              !searchQuery.isPending &&
              customers.length === 0 && (
                <div
                  className="flex min-h-[200px] items-center justify-center text-sm"
                  style={{ color: 'var(--v3-text-muted)' }}
                >
                  {t('takeaway.customer.noResults')}
                </div>
              )}

            {customers.map((c) => {
              const primary = c.phones.find((p) => p.isPrimary) ?? c.phones[0] ?? null;
              const initial = c.fullName.charAt(0).toLocaleUpperCase('tr-TR');
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    onPick({
                      id: c.id,
                      fullName: c.fullName,
                      primaryPhone: primary?.normalizedPhone ?? null,
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-md px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-bold"
                    style={{
                      background: 'rgba(124, 58, 237, 0.14)',
                      color: 'var(--v3-purple, #7c3aed)',
                    }}
                  >
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[14px] font-semibold"
                      style={{ color: 'var(--v3-text-primary)' }}
                    >
                      {c.fullName}
                    </div>
                    {primary && (
                      <div
                        className="truncate text-[12px] tabular-nums"
                        style={{ color: 'var(--v3-text-muted)' }}
                      >
                        {formatTrPhone(primary.normalizedPhone)}
                      </div>
                    )}
                  </div>
                  <span
                    className="shrink-0 text-[12px] font-medium"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    {t('takeaway.customer.orderCount', { count: c.totalOrders })}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-end border-t px-6 py-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              {t('takeaway.customer.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <NewCustomerDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        initialPhone={initialPhone ?? undefined}
        isSubmitting={createCustomer.isPending}
        phoneError={phoneError}
        onSubmit={handleCreate}
      />
    </>
  );
}
