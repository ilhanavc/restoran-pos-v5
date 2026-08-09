import { useInfiniteQuery } from '@tanstack/react-query';
import type {
  AuditLogListItem,
  AuditLogListPage,
} from '@restoran-pos/shared-types';
import { api } from '../../../lib/api';

/**
 * ADR-037 — Denetim günlüğü okuma hook'ları.
 *
 * Backend: `GET /audit-logs` (yalnız admin, salt-okuma).
 *   - Sayfalama **keyset**: `nextCursor` opak string, istemci AYRIŞTIRMAZ (K2).
 *   - `total` yoktur; sayfa numarası da yoktur → "Daha fazla yükle" (K7).
 *   - CSV: aynı endpoint + `&format=csv` (K11) — ayrı endpoint YOK.
 *
 * Canlı akış / Socket.IO YOK (kapsam dışı, madde 4): tazeleme "Yenile" ile.
 */

export type { AuditLogListItem };

/** URL'e (ve sorguya) yazılan filtre durumu — tümü opsiyonel, AND ile birleşir. */
export interface AuditLogFilterState {
  /** ISO 8601 datetime. */
  from?: string;
  to?: string;
  eventTypes?: string[];
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
}

/** Sayfa başına satır (K2 varsayılanı 50, tavan 200). */
const PAGE_SIZE = 50;

/**
 * Filtre durumunu query string'e çevirir. **Tek üretici**: hem liste isteği
 * hem CSV indirme hem de URL senkronu bunu kullanır → ekranda görülen filtre
 * ile dosyada çıkan satırlar ayrışamaz (K11.2 filtre pariteliği).
 */
export function buildAuditQueryParams(
  filters: AuditLogFilterState,
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
  return params;
}

interface AuditLogListEnvelope {
  data: AuditLogListPage;
}

export function useAuditLogs(filters: AuditLogFilterState) {
  return useInfiniteQuery({
    queryKey: ['audit-logs', filters] as const,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<AuditLogListPage> => {
      const params = buildAuditQueryParams(filters);
      params.set('limit', String(PAGE_SIZE));
      if (pageParam !== null) params.set('cursor', pageParam);
      const res = await api.get<AuditLogListEnvelope>(
        `/audit-logs?${params.toString()}`,
      );
      return res.data.data;
    },
    getNextPageParam: (last) => last.nextCursor,
    // Denetim ekranı tazelik ister; ama append-only veri anlık değişmez —
    // otomatik polling YOK (kapsam dışı madde 4), "Yenile" butonu yeterli.
    staleTime: 0,
  });
}

/** Aktif filtrelerin TAMAMINI taşıyan CSV indirme yolu (DoD 11a). */
export function buildAuditCsvPath(filters: AuditLogFilterState): string {
  const params = buildAuditQueryParams(filters);
  params.set('format', 'csv');
  return `/audit-logs?${params.toString()}`;
}
