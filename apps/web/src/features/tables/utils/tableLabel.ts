/**
 * Masa görüntü etiketi — ADR-009 Amendment 2026-06-30 Karar A.
 *
 * ESKİ (kusurlu) davranış: aynı bölgedeki masaları `code` ile sıralayıp 1-tabanlı
 * POZİSYONEL ordinal ("Masa N") üretiyordu. Bir masa silinince/eklenince ya da
 * sync ile kod değişince tüm komşuların etiketi KAYIYORDU (fiziksel masayla
 * uyuşmazlık + fişte farklı numara). Karar A bunu KALICI per-bölge `display_no`
 * ile değiştirir: numara DB'de tutulur, silme/ekleme/sync ile sabit kalır.
 *
 * Bu modül artık bir hook (`t`) çağıramayacağı için i18n YAPMAZ; yalnız
 * kanonik NUMARA'yı (`tableDisplayNo`, shared-domain) döner. Çağıran ekran
 * formatlar:
 *   const n = tableDisplayNo(table);
 *   const label = n !== null ? t('tables.tableLabel', { number: n }) : table.code;
 *
 * Cross-ref:
 *   - `apps/web/src/features/tables/TablesListPage.tsx` `tableLabels` Map.
 *   - `apps/web/src/features/orders/OrderScreenPage.tsx` `OrderScreenHeader` props.
 */

import { tableDisplayNo } from '@restoran-pos/shared-domain';

export interface TableForLabel {
  id: string;
  code: string;
  area_id: string | null;
  /** Kalıcı per-bölge görüntü numarası (Karar A); null = bölgesiz orphan. */
  display_no: number | null;
}

/**
 * Hedef masanın kanonik görüntü numarası ya da `null` (bölgesiz orphan →
 * çağıran ham `code`'a düşmeli). shared-domain `tableDisplayNo`'yu sarar;
 * web tarafının tek giriş noktası.
 */
export function tableDisplayNumber(target: TableForLabel): number | null {
  return tableDisplayNo(target);
}

/**
 * Toplu numara Map'i — grid render eden ekranlar (TablesListPage) için.
 * Değer: kanonik display_no veya `null` (bölgesiz → çağıran `code`'a düşer).
 * O(N) tek geçiş — eski O(N log N) per-area sıralama gerekmez (numara DB'den).
 */
export function buildTableDisplayNoMap(
  allTables: ReadonlyArray<TableForLabel>,
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const t of allTables) {
    map.set(t.id, tableDisplayNo(t));
  }
  return map;
}
