import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getKdsOrders } from '../../api/client';
import type { KdsOrder } from '../../api/schemas';

/** Web KDS ile AYNI cache anahtarı (tek kontrat, tek endpoint). */
export const KDS_ORDERS_KEY = ['kds', 'orders'] as const;

/**
 * Mutfak kuyruğu (ADR-026 Amendment 5 K7).
 *
 * Tazeleme üç yoldan: ekran odaklanınca refetch (ekran tarafında), aşağı
 * çekince (pull-to-refresh) ve **yalnız ekran odaklıyken** 30 sn poll.
 * Odaklı değilken `refetchInterval=false` → arka planda pil/veri harcanmaz;
 * uygulama arka plandayken TanStack `focusManager` (M10-A-02) zaten durdurur.
 * Socket genişletmesi YAPILMAZ (`kitchen.*` odası role:kitchen'da kalır).
 *
 * @param isFocused Sekme şu an ekranda mı (`useIsFocused`).
 */
export function useKdsOrders(isFocused: boolean): UseQueryResult<KdsOrder[]> {
  return useQuery({
    queryKey: KDS_ORDERS_KEY,
    queryFn: getKdsOrders,
    refetchInterval: isFocused ? 30_000 : false,
    staleTime: 15_000,
  });
}
