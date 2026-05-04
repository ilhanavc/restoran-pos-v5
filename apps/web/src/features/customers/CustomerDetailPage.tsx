import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Pencil,
  Plus,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import type { CustomerAddress } from '@restoran-pos/shared-types';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { formatTrPhone } from '../../lib/phone';
import { useAuthStore } from '../../store/auth';
import {
  useAddAddress,
  useAddPhone,
  useCustomer,
  useDeleteAddress,
  useDeletePhone,
  useToggleBlacklist,
  useUpdateAddress,
} from './api/customers';
import {
  AddressDrawer,
  type AddressDrawerSubmit,
} from './components/AddressDrawer';

/**
 * Müşteri detay sayfası — ADR-016 §11.
 *
 * Sections:
 *   - Notes (read-only şimdilik)
 *   - Telefonlar: liste + inline ekleme
 *   - Adresler: kart grid + drawer
 *   - Kara liste (sadece admin)
 *   - Son siparişler: PR-9'da bağlanacak (TODO)
 */
export default function CustomerDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const customerQuery = useCustomer(id);
  const addPhone = useAddPhone(id ?? '');
  const deletePhone = useDeletePhone(id ?? '');
  const addAddress = useAddAddress(id ?? '');
  const updateAddress = useUpdateAddress(id ?? '');
  const deleteAddress = useDeleteAddress(id ?? '');
  const toggleBlacklist = useToggleBlacklist();

  const [newPhone, setNewPhone] = useState('');
  const [newPhonePrimary, setNewPhonePrimary] = useState(false);
  const [phoneInlineError, setPhoneInlineError] = useState<string | null>(null);

  const [addressDrawerMode, setAddressDrawerMode] = useState<'create' | 'edit' | null>(
    null,
  );
  const [editAddress, setEditAddress] = useState<CustomerAddress | null>(null);

  const [blacklistReason, setBlacklistReason] = useState('');
  const [showBlacklistForm, setShowBlacklistForm] = useState(false);

  // Inline confirm — silme butonuna ilk tık state set, ikinci tık siler.
  // 5 sn içinde ikinci tık gelmezse otomatik reset.
  const [confirmDeleteAddrId, setConfirmDeleteAddrId] = useState<string | null>(null);
  const [confirmDeletePhoneId, setConfirmDeletePhoneId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmDeleteAddrId) return;
    const handle = setTimeout(() => setConfirmDeleteAddrId(null), 5000);
    return () => clearTimeout(handle);
  }, [confirmDeleteAddrId]);

  useEffect(() => {
    if (!confirmDeletePhoneId) return;
    const handle = setTimeout(() => setConfirmDeletePhoneId(null), 5000);
    return () => clearTimeout(handle);
  }, [confirmDeletePhoneId]);

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { code?: string; message?: string } }
        | undefined;
      const code = data?.error?.code;
      if (code) {
        const localized = t(`customers.errors.${code}`, { defaultValue: '' });
        if (localized) return localized;
      }
      return data?.error?.message ?? fallback;
    }
    return fallback;
  };

  if (customerQuery.isPending) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (customerQuery.isError || !customerQuery.data) {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-destructive">
            {t('customers.errors.loadFailed')}
          </p>
          <Button variant="outline" onClick={() => navigate('/customers')}>
            {t('customers.detail.back')}
          </Button>
        </div>
      </AppShell>
    );
  }

  const customer = customerQuery.data;

  const handleAddPhone = async (e: FormEvent) => {
    e.preventDefault();
    setPhoneInlineError(null);
    if (newPhone.trim().length < 7) {
      setPhoneInlineError(t('customers.detail.errors.phoneRequired'));
      return;
    }
    try {
      await addPhone.mutateAsync({
        rawPhone: newPhone.trim(),
        isPrimary: newPhonePrimary,
      });
      setNewPhone('');
      setNewPhonePrimary(false);
      toast.success(t('customers.detail.phoneAddedSuccess'));
    } catch (err) {
      if (isAxiosError(err)) {
        const code = (err.response?.data as { error?: { code?: string } } | undefined)
          ?.error?.code;
        if (code === 'PHONE_ALREADY_EXISTS') {
          setPhoneInlineError(t('customers.errors.PHONE_ALREADY_EXISTS'));
          return;
        }
      }
      toast.error(extractError(err, t('customers.detail.errors.phoneAddFailed')));
    }
  };

  const handleDeletePhone = async (normalizedPhone: string) => {
    if ((customer.phones ?? []).length <= 1) {
      toast.error(t('customers.detail.errors.lastPhoneCannotDelete'));
      return;
    }
    try {
      await deletePhone.mutateAsync(normalizedPhone);
      setConfirmDeletePhoneId(null);
      toast.success(t('customers.detail.phoneDeletedSuccess'));
    } catch (err) {
      toast.error(extractError(err, t('customers.detail.errors.phoneDeleteFailed')));
    }
  };

  const handleAddressSubmit = async (values: AddressDrawerSubmit) => {
    try {
      if (addressDrawerMode === 'create') {
        await addAddress.mutateAsync(values);
        toast.success(t('customers.address.createSuccess'));
      } else if (addressDrawerMode === 'edit' && editAddress?.id) {
        await updateAddress.mutateAsync({
          addressId: editAddress.id,
          patch: values,
        });
        toast.success(t('customers.address.updateSuccess'));
      }
      setAddressDrawerMode(null);
      setEditAddress(null);
    } catch (err) {
      toast.error(extractError(err, t('customers.address.errors.saveFailed')));
    }
  };

  const handleDeleteAddress = async (addressId: string) => {
    try {
      await deleteAddress.mutateAsync(addressId);
      setConfirmDeleteAddrId(null);
      toast.success(t('customers.address.deleteSuccess'));
    } catch (err) {
      toast.error(extractError(err, t('customers.address.errors.deleteFailed')));
    }
  };

  const handleToggleBlacklist = async () => {
    if (!isAdmin) return;
    try {
      if (customer.isBlacklisted) {
        await toggleBlacklist.mutateAsync({
          id: customer.id,
          payload: { isBlacklisted: false },
        });
        toast.success(t('customers.blacklist.removedSuccess'));
        setShowBlacklistForm(false);
      } else {
        if (blacklistReason.trim().length < 3) {
          toast.error(t('customers.blacklist.reasonRequired'));
          return;
        }
        await toggleBlacklist.mutateAsync({
          id: customer.id,
          payload: {
            isBlacklisted: true,
            blacklistReason: blacklistReason.trim(),
          },
        });
        toast.success(t('customers.blacklist.addedSuccess'));
        setBlacklistReason('');
        setShowBlacklistForm(false);
      }
    } catch (err) {
      toast.error(extractError(err, t('customers.blacklist.errors.saveFailed')));
    }
  };

  return (
    <AppShell>
      <div className="grid grid-cols-[auto_1fr] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
        <button
          type="button"
          onClick={() => navigate('/customers')}
          aria-label={t('customers.detail.back')}
          className="inline-flex h-11 items-center gap-2 rounded-xl px-4 transition-all hover:[background:var(--v3-surface-2)]"
          style={{
            background: 'var(--v3-surface-1)',
            border: '1px solid var(--v3-border-subtle)',
            color: 'var(--v3-text-secondary)',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2} />
          {t('customers.detail.back')}
        </button>
        <h1
          className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {customer.fullName}
        </h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pt-2 pb-6 pl-6 pr-6 space-y-5">
        {customer.isBlacklisted && (
          <div
            className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-bold">{t('customers.blacklist.bannerTitle')}</p>
              {customer.blacklistReason && (
                <p className="mt-1 text-[13px]">{customer.blacklistReason}</p>
              )}
            </div>
          </div>
        )}

        {/* Notes kartı */}
        <section
          className="rounded-md border bg-white p-4"
          style={{ borderColor: 'var(--v3-border-subtle)' }}
        >
          <h2 className="mb-2 text-[14px] font-bold uppercase tracking-wide text-muted-foreground">
            {t('customers.detail.notes')}
          </h2>
          {customer.notes ? (
            <p className="text-sm whitespace-pre-line">{customer.notes}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              {t('customers.detail.noNotes')}
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t('customers.detail.totalOrders', { count: customer.totalOrders })}
          </p>
        </section>

        {/* Telefonlar */}
        <section
          className="rounded-md border bg-white p-4"
          style={{ borderColor: 'var(--v3-border-subtle)' }}
        >
          <h2 className="mb-3 text-[14px] font-bold uppercase tracking-wide text-muted-foreground">
            {t('customers.detail.phones')}
          </h2>
          <ul className="mb-3 space-y-1">
            {(customer.phones ?? []).map((p) => (
              <li
                key={p.normalizedPhone}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--v3-border-subtle)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="tabular-nums font-medium">
                    {formatTrPhone(p.normalizedPhone)}
                  </span>
                  {p.isPrimary && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                      {t('customers.detail.primaryBadge')}
                    </span>
                  )}
                </div>
                {confirmDeletePhoneId === p.normalizedPhone ? (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleDeletePhone(p.normalizedPhone)}
                      aria-label={t('customers.detail.deletePhoneConfirm')}
                      className="inline-flex h-8 items-center justify-center rounded-md bg-red-600 px-2 text-[12px] font-semibold text-white transition-colors hover:bg-red-700"
                      disabled={deletePhone.isPending}
                    >
                      {t('customers.detail.deletePhoneConfirm')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeletePhoneId(null)}
                      aria-label={t('customers.detail.deletePhoneCancel')}
                      className="inline-flex h-8 items-center justify-center rounded-md border px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent"
                    >
                      {t('customers.detail.deletePhoneCancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeletePhoneId(p.normalizedPhone)}
                    aria-label={t('customers.detail.deletePhone')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                    disabled={deletePhone.isPending || (customer.phones ?? []).length <= 1}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>

          <form onSubmit={handleAddPhone} className="flex flex-wrap items-center gap-2">
            <Input
              type="tel"
              inputMode="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder={t('customers.detail.addPhonePlaceholder')}
              className="h-9 max-w-[200px]"
              disabled={addPhone.isPending}
            />
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
              <input
                type="checkbox"
                checked={newPhonePrimary}
                onChange={(e) => setNewPhonePrimary(e.target.checked)}
                disabled={addPhone.isPending}
                className="h-5 w-5"
              />
              {t('customers.detail.markAsPrimary')}
            </label>
            <Button
              type="submit"
              size="sm"
              disabled={addPhone.isPending}
              className="gap-1"
            >
              {addPhone.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              {t('customers.detail.addPhone')}
            </Button>
          </form>
          {phoneInlineError && (
            <p className="mt-2 text-[12px] text-destructive">{phoneInlineError}</p>
          )}
        </section>

        {/* Adresler */}
        <section
          className="rounded-md border bg-white p-4"
          style={{ borderColor: 'var(--v3-border-subtle)' }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-bold uppercase tracking-wide text-muted-foreground">
              {t('customers.detail.addresses')}
            </h2>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEditAddress(null);
                setAddressDrawerMode('create');
              }}
              className="gap-1"
            >
              <Plus size={14} />
              {t('customers.detail.addAddress')}
            </Button>
          </div>

          {(customer.addresses ?? []).length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              {t('customers.detail.noAddresses')}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(customer.addresses ?? []).map((a) => (
                <div
                  key={a.id ?? a.addressLine}
                  className="rounded-md border p-3 text-sm"
                  style={{ borderColor: 'var(--v3-border-subtle)' }}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{a.title}</span>
                      {a.isDefault && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                          {t('customers.address.defaultBadge')}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditAddress(a);
                          setAddressDrawerMode('edit');
                        }}
                        aria-label={t('customers.address.edit')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Pencil size={14} />
                      </button>
                      {a.id && confirmDeleteAddrId === a.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => a.id && handleDeleteAddress(a.id)}
                            aria-label={t('customers.detail.deleteAddressConfirm')}
                            className="inline-flex h-8 items-center justify-center rounded-md bg-red-600 px-2 text-[12px] font-semibold text-white transition-colors hover:bg-red-700"
                            disabled={deleteAddress.isPending}
                          >
                            {t('customers.detail.deleteAddressConfirm')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteAddrId(null)}
                            aria-label={t('customers.detail.deleteAddressCancel')}
                            className="inline-flex h-8 items-center justify-center rounded-md border px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent"
                          >
                            {t('customers.detail.deleteAddressCancel')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => a.id && setConfirmDeleteAddrId(a.id)}
                          aria-label={t('customers.address.delete')}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                          disabled={deleteAddress.isPending}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="whitespace-pre-line text-[13px]">{a.addressLine}</p>
                  {(a.district || a.neighborhood) && (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {[a.neighborhood, a.district].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {a.addressNote && (
                    <p
                      className="mt-1 text-[12px]"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {a.addressNote}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Kara liste — sadece admin */}
        {isAdmin && (
          <section
            className="rounded-md border bg-white p-4"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <h2 className="mb-3 flex items-center gap-2 text-[14px] font-bold uppercase tracking-wide text-muted-foreground">
              <ShieldOff size={16} />
              {t('customers.blacklist.section')}
            </h2>

            {customer.isBlacklisted ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('customers.blacklist.activeBody')}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleToggleBlacklist}
                  disabled={toggleBlacklist.isPending}
                >
                  {toggleBlacklist.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t('customers.blacklist.removeButton')}
                </Button>
              </div>
            ) : showBlacklistForm ? (
              <div className="space-y-3">
                <textarea
                  value={blacklistReason}
                  onChange={(e) => setBlacklistReason(e.target.value)}
                  placeholder={t('customers.blacklist.reasonPlaceholder')}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  disabled={toggleBlacklist.isPending}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowBlacklistForm(false);
                      setBlacklistReason('');
                    }}
                    disabled={toggleBlacklist.isPending}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleToggleBlacklist}
                    disabled={
                      toggleBlacklist.isPending || blacklistReason.trim().length < 3
                    }
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    {toggleBlacklist.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {t('customers.blacklist.confirmAdd')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowBlacklistForm(true)}
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                {t('customers.blacklist.addButton')}
              </Button>
            )}
          </section>
        )}

        {/* Son siparişler tablosu — backend endpoint (orders by customer_id) hazırlandığında PR-9 kapsamında eklenecek. */}
      </div>

      <AddressDrawer
        open={addressDrawerMode !== null}
        onOpenChange={(v) => {
          if (!v) {
            setAddressDrawerMode(null);
            setEditAddress(null);
          }
        }}
        mode={addressDrawerMode ?? 'create'}
        existingAddress={editAddress}
        isSubmitting={addAddress.isPending || updateAddress.isPending}
        onSubmit={handleAddressSubmit}
      />
    </AppShell>
  );
}
