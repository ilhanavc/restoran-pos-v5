import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AuditLogListItem } from '@restoran-pos/shared-types';
import { AppShell } from '../../components/layout/AppShell';
import { PageHeader } from '../../components/layout/PageHeader';
import { useSettings } from './settings/api';
import { useAuditLogs, type AuditLogFilterState } from './audit-logs/api';
import {
  AuditLogFilterBar,
  presetWindow,
  type DatePreset,
} from './audit-logs/components/AuditLogFilterBar';
import { AuditLogDetailDrawer } from './audit-logs/components/AuditLogDetailDrawer';
import { eventTypeLabel, entityTypeLabel, roleLabel } from './audit-logs/labels';

/**
 * ADR-037 K7/K8 — Denetim Günlüğü ekranı (`/admin/audit-logs`, yalnız admin).
 *
 * Liste 4 kolondur ve **payload listede GÖSTERİLMEZ**; satıra tıklayınca sağdan
 * Drawer açılır (K8 hibrit detay: insan-okur + "Ham JSON"). Sayfa numarası
 * YOKTUR — keyset sayfalama ile "Daha fazla yükle" (K2/K7).
 *
 * **Tüm filtre durumu URL query string'ine yazılır** → geri tuşu, yenileme ve
 * bağlantı paylaşımı çalışır; `?entityType=order&entityId=…` ile derin bağlantı
 * mümkündür (diğer ekranlara buton eklemek kapsam dışı, madde 5).
 */

/** URL query string → filtre durumu (tek yönlü, sayfa açılışında ve her nav'da). */
function readFiltersFromUrl(params: URLSearchParams): {
  filters: AuditLogFilterState;
  preset: DatePreset;
} {
  const filters: AuditLogFilterState = {};
  const from = params.get('from');
  const to = params.get('to');
  const eventTypes = params.getAll('eventType');
  const entityType = params.get('entityType');
  const entityId = params.get('entityId');
  const actorUserId = params.get('actorUserId');

  if (from !== null) filters.from = from;
  if (to !== null) filters.to = to;
  if (eventTypes.length > 0) filters.eventTypes = eventTypes;
  if (entityType !== null) filters.entityType = entityType;
  // `entityId` yalnız `entityType` ile birlikte anlamlıdır (backend 400 döner).
  if (entityId !== null && entityType !== null) filters.entityId = entityId;
  if (actorUserId !== null) filters.actorUserId = actorUserId;

  const presetParam = params.get('preset');
  const preset: DatePreset =
    presetParam === 'today' ||
    presetParam === 'yesterday' ||
    presetParam === 'last7' ||
    presetParam === 'last30' ||
    presetParam === 'custom'
      ? presetParam
      : 'last7';

  // İlk açılış (hiç parametre yok): K4 varsayılanı — son 7 gün.
  if (params.toString() === '') {
    return { filters: { ...presetWindow('last7') }, preset: 'last7' };
  }
  return { filters, preset };
}

/** Filtre durumu → URL query string (aynı anahtar seti, tek yönde). */
function writeFiltersToUrl(
  filters: AuditLogFilterState,
  preset: DatePreset,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.from !== undefined) params.set('from', filters.from);
  if (filters.to !== undefined) params.set('to', filters.to);
  for (const et of filters.eventTypes ?? []) params.append('eventType', et);
  if (filters.entityType !== undefined) {
    params.set('entityType', filters.entityType);
  }
  if (filters.entityId !== undefined) params.set('entityId', filters.entityId);
  if (filters.actorUserId !== undefined) {
    params.set('actorUserId', filters.actorUserId);
  }
  params.set('preset', preset);
  return params;
}

export default function AuditLogPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<AuditLogListItem | null>(null);

  const settingsQuery = useSettings();
  const timezone = settingsQuery.data?.timezone ?? 'Europe/Istanbul';

  const { filters, preset } = useMemo(
    () => readFiltersFromUrl(searchParams),
    [searchParams],
  );

  const query = useAuditLogs(filters);

  /**
   * Zaman kolonu: `dd.MM.yyyy HH:mm:ss`, restoran saat diliminde (`/settings`).
   * UTC göstermek gece kayıtlarını yanlış güne düşürürdü (fiş formatı dersi).
   */
  const formatDateTime = useCallback(
    (iso: string): string => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const parts = new Intl.DateTimeFormat('tr-TR', {
        timeZone: timezone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(d);
      const get = (type: Intl.DateTimeFormatPart['type']): string =>
        parts.find((p) => p.type === type)?.value ?? '';
      return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
    },
    [timezone],
  );

  const handleFilterChange = useCallback(
    (next: AuditLogFilterState, nextPreset: DatePreset): void => {
      setSearchParams(writeFiltersToUrl(next, nextPreset), { replace: false });
    },
    [setSearchParams],
  );

  const handleCopyEntityId = (entityId: string): void => {
    void navigator.clipboard
      .writeText(entityId)
      .then(() => {
        toast.success(t('audit.copy.idCopied'));
      })
      .catch(() => {
        toast.error(t('audit.copy.failed'));
      });
  };

  const logs = query.data?.pages.flatMap((p) => p.logs) ?? [];

  return (
    <AppShell>
      <PageHeader
        title={t('audit.title')}
        actions={
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            aria-label={t('audit.back')}
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
            {t('audit.back')}
          </button>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6">
        <p className="mb-3 text-[13px] text-muted-foreground">
          {t('audit.subtitle')}
        </p>

        <AuditLogFilterBar
          filters={filters}
          preset={preset}
          onChange={handleFilterChange}
          onRefresh={() => void query.refetch()}
          isRefreshing={query.isRefetching}
        />

        {query.isPending && (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2
              className="h-6 w-6 animate-spin"
              style={{ color: 'var(--v3-text-muted)' }}
            />
          </div>
        )}

        {query.isError && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-danger, #dc2626)',
              color: 'var(--v3-danger, #dc2626)',
            }}
          >
            {t('audit.loadFailed')}
          </div>
        )}

        {query.isSuccess && logs.length === 0 && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-muted)',
            }}
          >
            {t('audit.empty')}
          </div>
        )}

        {query.isSuccess && logs.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border bg-white">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-border text-[12px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">
                    {t('audit.columns.time')}
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    {t('audit.columns.event')}
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    {t('audit.columns.actor')}
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    {t('audit.columns.entity')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    data-testid="audit-log-row"
                    onClick={() => setSelected(log)}
                    className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-stone-50"
                  >
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      {/* Türkçe etiket BÜYÜK, ham kod küçük/soluk (destek
                          konuşmasında teknik kod lazım olur — K7). */}
                      <div className="font-semibold">
                        {eventTypeLabel(t, log.eventType)}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {log.eventType}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {log.actor.displayName ?? t('audit.actor.unknown')}
                      {log.actor.role !== null && (
                        <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold">
                          {roleLabel(t, log.actor.role)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {log.entityType === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {entityTypeLabel(t, log.entityType)}
                          {log.entityId !== null && (
                            <button
                              type="button"
                              title={log.entityId}
                              onClick={(e) => {
                                // Satır tıklaması Drawer açar; kopyalama ayrı eylem.
                                e.stopPropagation();
                                handleCopyEntityId(log.entityId!);
                              }}
                              className="ml-2 font-mono text-[12px] underline decoration-dotted"
                            >
                              {log.entityId.slice(0, 8)}…
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {query.hasNextPage && (
              <div className="border-t border-border p-3 text-center">
                <button
                  type="button"
                  data-testid="audit-load-more"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border px-4 text-[13px] font-medium hover:bg-stone-50 disabled:opacity-60"
                >
                  {query.isFetchingNextPage && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {query.isFetchingNextPage
                    ? t('audit.loading')
                    : t('audit.loadMore')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <AuditLogDetailDrawer
        log={selected}
        onClose={() => setSelected(null)}
        formatDateTime={formatDateTime}
      />
    </AppShell>
  );
}
