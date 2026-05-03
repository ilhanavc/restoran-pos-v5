import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Loader2, Plus, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import type { CustomerExportRow } from '@restoran-pos/shared-types';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { formatTrPhone } from '../../lib/phone';
import {
  useBulkDelete,
  useCustomerList,
  useExportCustomers,
  useSearchCustomers,
  useCreateCustomer,
} from './api/customers';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  NewCustomerDrawer,
  type NewCustomerDrawerSubmit,
} from './components/NewCustomerDrawer';
import { ImportDrawer } from './components/ImportDrawer';

interface ListItem {
  id: string;
  fullName: string;
  phones: { normalizedPhone: string; isPrimary: boolean }[];
  totalOrders: number;
  isBlacklisted: boolean;
}

/**
 * Müşteri liste sayfası — v3 paritesi (kart layout + avatar pill + load more).
 *
 * Davranış:
 * - search varsa → /customers/search (debounced 300ms)
 * - search yoksa → /customers?page=N (50/sayfa, "Daha Fazla" sonraki sayfayı çekip listeyi büyütür)
 * - Header sağ: Dışa Aktar / Excel'den İçe Aktar / Yeni Müşteri
 *
 * Query params: ?new=1, ?phone=05XX (Caller ID).
 */
export default function CustomersPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<ListItem[]>([]);
  // PR-8c-3d — toplu seçim (HARD DELETE).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const initialPhoneFromUrl = searchParams.get('phone') ?? undefined;
  const newFlag = searchParams.get('new') === '1';

  useEffect(() => {
    if (newFlag) setDrawerOpen(true);
  }, [newFlag]);

  // Debounce 300ms.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  // search değiştiğinde liste sıfırlansın
  useEffect(() => {
    setPage(1);
    setAccumulated([]);
  }, [debouncedSearch]);

  const searchActive = debouncedSearch.length > 0;

  const searchQuery = useSearchCustomers(debouncedSearch, 50);
  const listQuery = useCustomerList(searchActive ? 1 : page, 50);
  const exportMutation = useExportCustomers();
  const createCustomer = useCreateCustomer();
  const bulkDelete = useBulkDelete();

  // Page query başarıyla geldiğinde accumulated'a ekle (search kapalıysa)
  useEffect(() => {
    if (searchActive) return;
    if (!listQuery.data) return;
    setAccumulated((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const merged = [...prev];
      for (const c of listQuery.data.customers) {
        if (!existingIds.has(c.id)) merged.push(c);
      }
      return merged;
    });
  }, [listQuery.data, searchActive]);

  const customers: ListItem[] = useMemo(() => {
    if (searchActive) return searchQuery.data?.customers ?? [];
    return accumulated;
  }, [searchActive, searchQuery.data, accumulated]);

  const total = searchActive
    ? customers.length
    : (listQuery.data?.total ?? 0);

  const canLoadMore = !searchActive && customers.length < total;

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

  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync();
      const csv = buildCsv(result.customers);
      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `musteriler-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t('customers.exportSuccess', { count: result.total }));
    } catch (err) {
      toast.error(extractError(err, t('customers.errors.exportFailed')));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const allVisibleSelected =
    customers.length > 0 && customers.every((c) => selectedIds.has(c.id));

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const c of customers) next.delete(c.id);
        return next;
      }
      const next = new Set(prev);
      for (const c of customers) next.add(c.id);
      return next;
    });
  };

  const handleBulkDeleteConfirm = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setConfirmOpen(false);
      return;
    }
    try {
      const result = await bulkDelete.mutateAsync(ids);
      setConfirmOpen(false);
      clearSelection();
      // Liste re-fetch sonrası accumulated'da silinenler kalmasın.
      setAccumulated((prev) => prev.filter((c) => !selectedIds.has(c.id)));
      toast.success(
        t('customers.bulkDeleteSuccess', { count: result.deleted }),
      );
    } catch (err) {
      toast.error(extractError(err, t('customers.bulkDeleteFailed')));
    }
  };

  const isLoadingFirstPage =
    !searchActive && listQuery.isLoading && accumulated.length === 0;

  const showEmpty = !searchActive && !listQuery.isLoading && customers.length === 0;
  const showNoResults =
    searchActive && searchQuery.isSuccess && customers.length === 0;

  return (
    <AppShell>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
        <h1
          className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('customers.title')}
        </h1>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void handleExport();
            }}
            disabled={exportMutation.isPending}
            className="gap-1.5"
          >
            {exportMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            {exportMutation.isPending
              ? t('customers.exporting')
              : t('customers.exportButton')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="gap-1.5"
          >
            <Upload size={16} />
            {t('customers.importButton')}
          </Button>
          <Button type="button" onClick={() => setDrawerOpen(true)} className="gap-1.5">
            <Plus size={16} />
            {t('customers.newButton')}
          </Button>
        </div>
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

        {(isLoadingFirstPage || (searchQuery.isFetching && searchActive)) && (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {showEmpty && (
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

        {customers.length > 0 && selectedIds.size > 0 && (
          <div
            className="mb-3 flex items-center justify-between rounded-md border px-3 py-2"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              background: '#FEF3F2',
            }}
          >
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">
                {t('customers.selectedCount', { count: selectedIds.size })}
              </span>
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs underline"
                style={{ color: 'var(--v3-text-secondary)' }}
              >
                {t('customers.clearSelection')}
              </button>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={bulkDelete.isPending}
              className="gap-1.5"
            >
              {bulkDelete.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t('customers.deleteSelected')}
            </Button>
          </div>
        )}

        {customers.length > 0 && (
          <div className="space-y-2">
            {customers.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 px-2 pb-1 text-xs"
                style={{ color: 'var(--v3-text-muted)' }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  className="h-4 w-4 cursor-pointer accent-orange-500"
                  aria-label={t('customers.selectAll')}
                />
                <span>{t('customers.selectAll')}</span>
              </label>
            )}
            {customers.map((c) => {
              const primaryPhone =
                c.phones.find((p) => p.isPrimary) ?? c.phones[0];
              const isSelected = selectedIds.has(c.id);
              return (
                <div
                  key={c.id}
                  className="grid w-full grid-cols-[auto_auto_1fr_auto] items-center gap-3 rounded-md border bg-white px-4 py-3 text-left text-sm transition-colors hover:bg-stone-50/40"
                  style={{
                    borderColor: isSelected
                      ? '#DC2626'
                      : 'var(--v3-border-subtle)',
                    borderLeft: c.isBlacklisted
                      ? '4px solid #DC2626'
                      : undefined,
                    background: isSelected ? '#FEF3F2' : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleSelect(c.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-5 w-5 cursor-pointer accent-orange-500"
                    aria-label={t('customers.selectAll')}
                  />
                  <button
                    type="button"
                    onClick={() => navigate(`/customers/${c.id}`)}
                    className="contents text-left focus-visible:outline-none"
                  >
                    <CustomerAvatar name={c.fullName} />
                    <div className="min-w-0">
                      <div className="font-bold text-[15px] truncate">
                        {c.fullName}
                      </div>
                      <div
                        className="mt-0.5 text-[13px] tabular-nums"
                        style={{ color: 'var(--v3-text-secondary)' }}
                      >
                        {primaryPhone
                          ? formatTrPhone(primaryPhone.normalizedPhone)
                          : ''}
                      </div>
                    </div>
                    <div
                      className="text-[12px] whitespace-nowrap"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {t('customers.orderCount', { count: c.totalOrders })}
                    </div>
                  </button>
                </div>
              );
            })}

            {!searchActive && (
              <div className="flex flex-col items-center gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canLoadMore || listQuery.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                  className="gap-2"
                >
                  {listQuery.isFetching && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {t('customers.loadMore')}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t('customers.countSuffix', {
                    shown: customers.length,
                    total,
                  })}
                </span>
              </div>
            )}
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

      <ImportDrawer open={importOpen} onOpenChange={setImportOpen} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('customers.deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('customers.deleteConfirmBody', { count: selectedIds.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={bulkDelete.isPending}
            >
              {t('customers.deleteConfirmCancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void handleBulkDeleteConfirm();
              }}
              disabled={bulkDelete.isPending}
              className="gap-1.5"
            >
              {bulkDelete.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t('customers.deleteConfirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

/**
 * v3 paritesi: 56x56 yuvarlak avatar, mor tema. İsim boşsa "0" harfi.
 */
function CustomerAvatar({ name }: { name: string }): JSX.Element {
  const trimmed = name.trim();
  const initial = trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '0';
  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: '#EEEAFE',
        color: '#6C63FF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        fontWeight: 700,
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

/**
 * Basit CSV serializer — kaçış: çift tırnak iki katlanır, virgül/satırsonu
 * içeren alanlar tırnak içine alınır. RFC 4180 yeterli alt küme.
 */
function buildCsv(rows: CustomerExportRow[]): string {
  const headers = [
    'Ad Soyad',
    'Birincil Telefon',
    'Tum Telefonlar',
    'Adresler',
    'Toplam Siparis',
    'Kara Liste',
    'Olusturma',
  ];
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.fullName,
        r.primaryPhone ?? '',
        r.phones.join(' | '),
        r.addresses.join(' | '),
        String(r.totalOrders),
        r.isBlacklisted ? 'Evet' : 'Hayir',
        r.createdAt,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\r\n');
}

function csvEscape(v: string): string {
  if (v === '') return '';
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
