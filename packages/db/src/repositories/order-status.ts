import type { OrderStatus } from '../generated.js';

/**
 * "Açık adisyon" = terminal olmayan sipariş. ADR-003 §14.2.B + addItems
 * guard (terminal status → ORDER_INVARIANT_VIOLATED) ile hizalı: ödenmiş,
 * iptal, void veya (ADR-029) başka adisyona birleştirilmiş sipariş kapalıdır,
 * geri kalanı (open/sent_to_kitchen/partially_served/served/billed) açıktır.
 *
 * Bu sabit `orders.ts` + `tables.ts` (board occupancy + silme-guard) +
 * `areas.ts` (bölge-doluluk guard) tarafından tek kaynaktan tüketilir; ayrı
 * modülde tutulur ki repository'ler arası circular import oluşmasın (orders.ts
 * büyük; tables/areas ondan import ederse cycle riski). Yeni bir terminal
 * statü eklenirse yalnız burası + Migration index whitelist güncellenir.
 */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'paid',
  'cancelled',
  'void',
  'merged',
];
