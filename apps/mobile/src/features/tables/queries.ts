import type { Area } from '@restoran-pos/shared-types';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { getAreas, getTables, moveTableOrder } from '../../api/client';
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

/** Input for the move-table mutation (ADR-028): which order → which target table. */
export interface MoveTableInput {
  orderId: string;
  tableId: string;
}

/**
 * Move an open dine-in order to another empty table (ADR-028 Karar H).
 *
 * On success both the source and target tables change occupancy, so the board
 * (`['tables']`) and open-order caches (`['orders']`) are invalidated — the same
 * keys the realtime `tables.changed` contract targets (mobile board has no
 * listener yet, so this local invalidate is what refreshes the picker/board).
 */
export function useMoveTable(): UseMutationResult<void, Error, MoveTableInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, tableId }: MoveTableInput) =>
      moveTableOrder(orderId, tableId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TABLES_KEY });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
