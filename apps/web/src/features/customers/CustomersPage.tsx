import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { formatTrPhone } from '../../lib/phone';
import {
  useSearchCustomers,
  useCreateCustomer,
} from './api/customers';
import {
  NewCustomerDrawer,
  type NewCustomerDrawerSubmit,
} from './components/NewCustomerDrawer';

/**
 * Müşteri liste + arama sayfası — ADR-016 §11.
 *
 * Query params:
 *   - ?new=1            → drawer otomatik açık
 *   - ?phone=05XX...    → drawer phone prefill (Caller ID yönlendirmesi)
 */
export default function CustomersPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const initialPhoneFromUrl = searchParams.get('phone') ?? undefined;
  const newFlag = searchParams.get('new') === '1';

  // ?new=1 ile gelirse drawer'ı tetikle (tek seferlik).
  useEffect(() => {
    if (newFlag) {
      setDrawerOpen(true);
    }
  }, [newFlag]);

  // Debounce 300ms.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const searchQuery = useSearchCustomers(debouncedSearch, 20);
  const createCustomer = useCreateCustomer();

  const customers = useMemo(
    () => searchQuery.data?.customers ?? [],
    [searchQuery.data],
  );

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

  const handleCreateSubmit = async (values: NewCustomerDrawerSubmit) => {
    setPhoneError(null);
    try {
      const created = await createCustomer.mutateAsync({
        fullName: values.fullName,
        notes: values.notes,
        phones: [{ rawPhone: values.rawPhone, isPrimary: true }],
        addresses: values.address ? [values.address] : [],
      });
      toast.success(t('customers.createSuccess'));
      setDrawerOpen(false);
      // URL temizle
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      next.delete('phone');
      setSearchParams(next, { replace: true });
      navigate(`/customers/${created.id}`);
    } catch (err) {
      if (isAxiosError(err)) {
        const code = (err.response?.data as { error?: { code?: string } } | undefined)
          ?.error?.code;
        if (code === 'PHONE_ALREADY_EXISTS') {
          setPhoneError(t('customers.errors.PHONE_ALREADY_EXISTS'));
          return;
        }
      }
      toast.error(extractError(err, t('customers.errors.createFailed')));
    }
  };

  const handleCloseDrawer = (open: boolean) => {
    setDrawerOpen(open);
    if (!open) {
      setPhoneError(null);
      const next = new URLSearchParams(searchParams);
      if (next.has('new') || next.has('phone')) {
        next.delete('new');
        next.delete('phone');
        setSearchParams(next, { replace: true });
      }
    }
  };

  const showEmptyInitial = debouncedSearch.length === 0;
  const showNoResults =
    !showEmptyInitial && searchQuery.isSuccess && customers.length === 0;
  const showResults =
    !showEmptyInitial && searchQuery.isSuccess && customers.length > 0;

  return (
    <AppShell>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
        <h1
          className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('customers.title')}
        </h1>
        <Button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="gap-1.5"
        >
          <Plus size={16} />
          {t('customers.newButton')}
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6">
        <div className="mb-4 relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--v3-text-muted)' }}
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('customers.searchPlaceholder')}
            className="h-10 pl-9"
            aria-label={t('customers.searchPlaceholder')}
          />
        </div>

        {searchQuery.isFetching && debouncedSearch.length > 0 && (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {showEmptyInitial && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-muted)',
            }}
          >
            <p className="mb-3">{t('customers.empty')}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDrawerOpen(true)}
            >
              {t('customers.emptyCta')}
            </Button>
          </div>
        )}

        {showNoResults && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-muted)',
            }}
          >
            {t('customers.noResults')}
          </div>
        )}

        {showResults && (
          <div
            className="overflow-hidden rounded-md border bg-white"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            {customers.map((c) => {
              const primaryPhone = c.phones.find((p) => p.isPrimary) ?? c.phones[0];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => navigate(`/customers/${c.id}`)}
                  className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 border-b px-4 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-stone-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
                  style={{ borderColor: 'var(--v3-border-subtle)' }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {c.isBlacklisted && (
                        <span
                          aria-label={t('customers.blacklisted')}
                          title={t('customers.blacklisted')}
                          className="h-2 w-2 rounded-full bg-red-500"
                        />
                      )}
                      <span className="font-bold">{c.fullName}</span>
                    </div>
                    <div
                      className="mt-0.5 text-[13px] tabular-nums"
                      style={{ color: 'var(--v3-text-secondary)' }}
                    >
                      {primaryPhone ? formatTrPhone(primaryPhone.normalizedPhone) : ''}
                    </div>
                  </div>
                  <div
                    className="text-[12px]"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    {t('customers.totalOrdersBadge', { count: c.totalOrders })}
                  </div>
                  <div
                    className="text-[12px] font-medium"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    →
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <NewCustomerDrawer
        open={drawerOpen}
        onOpenChange={handleCloseDrawer}
        initialPhone={initialPhoneFromUrl}
        isSubmitting={createCustomer.isPending}
        phoneError={phoneError}
        onSubmit={handleCreateSubmit}
      />
    </AppShell>
  );
}
