import type {
  Category,
  ProductWithVariants,
} from '@restoran-pos/shared-types';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  getActiveOrderForTable,
  getEffectiveAttributeGroups,
  getMenuCategories,
  getMenuProducts,
  moveOrderItem,
} from '../../api/client';
import type { ApiActiveOrder } from '../../api/orders';
import type { EffectiveAttributeGroupRow } from '../../api/schemas';

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

/**
 * A product's effective attribute groups + options (ADR-026 Amendment 3 K5) for
 * the line-detail modal. Tenant-static like the menu, so cached long; disabled
 * until a product id is known. Query key mirrors the web client so the realtime
 * invalidation contract is identical.
 */
export function useEffectiveAttributeGroups(
  productId: string | null,
): UseQueryResult<EffectiveAttributeGroupRow[]> {
  return useQuery({
    queryKey: ['products', productId, 'effective-attribute-groups'],
    enabled: productId !== null,
    queryFn: () => getEffectiveAttributeGroups(productId as string),
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

/** ADR-035 kalem taşıma girdisi: hangi adisyonun hangi kalemi, hangi masaya. */
export interface MoveOrderItemInput {
  /** Kaynak (kalemin şu anki) sipariş id'si. */
  orderId: string;
  /** Taşınacak KAYITLI kalem id'si. */
  itemId: string;
  /** Hedef masa — DOLU ise adisyonuna eklenir, BOŞ ise sunucu yeni adisyon açar (S3). */
  targetTableId: string;
}

/**
 * ADR-035 Faz 1b — "Ürünü Başka Masaya Taşı" (mobil), `useMergeTable` ikizi.
 *
 * Başarıda İKİ masanın doluluğu/tutarı değişir → `['tables']` + `['orders']`
 * invalidate edilir (sunucu ayrıca 2× `tables.changed` emit eder; buradaki
 * invalidate bu cihazın kendi cache'i içindir).
 *
 * Yanıt (kaynak sipariş projeksiyonu) cache'e BİLEREK yazılmaz: son kalem
 * taşındığında kaynak adisyon `merged` kapanır ve projeksiyon artık "aktif
 * adisyon" değildir; `getActiveOrderForTable` refetch'i gerçeği (null) döner.
 * Yine de tipli parse edilir — kontrat kırılırsa mutasyon hata versin.
 */
export function useMoveOrderItem(): UseMutationResult<
  ApiActiveOrder,
  Error,
  MoveOrderItemInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, itemId, targetTableId }: MoveOrderItemInput) =>
      moveOrderItem(orderId, itemId, targetTableId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
