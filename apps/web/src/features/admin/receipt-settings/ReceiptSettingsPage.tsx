import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Info, Loader2, Printer, RotateCcw, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { RECEIPT_TEXT_LIMITS, type ReceiptSettings } from '@restoran-pos/shared-types';
import { AppShell } from '../../../components/layout/AppShell';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { PrintTargetDialog } from '../../orders/components/PrintTargetDialog';
import { ReceiptLinesEditor, receiptLineError } from './ReceiptLinesEditor';
import { useReceiptSettings, useReceiptTestPrint, useUpdateReceiptSettings } from './api';

/**
 * Fiş Ayarları — ADR-045 K7 (PR-2b). Yalnız admin (rota + kenar çubuğu + API).
 *
 * Seviye 1: tek form — üst bilgi satırları, alt bilgi (varsayılan / kendi
 * metni / hiç), paket fişi otomatik baskı anahtarı, durum cümlesi.
 * Seviye 2: deneme fişi onayı (+ yazıcı birden fazlaysa seçim). Seviye 3 yok,
 * tarayıcı önizlemesi yok — tek dürüst önizleme kâğıttır.
 *
 * Zero-config: zorunlu alan yok; ekran hiç açılmazsa fiş bugünkü gibi basılır.
 * `null` (varsayılan) ile `[]` (alt bilgi hiç basılmasın) AYRI niyetlerdir (K3.2).
 */

/** Formun yerel hâli: üst bilgi her zaman liste; alt bilgi null = varsayılan kapanış. */
interface FormState {
  header: string[];
  footer: string[] | null;
  packingAutoPrint: boolean;
}

function fromSaved(saved: ReceiptSettings): FormState {
  return {
    header: saved.receiptHeaderLines ?? [],
    footer: saved.receiptFooterLines,
    packingAutoPrint: saved.packingAutoPrintEnabled,
  };
}

/** Üst bilgide boş liste ile null aynı fişi çizer; durum cümlesi dürüst kalsın diye null yollanır. */
function headerForSave(header: string[]): string[] | null {
  return header.length === 0 ? null : header;
}

function sameLines(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

export default function ReceiptSettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useReceiptSettings();
  const update = useUpdateReceiptSettings();
  const testPrint = useReceiptTestPrint();
  // `mutate` referansı kararlı: PrintTargetDialog'a giden callback her render'da değişmesin.
  const sendTestPrint = testPrint.mutate;

  const [form, setForm] = useState<FormState | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [testConfirmOpen, setTestConfirmOpen] = useState(false);
  const [targetRequested, setTargetRequested] = useState(false);

  useEffect(() => {
    if (query.data) setForm(fromSaved(query.data));
  }, [query.data]);

  const saved = query.data;

  const isDirty = useMemo(() => {
    if (!saved || !form) return false;
    return (
      !sameLines(headerForSave(form.header), saved.receiptHeaderLines) ||
      !sameLines(form.footer, saved.receiptFooterLines) ||
      form.packingAutoPrint !== saved.packingAutoPrintEnabled
    );
  }, [saved, form]);

  const allLines = form ? [...form.header, ...(form.footer ?? [])] : [];
  const hasEmptyLine = allLines.some((line) => line.trim().length === 0);
  const hasInvalidLine = allLines.some((line) => line.length > 0 && receiptLineError(line) !== null);
  const canSave = isDirty && !hasEmptyLine && !hasInvalidLine && !update.isPending;

  const usesDefault = saved !== undefined && saved.receiptHeaderLines === null && saved.receiptFooterLines === null;

  const errorMessage = useCallback(
    (err: unknown, fallbackKey: string): string => {
      if (isAxiosError(err)) {
        const code = (err.response?.data as { error?: { code?: string } } | undefined)?.error?.code;
        if (code) {
          const localized = t(`admin.printSettings.errors.${code}`, { defaultValue: '' });
          if (localized) return localized;
        }
      }
      return t(fallbackKey);
    },
    [t],
  );

  const save = async (body: Parameters<typeof update.mutateAsync>[0], successKey: string) => {
    try {
      await update.mutateAsync(body);
      toast.success(t(successKey));
    } catch (err) {
      toast.error(errorMessage(err, 'admin.printSettings.errors.saveFailed'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !canSave) return;
    await save(
      {
        receiptHeaderLines: headerForSave(form.header),
        receiptFooterLines: form.footer,
        packingAutoPrintEnabled: form.packingAutoPrint,
      },
      'admin.printSettings.saveSuccess',
    );
  };

  const handleReset = async () => {
    if (!form) return;
    setResetOpen(false);
    // K9 — "Varsayılana dön" = metin kolonları NULL (satır ASLA silinmez).
    // Paket anahtarı kayıtlı değerinde kalır: bu düğme yalnız METNİ sıfırlar.
    await save(
      {
        receiptHeaderLines: null,
        receiptFooterLines: null,
        packingAutoPrintEnabled: saved?.packingAutoPrintEnabled ?? form.packingAutoPrint,
      },
      'admin.printSettings.resetSuccess',
    );
  };

  const handleTargetResolved = useCallback(
    (targetPrinterId: string | undefined) => {
      setTargetRequested(false);
      sendTestPrint(targetPrinterId, {
        onSuccess: () => toast.success(t('admin.printSettings.testPrint.sent')),
        onError: (err) => toast.error(errorMessage(err, 'admin.printSettings.errors.testPrintFailed')),
      });
    },
    [sendTestPrint, t, errorMessage],
  );
  const handleTargetCancel = useCallback(() => setTargetRequested(false), []);

  const testPrintBusy = targetRequested || testPrint.isPending;

  return (
    <AppShell>
      <PageHeader
        title={t('admin.printSettings.title')}
        startActions={
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            aria-label={t('admin.printSettings.back')}
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
            {t('admin.printSettings.back')}
          </button>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6">
        {query.isPending && (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--v3-text-muted)' }} />
          </div>
        )}

        {query.isError && (
          <div
            className="rounded-md border border-dashed p-8 text-center text-sm"
            style={{ borderColor: 'var(--v3-border-subtle)', color: 'var(--v3-text-muted)' }}
          >
            {t('admin.printSettings.errors.loadFailed')}
          </div>
        )}

        {query.isSuccess && form && (
          <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-4">
            {/* Durum + nerede basıldığı + zero-config */}
            <div
              className="rounded-lg border bg-white p-4 text-sm shadow-sm"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
              data-testid="receipt-status"
            >
              <p className="font-semibold text-slate-900">
                {usesDefault ? t('admin.printSettings.status.default') : t('admin.printSettings.status.custom')}
              </p>
              <p className="mt-1 flex items-start gap-2 text-slate-600">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                {t('admin.printSettings.whereItPrints')}
              </p>
              <p className="mt-1 text-slate-600">{t('admin.printSettings.zeroConfig')}</p>
            </div>

            <p
              role="note"
              className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
              data-testid="receipt-kvkk-note"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {t('admin.printSettings.kvkkWarning')}
            </p>

            {/* Üst bilgi */}
            <section
              className="rounded-lg border bg-white p-4 shadow-sm"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
              aria-labelledby="receipt-header-title"
            >
              <h2 id="receipt-header-title" className="text-base font-semibold text-slate-900">
                {t('admin.printSettings.header.title')}
              </h2>
              <p className="mb-3 text-[13px] text-slate-600">{t('admin.printSettings.header.help')}</p>
              <ReceiptLinesEditor
                idPrefix="header"
                lines={form.header}
                maxLines={RECEIPT_TEXT_LIMITS.maxHeaderLines}
                disabled={update.isPending}
                onChange={(header) => setForm({ ...form, header })}
              />
            </section>

            {/* Alt bilgi: varsayılan (null) / kendi metni / hiç ([]) */}
            <section
              className="rounded-lg border bg-white p-4 shadow-sm"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
              aria-labelledby="receipt-footer-title"
            >
              <h2 id="receipt-footer-title" className="text-base font-semibold text-slate-900">
                {t('admin.printSettings.footer.title')}
              </h2>
              {form.footer === null ? (
                <div className="flex flex-col gap-3" data-testid="footer-default">
                  <p className="text-[13px] text-slate-600">{t('admin.printSettings.footer.defaultInUse')}</p>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={update.isPending}
                      onClick={() => setForm({ ...form, footer: [''] })}
                      data-testid="footer-write-own"
                    >
                      {t('admin.printSettings.footer.writeOwn')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-slate-600">
                    {form.footer.length === 0
                      ? t('admin.printSettings.footer.nothing')
                      : t('admin.printSettings.footer.customHelp')}
                  </p>
                  <ReceiptLinesEditor
                    idPrefix="footer"
                    lines={form.footer}
                    maxLines={RECEIPT_TEXT_LIMITS.maxFooterLines}
                    disabled={update.isPending}
                    onChange={(footer) => setForm({ ...form, footer })}
                  />
                  <div className="flex flex-wrap gap-2">
                    {form.footer.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11"
                        disabled={update.isPending}
                        onClick={() => setForm({ ...form, footer: [] })}
                        data-testid="footer-clear"
                      >
                        {t('admin.printSettings.footer.clear')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={update.isPending}
                      onClick={() => setForm({ ...form, footer: null })}
                      data-testid="footer-use-default"
                    >
                      {t('admin.printSettings.footer.useDefault')}
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* Paket fişi otomatik baskı */}
            <section
              className="flex items-start justify-between gap-4 rounded-lg border bg-white p-4 shadow-sm"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              <div>
                <h2 id="packing-auto-title" className="text-base font-semibold text-slate-900">
                  {t('admin.printSettings.packingAuto.title')}
                </h2>
                <p className="text-[13px] text-slate-600">{t('admin.printSettings.packingAuto.help')}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.packingAutoPrint}
                aria-labelledby="packing-auto-title"
                disabled={update.isPending}
                onClick={() => setForm({ ...form, packingAutoPrint: !form.packingAutoPrint })}
                data-testid="packing-auto-switch"
                className={`inline-flex h-11 min-w-[88px] shrink-0 items-center justify-center rounded-full px-4 text-sm font-semibold transition disabled:opacity-50 ${
                  form.packingAutoPrint ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {form.packingAutoPrint ? t('admin.printSettings.packingAuto.on') : t('admin.printSettings.packingAuto.off')}
              </button>
            </section>

            {/* Eylemler */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-1.5"
                  disabled={testPrintBusy}
                  onClick={() => setTestConfirmOpen(true)}
                  data-testid="test-print-button"
                >
                  {testPrintBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                  {t('admin.printSettings.testPrint.button')}
                </Button>
                {!usesDefault && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 gap-1.5"
                    disabled={update.isPending}
                    onClick={() => setResetOpen(true)}
                    data-testid="reset-button"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {t('admin.printSettings.reset.button')}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }} role="status">
                  {hasEmptyLine
                    ? t('admin.printSettings.emptyLineHint')
                    : !isDirty
                      ? t('admin.printSettings.noChanges')
                      : ''}
                </span>
                <Button type="submit" className="h-11 gap-1.5" disabled={!canSave} data-testid="save-button">
                  {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {update.isPending ? t('admin.printSettings.saving') : t('admin.printSettings.saveButton')}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Varsayılana dön onayı */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.printSettings.reset.title')}</DialogTitle>
            <DialogDescription>{t('admin.printSettings.reset.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => setResetOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" className="h-11" onClick={() => void handleReset()} data-testid="reset-confirm">
              {t('admin.printSettings.reset.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deneme fişi onayı (kâğıt harcanır) */}
      <Dialog open={testConfirmOpen} onOpenChange={setTestConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.printSettings.testPrint.title')}</DialogTitle>
            <DialogDescription>{t('admin.printSettings.testPrint.description')}</DialogDescription>
          </DialogHeader>
          {isDirty && (
            <p role="note" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="test-print-unsaved-note">
              {t('admin.printSettings.testPrint.unsavedNote')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => setTestConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              className="h-11"
              onClick={() => {
                setTestConfirmOpen(false);
                setTargetRequested(true);
              }}
              data-testid="test-print-confirm"
            >
              {t('admin.printSettings.testPrint.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PrintTargetDialog
        requested={targetRequested}
        onResolved={handleTargetResolved}
        onCancel={handleTargetCancel}
      />
    </AppShell>
  );
}
