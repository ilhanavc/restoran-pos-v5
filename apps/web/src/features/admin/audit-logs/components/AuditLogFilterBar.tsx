import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { Download, Loader2, RotateCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { downloadCsv } from '../../../reports/lib/downloadCsv';
import { useUsers } from '../../users/api';
import { buildAuditCsvPath, type AuditLogFilterState } from '../api';
import { eventTypeLabel, entityTypeLabel, groupedEventTypes } from '../labels';

/**
 * ADR-037 K7 — filtre çubuğu.
 *
 * Tarih ön ayarları · olay türü çoklu seçim (gruplu, Türkçe etiketlerle) ·
 * kim (kullanıcı seçici) · "Kayıt ara" (entityType + entityId) · CSV indir.
 *
 * Filtre durumu URL query string'inde yaşar (sayfa yönetir) → geri tuşu,
 * yenileme ve bağlantı paylaşımı çalışır.
 */

/** Ön ayarlar — `custom` kullanıcı elle tarih girdiğinde seçilidir. */
export type DatePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

const PRESETS: readonly DatePreset[] = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'custom',
];

/** Ön ayarın ISO pencere karşılığı (yerel gün sınırlarına oturur). */
export function presetWindow(preset: DatePreset): {
  from?: string;
  to?: string;
} {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  switch (preset) {
    case 'today':
      return { from: startOfToday.toISOString() };
    case 'yesterday':
      return {
        from: new Date(startOfToday.getTime() - day).toISOString(),
        to: startOfToday.toISOString(),
      };
    case 'last7':
      return { from: new Date(startOfToday.getTime() - 7 * day).toISOString() };
    case 'last30':
      return { from: new Date(startOfToday.getTime() - 30 * day).toISOString() };
    case 'custom':
      return {};
  }
}

/** `datetime-local` input değeri ⇄ ISO dönüşümü. */
function isoToLocalInput(iso: string | undefined): string {
  if (iso === undefined) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | undefined {
  if (value === '') return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Denetim ekranından aranabilen nesne tipleri (backend `^[a-z_]+$` bekler). */
const ENTITY_TYPES = [
  'order',
  'order_item',
  'payment',
  'user',
  'product',
  'category',
  'table',
  'area',
  'customer',
  'printer',
] as const;

interface AuditLogFilterBarProps {
  filters: AuditLogFilterState;
  preset: DatePreset;
  onChange: (filters: AuditLogFilterState, preset: DatePreset) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function AuditLogFilterBar({
  filters,
  preset,
  onChange,
  onRefresh,
  isRefreshing,
}: AuditLogFilterBarProps): JSX.Element {
  const { t } = useTranslation();
  const usersQuery = useUsers();
  const [isDownloading, setIsDownloading] = useState(false);
  const [entityIdDraft, setEntityIdDraft] = useState(filters.entityId ?? '');

  const groups = groupedEventTypes();
  const selectedEvents = filters.eventTypes ?? [];

  const setPreset = (next: DatePreset): void => {
    const window = presetWindow(next);
    const updated: AuditLogFilterState = { ...filters };
    delete updated.from;
    delete updated.to;
    if (window.from !== undefined) updated.from = window.from;
    if (window.to !== undefined) updated.to = window.to;
    onChange(updated, next);
  };

  const toggleEvent = (eventType: string): void => {
    const next = selectedEvents.includes(eventType)
      ? selectedEvents.filter((e) => e !== eventType)
      : [...selectedEvents, eventType];
    const updated: AuditLogFilterState = { ...filters };
    if (next.length === 0) delete updated.eventTypes;
    else updated.eventTypes = next;
    onChange(updated, preset);
  };

  const setActor = (userId: string): void => {
    const updated: AuditLogFilterState = { ...filters };
    if (userId === '') delete updated.actorUserId;
    else updated.actorUserId = userId;
    onChange(updated, preset);
  };

  const setEntityType = (entityType: string): void => {
    const updated: AuditLogFilterState = { ...filters };
    if (entityType === '') {
      delete updated.entityType;
      // `entityId` tek başına 400 ENTITY_TYPE_REQUIRED üretir — birlikte düşer.
      delete updated.entityId;
      setEntityIdDraft('');
    } else {
      updated.entityType = entityType;
    }
    onChange(updated, preset);
  };

  const applyEntityId = (): void => {
    const updated: AuditLogFilterState = { ...filters };
    const trimmed = entityIdDraft.trim();
    if (trimmed === '') delete updated.entityId;
    else updated.entityId = trimmed;
    onChange(updated, preset);
  };

  const clearAll = (): void => {
    setEntityIdDraft('');
    onChange({ ...presetWindow('last7') }, 'last7');
  };

  const handleDownload = (): void => {
    if (isDownloading) return;
    setIsDownloading(true);
    const stamp = new Date().toISOString().slice(0, 10);
    void downloadCsv(buildAuditCsvPath(filters), `denetim-gunlugu-${stamp}.csv`)
      .then(() => {
        toast.success(t('audit.export.success'));
      })
      .catch((err: unknown) => {
        // 400 REPORT_TOO_LARGE → eyleme dönük Türkçe mesaj (K11.4).
        // Sessiz başarısızlık veya boş dosya YASAK.
        if (isAxiosError(err) && err.response?.status === 400) {
          toast.error(t('audit.export.tooLarge'));
          return;
        }
        toast.error(t('audit.export.failed'));
      })
      .finally(() => {
        setIsDownloading(false);
      });
  };

  const activeBadges: { key: string; label: string; onRemove: () => void }[] = [
    ...selectedEvents.map((e) => ({
      key: `event-${e}`,
      label: eventTypeLabel(t, e),
      onRemove: () => toggleEvent(e),
    })),
    ...(filters.actorUserId !== undefined
      ? [
          {
            key: 'actor',
            label:
              usersQuery.data?.find((u) => u.id === filters.actorUserId)?.name ??
              t('audit.actor.unknown'),
            onRemove: () => setActor(''),
          },
        ]
      : []),
    ...(filters.entityType !== undefined
      ? [
          {
            key: 'entity',
            label: `${entityTypeLabel(t, filters.entityType)}${
              filters.entityId !== undefined
                ? ` · ${filters.entityId.slice(0, 8)}…`
                : ''
            }`,
            onRemove: () => setEntityType(''),
          },
        ]
      : []),
  ];

  return (
    <div className="mb-4 space-y-3 rounded-md border border-border bg-white p-3">
      {/* Tarih ön ayarları */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-muted-foreground">
          {t('audit.filters.dateRange')}
        </span>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPreset(p)}
            aria-pressed={preset === p}
            className={`inline-flex min-h-[40px] items-center rounded-md border px-3 text-[13px] font-medium ${
              preset === p
                ? 'border-orange-500 bg-orange-50 text-orange-700'
                : 'border-border hover:bg-stone-50'
            }`}
          >
            {t(`audit.filters.preset.${p}`)}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-stone-50 disabled:opacity-60"
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" />
            )}
            {t('audit.refresh')}
          </button>
          <button
            type="button"
            data-testid="audit-csv-download"
            onClick={handleDownload}
            disabled={isDownloading}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-stone-50 disabled:opacity-60"
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {isDownloading
              ? t('audit.export.downloading')
              : t('audit.export.button')}
          </button>
        </div>
      </div>

      {preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            {t('audit.filters.from')}
            <input
              type="datetime-local"
              value={isoToLocalInput(filters.from)}
              onChange={(e) => {
                const updated: AuditLogFilterState = { ...filters };
                const iso = localInputToIso(e.target.value);
                if (iso === undefined) delete updated.from;
                else updated.from = iso;
                onChange(updated, 'custom');
              }}
              className="min-h-[40px] rounded-md border border-border px-2 text-[13px]"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            {t('audit.filters.to')}
            <input
              type="datetime-local"
              value={isoToLocalInput(filters.to)}
              onChange={(e) => {
                const updated: AuditLogFilterState = { ...filters };
                const iso = localInputToIso(e.target.value);
                if (iso === undefined) delete updated.to;
                else updated.to = iso;
                onChange(updated, 'custom');
              }}
              className="min-h-[40px] rounded-md border border-border px-2 text-[13px]"
            />
          </label>
        </div>
      )}

      {/* Kim + Kayıt ara */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-semibold text-muted-foreground">
            {t('audit.filters.actorUser')}
          </span>
          <select
            value={filters.actorUserId ?? ''}
            onChange={(e) => setActor(e.target.value)}
            className="min-h-[40px] min-w-[180px] rounded-md border border-border px-2 text-[13px]"
          >
            <option value="">{t('audit.filters.actorUserAll')}</option>
            {(usersQuery.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-semibold text-muted-foreground">
            {t('audit.filters.entityType')}
          </span>
          <select
            value={filters.entityType ?? ''}
            onChange={(e) => setEntityType(e.target.value)}
            className="min-h-[40px] min-w-[160px] rounded-md border border-border px-2 text-[13px]"
          >
            <option value="">{t('audit.filters.entityTypeNone')}</option>
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {entityTypeLabel(t, et)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[13px]">
          <span className="font-semibold text-muted-foreground">
            {t('audit.filters.entityId')}
          </span>
          <input
            type="text"
            value={entityIdDraft}
            disabled={filters.entityType === undefined}
            placeholder={t('audit.filters.entityIdPlaceholder')}
            onChange={(e) => setEntityIdDraft(e.target.value)}
            onBlur={applyEntityId}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyEntityId();
            }}
            className="min-h-[40px] min-w-[280px] rounded-md border border-border px-2 font-mono text-[13px] disabled:bg-stone-100"
          />
        </label>

        <button
          type="button"
          onClick={clearAll}
          className="min-h-[40px] rounded-md border border-border px-3 text-[13px] font-medium hover:bg-stone-50"
        >
          {t('audit.filters.clear')}
        </button>
      </div>

      {/* Olay türü çoklu seçim — gruplu */}
      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold">
          {selectedEvents.length === 0
            ? t('audit.filters.eventTypeAll')
            : t('audit.filters.eventTypeSelected', {
                count: selectedEvents.length,
              })}
        </summary>
        <div className="space-y-3 border-t border-border p-3">
          {groups.map((group) => (
            <div key={group.id}>
              <p className="mb-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                {t(`audit.group.${group.id}`)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.eventTypes.map((et) => (
                  <button
                    key={et}
                    type="button"
                    onClick={() => toggleEvent(et)}
                    aria-pressed={selectedEvents.includes(et)}
                    className={`inline-flex min-h-[36px] items-center rounded-full border px-3 text-[12px] font-medium ${
                      selectedEvents.includes(et)
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-border hover:bg-stone-50'
                    }`}
                  >
                    {eventTypeLabel(t, et)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      {activeBadges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeBadges.map((badge) => (
            <span
              key={badge.key}
              className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-1 pl-3 pr-1 text-[12px] font-medium"
            >
              {badge.label}
              <button
                type="button"
                onClick={badge.onRemove}
                aria-label={t('audit.filters.activeBadgeRemove')}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-stone-200"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
