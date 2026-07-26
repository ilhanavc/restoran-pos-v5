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
 * Masa listelerinin görüntü sırası (S105 — ürün sahibi: taşıma/aktarma
 * listeleri karışık geliyordu; kaynak listeler sunucudan gelen sırayı taşıyordu
 * ve hiçbir yerde sıralanmıyordu).
 *
 * Kanonik anahtar `display_no` (kalıcı per-bölge numara, ADR-009 Karar A) ve
 * SAYISAL karşılaştırılır. Bölgesiz orphan'ların numarası yoktur → sona düşer
 * ve kendi aralarında `code`'a göre **numeric collator** ile sıralanır:
 * düz metin sıralaması "MASA 10"u "MASA 2"nin önüne koyardı.
 */
export function compareTablesForDisplay(
  a: TableForLabel,
  b: TableForLabel,
): number {
  const na = tableDisplayNumber(a);
  const nb = tableDisplayNumber(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a.code.localeCompare(b.code, 'tr', { numeric: true });
}
