import { useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import * as XLSX from 'xlsx';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ImportRow,
  ImportPreviewResponse,
  ImportPreviewRow,
  ImportSkipReason,
} from '@restoran-pos/shared-types';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { usePreviewImport, useCommitImport, CUSTOMERS_KEY } from '../api/customers';

interface ImportDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Excel ile toplu müşteri içe aktarma drawer (2 adım: dosya seç → önizleme).
 *
 * Parse: SheetJS, ilk sayfa, defval=''. Telefon Excel'de float64 olabileceği için
 * `String(v).split('.')[0]` ile düzelt. Kolon mapping insan-okur Türkçe başlıklar:
 *   - Ad Soyad   → fullName (zorunlu)
 *   - Telefon    → phone
 *   - Mahalle    → neighborhood
 *   - Adres      → address
 *   - No         → legacyV3No
 *
 * Backend dedupe + validate yapar; biz sadece preview'u tablo olarak gösteririz.
 */
export function ImportDrawer({ open, onOpenChange }: ImportDrawerProps): JSX.Element {
  const { t } = useTranslation();
  const previewMutation = usePreviewImport();
  const commitMutation = useCommitImport();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<'pick' | 'preview'>('pick');
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const reset = () => {
    setStep('pick');
    setPreview(null);
    setParsing(false);
    setPage(1);
    previewMutation.reset();
    commitMutation.reset();
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const cellToString = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v).split('.')[0] ?? '';
    return String(v).trim();
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error('empty');
      const sheet = wb.Sheets[firstSheet];
      if (!sheet) throw new Error('empty');
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
      });

      const rows: ImportRow[] = json
        .map((raw, idx): ImportRow | null => {
          const fullName = cellToString(raw['Ad Soyad'] ?? raw['ad soyad'] ?? raw['AD SOYAD']);
          if (!fullName) return null;
          const phone = cellToString(raw['Telefon'] ?? raw['telefon'] ?? raw['TELEFON']);
          const neighborhood = cellToString(raw['Mahalle'] ?? raw['mahalle']);
          const address = cellToString(raw['Adres'] ?? raw['adres'] ?? raw['ADRES']);
          const legacyV3No = cellToString(raw['No'] ?? raw['no'] ?? raw['NO']);
          return {
            rowNumber: idx + 2, // +1 header, +1 1-based
            fullName,
            phone: phone || null,
            address: address || null,
            neighborhood: neighborhood || null,
            legacyV3No: legacyV3No || null,
          };
        })
        .filter((r): r is ImportRow => r !== null);

      if (rows.length === 0) {
        toast.error(t('customers.import.errors.emptyFile'));
        setParsing(false);
        e.target.value = '';
        return;
      }

      const result = await previewMutation.mutateAsync(rows);
      setPreview(result);
      setStep('preview');
      setPage(1);
    } catch (err) {
      const code = isAxiosError(err)
        ? ((err.response?.data as { error?: { code?: string } } | undefined)?.error?.code ?? null)
        : null;
      const localized = code
        ? t(`customers.import.errors.${code}`, { defaultValue: '' })
        : '';
      toast.error(localized || t('customers.import.errors.parseFailed'));
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    try {
      const result = await commitMutation.mutateAsync(preview.previewToken);
      toast.success(
        t('customers.import.commitSuccess', { count: result.created }),
      );
      handleClose(false);
    } catch (err) {
      // Backend success dönmüş olabilir (timeout / network drop), import kayıt
      // edilmiş olabilir. Listeyi yenile + drawer'ı kapat, uyarı ver.
      const isNetwork =
        isAxiosError(err) &&
        (!err.response || err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK');
      const code = isAxiosError(err)
        ? ((err.response?.data as { error?: { code?: string } } | undefined)?.error?.code ?? null)
        : null;
      const localized = code
        ? t(`customers.import.errors.${code}`, { defaultValue: '' })
        : '';
      if (isNetwork) {
        toast.warning(t('customers.import.commitMaybeSucceeded'), {
          action: {
            label: t('customers.refresh'),
            onClick: () => {
              void queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
            },
          },
        });
        handleClose(false);
        return;
      }
      toast.error(localized || t('customers.import.errors.commitFailed'));
    }
  };

  const visibleRows = useMemo(() => {
    if (!preview) return [];
    const start = (page - 1) * PAGE_SIZE;
    return preview.rows.slice(start, start + PAGE_SIZE);
  }, [preview, page]);

  const totalPages = preview ? Math.max(1, Math.ceil(preview.rows.length / PAGE_SIZE)) : 1;

  const renderStatus = (row: ImportPreviewRow): JSX.Element => {
    if (row.status === 'create') {
      return (
        <span className="inline-block rounded px-2 py-0.5 text-[11px] font-medium bg-emerald-100 text-emerald-700">
          {t('customers.import.status.create')}
        </span>
      );
    }
    return (
      <span className="inline-block rounded px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-700">
        {t('customers.import.status.skip')}
      </span>
    );
  };

  const renderReason = (reason: ImportSkipReason | undefined): string => {
    if (!reason) return '';
    return t(`customers.import.skipReason.${reason}`);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {step === 'pick'
              ? t('customers.import.pickTitle')
              : t('customers.import.previewTitle')}
          </DialogTitle>
        </DialogHeader>

        {step === 'pick' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('customers.import.pickHint')}
            </p>
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-12 text-sm transition-colors hover:bg-stone-50"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              <Upload size={28} className="text-muted-foreground" />
              <span className="font-medium">
                {parsing || previewMutation.isPending
                  ? t('customers.import.parsing')
                  : t('customers.import.pickButton')}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('customers.import.pickAccept')}
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={parsing || previewMutation.isPending}
                onChange={(e) => {
                  void handleFile(e);
                }}
              />
            </label>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700">
                {t('customers.import.summaryCreate', {
                  count: preview.summary.willCreate,
                })}
              </span>
              <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">
                {t('customers.import.summarySkip', {
                  count: preview.summary.willSkip,
                })}
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                {t('customers.import.summaryTotal', {
                  count: preview.summary.total,
                })}
              </span>
            </div>

            <div
              className="max-h-[420px] overflow-auto rounded-md border bg-white"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-stone-50 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">
                      {t('customers.import.col.status')}
                    </th>
                    <th className="px-3 py-2 text-left">
                      {t('customers.import.col.name')}
                    </th>
                    <th className="px-3 py-2 text-left">
                      {t('customers.import.col.phone')}
                    </th>
                    <th className="px-3 py-2 text-left">
                      {t('customers.import.col.reason')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr key={r.rowNumber} className="border-t" style={{ borderColor: 'var(--v3-border-subtle)' }}>
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                        {r.rowNumber}
                      </td>
                      <td className="px-3 py-1.5">{renderStatus(r)}</td>
                      <td className="px-3 py-1.5">{r.fullName}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {r.normalizedPhone ?? ''}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {renderReason(r.reason)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('customers.import.prevPage')}
                </Button>
                <span className="text-muted-foreground">
                  {t('customers.import.pageInfo', { page, total: totalPages })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('customers.import.nextPage')}
                </Button>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'pick' && (
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>
              {t('common.cancel')}
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('pick')}
                disabled={commitMutation.isPending}
              >
                {t('customers.import.back')}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  void handleCommit();
                }}
                disabled={commitMutation.isPending || !preview || preview.summary.willCreate === 0}
                className="gap-2"
              >
                {commitMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('customers.import.confirm')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
