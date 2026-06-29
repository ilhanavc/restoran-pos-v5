import type { Area } from '@restoran-pos/shared-types';
import {
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';

import { getAreas, getTables } from '../../api/client';
import type { ApiTable } from '../../api/tables';

/**
 * Table-board server-state hooks (ADR-026 K4).
 *
 * Thin TanStack Query wrappers over the api/client seam — web parity
 * (apps/web/src/features/tables/api.ts). The query keys (`['tables']` /
 * `['areas']`) match the web client so the realtime invalidation contract
 * (PR-5d) is identical. Each hook exposes `refetch` for pull-to-refresh.
 */

const TABLES_KEY = ['tables'] as const;
const AREAS_KEY = ['areas'] as const;

/** Live table board (occupied/empty + active-order projection). */
export function useTables(): UseQueryResult<ApiTable[]> {
  return useQuery({
    queryKey: TABLES_KEY,
    queryFn: getTables,
  });
}

/** Salon areas for the region pills (sorted by `sortOrder`). */
export function useAreas(): UseQueryResult<Area[]> {
  return useQuery({
    queryKey: AREAS_KEY,
    queryFn: getAreas,
  });
}
