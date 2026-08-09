import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AuditLogListItem } from '@restoran-pos/shared-types';
import { eventTypeLabel, entityTypeLabel, roleLabel } from '../labels';

/**
 * ADR-037 K8 — detay paneli: **insan-okur key/değer + "Ham JSON" aç/kapa**.
 * İkisinden biri değil, ikisi birden.
 *
 * Bilinmeyen payload key'i ASLA gizlenmez; ham adıyla gösterilir. Denetim
 * kaydında bilgi saklamak en tehlikeli başarısızlık kipidir (alternatif E,
 * reddedildi). Eşleme tablosu "elden geldiğince"dir ve eksik olması bug değildir.
 */

interface AuditLogDetailDrawerProps {
  log: AuditLogListItem | null;
  onClose: () => void;
  /** Zaman biçimleyici — sayfa ile aynı (restoran saat dilimi). */
  formatDateTime: (iso: string) => string;
}

/** `*_cents` alanları integer kuruştur; float aritmetiği YOK. */
function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const major = Math.trunc(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  return `${sign}₺${major.toLocaleString('tr-TR')},${minor}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function AuditLogDetailDrawer({
  log,
  onClose,
  formatDateTime,
}: AuditLogDetailDrawerProps): JSX.Element | null {
  const { t } = useTranslation();
  const [showRaw, setShowRaw] = useState(false);

  if (log === null) return null;

  const payloadEntries = Object.entries(log.payload);

  const handleCopy = (value: string, successKey: string): void => {
    void copyText(value).then((ok) => {
      if (ok) toast.success(t(successKey));
      else toast.error(t('audit.copy.failed'));
    });
  };

  /** Değer biçimleme (K8): kuruş · UUID · boolean · ISO tarih · iç içe yapı. */
  const renderValue = (key: string, value: unknown): JSX.Element => {
    if (value === null || value === undefined) {
      return <span className="text-muted-foreground">—</span>;
    }
    if (typeof value === 'boolean') {
      return <span>{value ? t('audit.detail.yes') : t('audit.detail.no')}</span>;
    }
    if (typeof value === 'number' && key.endsWith('_cents')) {
      return <span className="tabular-nums font-semibold">{formatCents(value)}</span>;
    }
    if (typeof value === 'number') {
      return <span className="tabular-nums">{value.toLocaleString('tr-TR')}</span>;
    }
    if (typeof value === 'string' && UUID_RE.test(value)) {
      return (
        <button
          type="button"
          onClick={() => handleCopy(value, 'audit.copy.idCopied')}
          title={value}
          className="inline-flex min-h-[32px] items-center gap-1 rounded font-mono text-[12px] underline decoration-dotted hover:text-foreground"
        >
          {value.slice(0, 8)}…
          <Copy className="h-3 w-3" />
        </button>
      );
    }
    if (typeof value === 'string' && ISO_RE.test(value)) {
      return <span className="tabular-nums">{formatDateTime(value)}</span>;
    }
    if (typeof value === 'string') return <span>{value}</span>;
    // İç içe nesne/dizi — girintili ham gösterim (bilgi düşürülmez).
    return (
      <pre className="whitespace-pre-wrap break-all rounded bg-stone-50 p-2 text-[12px]">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  };

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('audit.detail.title')}
        data-testid="audit-detail-drawer"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-border bg-white shadow-xl"
      >
        <header className="flex h-[54px] shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-[15px] font-semibold">
            {t('audit.detail.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('audit.detail.close')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <section className="mb-4">
            <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
              {t('audit.detail.summary')}
            </h3>
            <dl className="space-y-2 text-[14px]">
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-muted-foreground">
                  {t('audit.columns.time')}
                </dt>
                <dd className="tabular-nums">{formatDateTime(log.createdAt)}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-muted-foreground">
                  {t('audit.columns.event')}
                </dt>
                <dd>
                  <span className="font-semibold">{eventTypeLabel(t, log.eventType)}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {log.eventType}
                  </span>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-muted-foreground">
                  {t('audit.columns.actor')}
                </dt>
                <dd>
                  {log.actor.displayName ?? t('audit.actor.unknown')}
                  {log.actor.role !== null && (
                    <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold">
                      {roleLabel(t, log.actor.role)}
                    </span>
                  )}
                </dd>
              </div>
              {log.entityType !== null && (
                <div className="flex gap-3">
                  <dt className="w-32 shrink-0 text-muted-foreground">
                    {t('audit.columns.entity')}
                  </dt>
                  <dd>
                    {entityTypeLabel(t, log.entityType)}
                    {log.entityId !== null && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy(log.entityId!, 'audit.copy.idCopied')
                        }
                        title={log.entityId}
                        className="ml-2 inline-flex min-h-[32px] items-center gap-1 rounded font-mono text-[12px] underline decoration-dotted"
                      >
                        {log.entityId.slice(0, 8)}…
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                {t('audit.detail.payload')}
              </h3>
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                data-testid="audit-raw-json-toggle"
                className="inline-flex min-h-[36px] items-center rounded-md px-2 text-[12px] font-semibold underline"
              >
                {showRaw
                  ? t('audit.detail.rawJsonHide')
                  : t('audit.detail.rawJsonShow')}
              </button>
            </div>

            {payloadEntries.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                {t('audit.detail.payloadEmpty')}
              </p>
            ) : (
              <dl className="space-y-2 text-[14px]">
                {payloadEntries.map(([key, value]) => (
                  <div key={key} className="flex gap-3">
                    <dt className="w-32 shrink-0 break-all text-muted-foreground">
                      {/* Eşlenmemiş key HAM adıyla görünür — asla gizlenmez. */}
                      {t(`audit.payloadKey.${key}`, { defaultValue: key })}
                    </dt>
                    <dd className="min-w-0 flex-1 break-all">
                      {renderValue(key, value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {showRaw && (
              <div className="mt-3">
                <pre
                  data-testid="audit-raw-json"
                  className="max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded bg-stone-900 p-3 text-[12px] text-stone-100"
                >
                  {JSON.stringify(log.payload, null, 2)}
                </pre>
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      JSON.stringify(log.payload, null, 2),
                      'audit.copy.jsonCopied',
                    )
                  }
                  className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium"
                >
                  <Copy className="h-4 w-4" />
                  {t('audit.detail.copyJson')}
                </button>
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
