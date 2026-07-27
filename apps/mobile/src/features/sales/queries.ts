import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  getOpenOrdersTotal,
  getRevenueForDate,
  type OpenOrdersTotal,
  type TodayRevenue,
} from '../../api/client';

/**
 * Satış sekmesi server-state hook'ları (ADR-026 Amendment 5 K5/K6).
 *
 * Ciro(D) = A(D) + B(D):
 *   A(D) = tahsil edilen  → {@link useRevenueForDate} (gün parametreli)
 *   B(D) = açık adisyonlar → {@link useOpenOrdersTotal} (YALNIZ D = bugün)
 *
 * İki ayrı endpoint bilinçlidir: A pencere-bağlı bir rapor, B "şu an" anlık
 * göstergesi — farklı yaşam döngüleri (ADR-026 Amd5, reddedilen Alternatif G).
 */

/**
 * Seçili günün TAHSİL EDİLMİŞ cirosu. Cache anahtarı güne bağlıdır → gün
 * gezginiyle ileri-geri gidildiğinde ziyaret edilen günler yeniden istek
 * atmadan gösterilir.
 */
export function useRevenueForDate(date: string): UseQueryResult<TodayRevenue> {
  return useQuery({
    queryKey: ['reports', 'revenue', date],
    queryFn: () => getRevenueForDate(date),
    staleTime: 60_000,
  });
}

/**
 * Açık adisyonlarda tahsil edilecek toplam (masa + paket).
 *
 * `enabled` ile korunur: geçmiş bir gün seçiliyken "şu an açık" kavramı
 * yoktur (K5) → istek HİÇ atılmaz. Ekran zaten yalnız admin/cashier'a kayıtlı
 * olduğundan rol filtresi sekme seviyesindedir.
 */
export function useOpenOrdersTotal(
  enabled: boolean,
): UseQueryResult<OpenOrdersTotal> {
  return useQuery({
    queryKey: ['reports', 'open-orders-total'],
    queryFn: getOpenOrdersTotal,
    enabled,
    // Açık adisyon toplamı ödeme/sipariş hareketiyle sık değişir; ciro
    // rakamından daha kısa taze-kalma süresi.
    staleTime: 30_000,
  });
}
