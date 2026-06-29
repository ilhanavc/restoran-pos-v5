import type {
  Category,
  ProductWithVariants,
} from '@restoran-pos/shared-types';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getActiveOrderForTable,
  getMenuCategories,
  getMenuProducts,
} from '../../api/client';
import type { ApiActiveOrder } from '../../api/orders';

/**
 * Order-screen server-state hooks (ADR-026 K4).
 *
 * Thin TanStack Query wrappers over the api/client seam. Menu data (categories
 * + products) is tenant-static, so it is cached long (`staleTime`); the active
 * order is per-table and refetched on focus. The query keys match the web
 * client so PR-5d's realtime invalidation contract is identical.
 */

const MENU_CATEGORIES_KEY = ['menu', 'categories'] as const;
const MENU_PRODUCTS_KEY = ['menu', 'products'] as const;
const FIVE_MINUTES_MS = 5 * 60_000;

/** Menu categories for the colour grid (sorted by `sortOrder`). */
export function useMenuCategories(): UseQueryResult<Category[]> {
  return useQuery({
    queryKey: MENU_CATEGORIES_KEY,
    queryFn: getMenuCategories,
    staleTime: FIVE_MINUTES_MS,
  });
}

/** Product catalog with nested variants. */
export function useMenuProducts(): UseQueryResult<ProductWithVariants[]> {
  return useQuery({
    queryKey: MENU_PRODUCTS_KEY,
    queryFn: getMenuProducts,
    staleTime: FIVE_MINUTES_MS,
  });
}

/** The active order (saved items) for a table; `null` while the table is empty. */
export function useActiveOrderForTable(
  tableId: string,
): UseQueryResult<ApiActiveOrder | null> {
  return useQuery({
    queryKey: ['orders', 'by-table', tableId, 'active'],
    queryFn: () => getActiveOrderForTable(tableId),
  });
}
