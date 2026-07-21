import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Info,
  Loader2,
  Pencil,
  Printer,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { KITCHEN_STATION_KINDS } from '@restoran-pos/shared-types';
import { AppShell } from '../../components/layout/AppShell';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/button';
import { useCategoriesAdmin } from './menu-categories/api';
import {
  usePrinters,
  useUpdatePrinter,
  useAssignPrinterCategories,
  type PrinterDto,
} from './printers/api';
import { RenamePrinterDialog } from './printers/components/RenamePrinterDialog';
import { StationAssignmentDialog } from './printers/components/StationAssignmentDialog';

/**
 * Yazıcılar admin sayfası — ADR-032 Amendment 2, Dilim A (görünürlük) +
 * Dilim B (istasyon atama paneli).
 *
 * Backend: apps/api/src/routes/printers.ts (yalnız admin).
 * Tazeleme: 10 sn react-query polling (ADR K10); yeni Socket.IO olayı YOK.
 *
 * DİL KURALI: kullanıcıya "yazıcı" denir; "agent" kelimesi bu ekranda GEÇMEZ.
 *
 * Kapsam dışı (cutover sonrası): yazıcı ekleme + kurulum komutu üretimi +
 * devre dışı bırakma/geri alma (Dilim D) · test baskısı (Dilim E) ·
 * "mutfağa gider mi" anahtarı (Dilim C — Menü Tanımları'nda yaşayacak).
 */

/** Durum rozeti renkleri (K10). */
function statusColors(status: PrinterDto['status']): {
  bg: string;
  fg: string;
} {
  switch (status) {
    case 'online':
      return { bg: '#dcfce7', fg: '#166534' };
    case 'delayed':
      return { bg: '#fef3c7', fg: '#92400e' };
    case 'offline':
      return { bg: '#fee2e2', fg: '#991b1b' };
    case 'disabled':
      return { bg: '#e5e7eb', fg: '#4b5563' };
    case 'pending':
      return { bg: '#dbeafe', fg: '#1e40af' };
  }
}

export default function PrintersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const printersQuery = usePrinters();
  const categoriesQuery = useCategoriesAdmin();
  const updatePrinter = useUpdatePrinter();
  const assignCategories = useAssignPrinterCategories();

  const [renameTarget, setRenameTarget] = useState<PrinterDto | null>(null);
  const [assignTarget, setAssignTarget] = useState<{
    printer: PrinterDto;
    stationKind: string;
  } | null>(null);

  const printers = printersQuery.data?.printers ?? [];
  const orphanKinds = printersQuery.data?.orphanKinds ?? [];
  const categories = categoriesQuery.data ?? [];

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { code?: string } }
        | undefined;
      const code = data?.error?.code;
      if (code) {
        const localized = t(`admin.printers.errors.${code}`, {
          defaultValue: '',
        });
        if (localized) return localized;
      }
    }
    return fallback;
  };

  /** Etiket yoksa cihaz kimliğine düş (K1). */
  const printerLabel = (p: PrinterDto): string =>
    p.displayName ?? p.deviceFingerprint;

  const stationLabel = (kind: string): string =>
    t(`admin.printers.stations.${kind}`, { defaultValue: kind });

  const lastSeenLabel = (iso: string | null): string => {
    if (iso === null) return t('admin.printers.lastSeen.never');
    const diffSec = Math.max(
      0,
      Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
    );
    if (diffSec < 60) return t('admin.printers.lastSeen.justNow');
    const minutes = Math.floor(diffSec / 60);
    if (minutes < 60) return t('admin.printers.lastSeen.minutes', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('admin.printers.lastSeen.hours', { count: hours });
    return t('admin.printers.lastSeen.days', { count: Math.floor(hours / 24) });
  };

  /** Bu yazıcının atama paneli açılabilen mutfak istasyonları (bill hariç). */
  const kitchenStationsOf = (p: PrinterDto): string[] =>
    (p.declaredKinds ?? []).filter((k) =>
      (KITCHEN_STATION_KINDS as readonly string[]).includes(k),
    );

  const handleRename = async (displayName: string) => {
    if (!renameTarget) return;
    try {
      await updatePrinter.mutateAsync({ id: renameTarget.id, displayName });
      toast.success(t('admin.printers.rename.success'));
      setRenameTarget(null);
    } catch (err) {
      toast.error(extractError(err, t('admin.printers.errors.saveFailed')));
    }
  };

  const handleAssign = async (categoryIds: string[]) => {
    if (!assignTarget) return;
    try {
      const result = await assignCategories.mutateAsync({
        printerId: assignTarget.printer.id,
        stationKind: assignTarget.stationKind,
        categoryIds,
      });
      toast.success(
        t('admin.printers.assign.success', {
          added: result.addedCount,
          removed: result.removedCount,
        }),
      );
      setAssignTarget(null);
    } catch (err) {
      toast.error(extractError(err, t('admin.printers.errors.saveFailed')));
    }
  };

  return (
    <AppShell>
      <PageHeader
        title={t('admin.printers.title')}
        actions={
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            aria-label={t('admin.printers.back')}
            className="tables-action-btn inline-flex h-11 items-center gap-2 rounded-xl px-4 transition-all duration-[120ms] hover:[background:var(--v3-surface-2)] hover:[color:var(--v3-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
            style={{
              background: 'var(--v3-surface-1)',
              border: '1px solid var(--v3-border-subtle)',
              color: 'var(--v3-text-secondary)',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2} />
            {t('admin.printers.back')}
          </button>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6">
        {/* Yetim kuyruk uyarı bandı — bu ekranın en yüksek operasyonel değeri. */}
        {orphanKinds.length > 0 && (
          <div
            data-testid="orphan-queue-banner"
            className="mb-4 flex items-start gap-2 rounded-md p-3 text-sm"
            style={{ background: '#fee2e2', color: '#991b1b' }}
          >
            <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" />
            <div>
              <p className="font-semibold">
                {t('admin.printers.orphanBanner.title')}
              </p>
              <p>
                {t('admin.printers.orphanBanner.body', {
                  stations: orphanKinds.map(stationLabel).join(', '),
                })}
              </p>
            </div>
          </div>
        )}

        {/* Fiziksel ayarlar bulutta DEĞİL — dürüstlük notu (K1). */}
        <div
          className="mb-4 flex items-start gap-2 rounded-md p-3 text-[13px]"
          style={{ background: 'var(--v3-surface-1)', color: 'var(--v3-text-secondary)' }}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('admin.printers.physicalSettingsNote')}</span>
        </div>

        {printersQuery.isPending && (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2
              className="h-6 w-6 animate-spin"
              style={{ color: 'var(--v3-text-muted)' }}
            />
          </div>
        )}

        {printersQuery.isError && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-danger, #dc2626)',
              color: 'var(--v3-danger, #dc2626)',
            }}
          >
            {t('admin.printers.errors.loadFailed')}
          </div>
        )}

        {printersQuery.isSuccess && printers.length === 0 && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-muted)',
            }}
          >
            {t('admin.printers.empty')}
          </div>
        )}

        {printersQuery.isSuccess && printers.length > 0 && (
          <div className="space-y-3">
            {printers.map((p) => {
              const colors = statusColors(p.status);
              const stations = kitchenStationsOf(p);
              const failedTotal = p.queueDepths.reduce(
                (s, q) => s + q.failed,
                0,
              );
              const queuedTotal = p.queueDepths.reduce(
                (s, q) => s + q.queued,
                0,
              );

              return (
                <div
                  key={p.id}
                  data-testid="printer-row"
                  className="rounded-md border bg-white p-4"
                  style={{ borderColor: 'var(--v3-border-subtle)' }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Printer
                          className="h-[18px] w-[18px] shrink-0"
                          style={{ color: 'var(--v3-text-muted)' }}
                        />
                        <span className="truncate text-[15px] font-semibold">
                          {printerLabel(p)}
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                          style={{ background: colors.bg, color: colors.fg }}
                        >
                          {t(`admin.printers.status.${p.status}`)}
                        </span>
                        {p.filterless && (
                          <span
                            data-testid="filterless-chip"
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ background: '#fef3c7', color: '#92400e' }}
                          >
                            {t('admin.printers.filterlessChip')}
                          </span>
                        )}
                        {failedTotal > 0 && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ background: '#fee2e2', color: '#991b1b' }}
                          >
                            {t('admin.printers.failedChip', {
                              count: failedTotal,
                            })}
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {t('admin.printers.deviceIdLabel')}: {p.deviceFingerprint}
                      </p>
                      {/* Son görülme + kuyruk = arıza gecesinin BİRİNCİL
                          teşhis verisi ("kaç iş bekliyor, yazıcı ne zaman
                          görüldü"). İkincil/muted tonda 12px değil, okunur
                          punto ve ana metin renginde (pos-checklist: kritik
                          metin küçültülmez). */}
                      <p className="text-[13px] text-foreground">
                        {t('admin.printers.lastSeenLabel')}:{' '}
                        {lastSeenLabel(p.lastSeenAt)}
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        {t('admin.printers.jobTypesLabel')}:{' '}
                        {p.declaredKinds === null
                          ? t('admin.printers.jobTypesUnknown')
                          : p.declaredKinds.map(stationLabel).join(', ')}
                      </p>
                      <p className="text-[13px] text-foreground">
                        {t('admin.printers.queueLabel', {
                          queued: queuedTotal,
                          failed: failedTotal,
                        })}
                        {stations.length > 0 &&
                          ` · ${t('admin.printers.assignedCategoriesLabel', {
                            count: p.assignedCategoryCount,
                          })}`}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 gap-1.5"
                        onClick={() => setRenameTarget(p)}
                      >
                        <Pencil size={16} />
                        {t('admin.printers.actions.rename')}
                      </Button>
                      {/* Kategori paneli YALNIZ mutfak istasyonlarında — kasa
                          yazıcısında hiç görünmez (K3). */}
                      {stations.map((kind) => (
                        <Button
                          key={kind}
                          type="button"
                          className="h-11 gap-1.5"
                          onClick={() =>
                            setAssignTarget({ printer: p, stationKind: kind })
                          }
                        >
                          <SlidersHorizontal size={16} />
                          {t('admin.printers.actions.assignCategories', {
                            station: stationLabel(kind),
                          })}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RenamePrinterDialog
        open={renameTarget !== null}
        onOpenChange={(v) => !v && setRenameTarget(null)}
        fallbackLabel={renameTarget?.deviceFingerprint ?? ''}
        initialName={renameTarget?.displayName ?? null}
        isSubmitting={updatePrinter.isPending}
        onConfirm={handleRename}
      />

      {assignTarget !== null && (
        <StationAssignmentDialog
          open
          onOpenChange={(v) => !v && setAssignTarget(null)}
          printerLabel={printerLabel(assignTarget.printer)}
          stationKind={assignTarget.stationKind}
          categories={categories}
          isSubmitting={assignCategories.isPending}
          onSubmit={handleAssign}
        />
      )}
    </AppShell>
  );
}
