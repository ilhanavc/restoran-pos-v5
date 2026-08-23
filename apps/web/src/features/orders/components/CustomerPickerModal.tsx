import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Loader2, Pencil, Plus, Search, X } from 'lucide-react';
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
  useUpdateCustomer,
} from '../../customers/api/customers';
import {
  NewCustomerDrawer,
  type NewCustomerDrawerSubmit,
} from '../../customers/components/NewCustomerDrawer';
import { EditCustomerNameDialog } from '../../customers/components/EditCustomerNameDialog';
import { CustomerOrderHistoryDrawer } from '../../customers/components/CustomerOrderHistoryDrawer';
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
  /**
   * Siparişe HÂLİHAZIRDA seçili müşteri (S105). Modal açılışta onu "seçili"
   * gösterir ve arama kutusunu adıyla ön-doldurur; böylece "Kişi" butonuna
   * basan kullanıcı kimin seçili olduğunu görür (eskiden modal her açılışta
   * bomboş başlıyordu, arayan müşteri belliyken bile).
   */
  selectedCustomer?: PickedCustomer | null;
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
  selectedCustomer,
}: CustomerPickerModalProps) {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  /** Kalem butonu → isim düzenleme (CustomersPage ile aynı pattern). */
  const [editingCustomer, setEditingCustomer] = useState<{
    id: string;
    fullName: string;
  } | null>(null);

  /**
   * Saat butonu → sipariş geçmişi drawer'ı (ADR-038 K7.2). Kalem butonuyla
   * aynı pattern: satır-içi aksiyon + kardeş Dialog. Dialog portal olduğu için
   * `OrderScreenPage` unmount OLMAZ, sepet korunur (S112 regresyonu).
   */
  const [historyCustomer, setHistoryCustomer] = useState<{
    id: string;
    fullName: string;
  } | null>(null);

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
      setEditingCustomer(null);
    }
  }, [open]);

  // Açılışta arama kutusunu ön-doldur:
  //   1) Seçili müşteri varsa ADIYLA (S105 — "Kişi" butonuna basan kullanıcı
  //      kimin seçili olduğunu görsün, gerekirse tek dokunuşla değiştirsin),
  //   2) yoksa Caller ID telefonuyla (bilinmeyen arayan, ADR-016 §11).
  useEffect(() => {
    if (!open) return;
    if (selectedCustomer != null && selectedCustomer.fullName.length > 0) {
      setSearch(selectedCustomer.fullName);
      return;
    }
    if (initialPhone !== null && initialPhone !== undefined && initialPhone.length > 0) {
      setSearch(initialPhone);
    }
  }, [open, initialPhone, selectedCustomer]);

  const searchQuery = useSearchCustomers(debouncedSearch, 50);
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();

  const customers = searchQuery.data?.customers ?? [];

  /**
   * Kalem butonu → isim düzenleme (EditCustomerNameDialog). Backend
   * `PATCH /customers/:id` (useUpdateCustomer, ADR-017 kapsamı); kayıt sonrası
   * arama listesini tazele ki yeni isim anında görünsün. Not: telefon/adres
   * düzenleme müşteri detay sayfasında kalır (bu modal sipariş-akışı içi,
   * hızlı isim düzeltme yeterli).
   */
  const handleSaveName = async (fullName: string) => {
    if (editingCustomer === null) return;
    try {
      await updateCustomer.mutateAsync({ id: editingCustomer.id, fullName });
      setEditingCustomer(null);
      toast.success(t('customers.editName.success'));
      void searchQuery.refetch();
    } catch (err) {
      const fallback = t('customers.editName.errors.saveFailed');
      if (isAxiosError(err)) {
        const message = (
          err.response?.data as { error?: { message?: string } } | undefined
        )?.error?.message;
        toast.error(message ?? fallback);
      } else {
        toast.error(fallback);
      }
    }
  };

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
          setPhoneError(t('customers.errors.PHONE_ALREADY_EXISTS'));
          return;
        }
        toast.error(data?.error?.message ?? t('customers.errors.createFailed'));
        return;
      }
      toast.error(t('customers.errors.createFailed'));
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
              // S105: siparişe seçili müşteri listede işaretli görünür.
              const isSelected = selectedCustomer?.id === c.id;
              return (
                <div
                  key={c.id}
                  aria-current={isSelected ? 'true' : undefined}
                  className="flex w-full items-center gap-2 rounded-md pr-2 transition-colors hover:bg-accent"
                  style={
                    isSelected
                      ? {
                          background: 'var(--v3-purple-bg, #f5f3ff)',
                          boxShadow: 'inset 3px 0 0 var(--v3-purple, #7c3aed)',
                        }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      onPick({
                        id: c.id,
                        fullName: c.fullName,
                        primaryPhone: primary?.normalizedPhone ?? null,
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
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
                  {isSelected && (
                    <span
                      className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold"
                      style={{
                        background: 'var(--v3-purple, #7c3aed)',
                        color: '#fff',
                      }}
                    >
                      {t('takeaway.customer.selected')}
                    </span>
                  )}
                  <span
                    className="shrink-0 text-[12px] font-medium"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    {t('takeaway.customer.orderCount', { count: c.totalOrders })}
                  </span>
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setHistoryCustomer({ id: c.id, fullName: c.fullName })
                    }
                    aria-label={t('customers.orderHistory.openButton')}
                    title={t('customers.orderHistory.openButton')}
                    className="shrink-0"
                    data-testid="customer-history-button"
                  >
                    <History size={16} />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setEditingCustomer({ id: c.id, fullName: c.fullName })
                    }
                    aria-label={t('customers.editName.button')}
                    title={t('customers.editName.button')}
                    className="shrink-0"
                  >
                    <Pencil size={16} />
                  </Button>
                </div>
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

      <EditCustomerNameDialog
        customer={editingCustomer}
        onOpenChange={(v) => !v && setEditingCustomer(null)}
        isSaving={updateCustomer.isPending}
        onSave={handleSaveName}
      />

      <CustomerOrderHistoryDrawer
        open={historyCustomer !== null}
        onOpenChange={(v) => {
          if (!v) setHistoryCustomer(null);
        }}
        customerId={historyCustomer?.id ?? null}
        customerName={historyCustomer?.fullName ?? null}
      />
    </>
  );
}
