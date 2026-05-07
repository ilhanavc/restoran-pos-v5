/**
 * Bölge-içi masa etiket util'i — v3 paritesi (`tableUtils.js:masaLabelInArea`).
 *
 * Session 53d fix: Anasayfada "BAHÇE > Masa 1" tıklandığında sipariş alma
 * ekranında DB'deki `table.code` (örn. "Masa 26", global) yerine bölge-içi
 * ordinal ("Masa 1") gösterilmeli. Aksi takdirde kullanıcı kafası karışır:
 * tıkladığı kart "Masa 1" gösterirken header "Masa 26" der.
 *
 * Kural (v3 paritesi):
 *   1. Aynı `area_id`'ye sahip masaları topla (peers).
 *   2. `code` field'ını Türkçe locale + numeric collator ile sırala
 *      (örn. "M-2" < "M-10").
 *   3. Hedef masanın sıralı listedeki 1-tabanlı pozisyonunu döndür → "Masa N".
 *   4. Bölge yoksa (area_id null) `table.code` aynen kullanılır (admin orphan).
 *
 * Cross-ref:
 *   - `apps/web/src/features/tables/TablesListPage.tsx` `tableLabels` Map (refactored).
 *   - `apps/web/src/features/orders/OrderScreenPage.tsx` `OrderScreenHeader` props.
 *   - V3: `D:/dev/restoran-pos-v3/client/src/utils/tableUtils.js:masaLabelInArea`.
 */

export interface TableForLabel {
  id: string;
  code: string;
  area_id: string | null;
}

/**
 * Hedef masanın bölge-içi 1-tabanlı sıra etiketini döner ("Masa 1", "Masa 2"...).
 * Bölgesiz (`area_id === null`) masalarda DB code'u aynen döner (admin akışı).
 *
 * `allTables` parametresi tüm masaların listesi (genelde `useTables().data`);
 * util kendi içinde aynı `area_id`'li peers'ı filtreler ve sıralar. Hedef
 * tablo listede yoksa fallback olarak `target.code` döner.
 */
export function masaLabelInArea(
  target: TableForLabel,
  allTables: ReadonlyArray<TableForLabel>,
): string {
  if (target.area_id === null) {
    return target.code;
  }
  const peers = allTables
    .filter((t) => t.area_id === target.area_id)
    .sort((a, b) =>
      a.code.localeCompare(b.code, 'tr', { numeric: true }),
    );
  const idx = peers.findIndex((t) => t.id === target.id);
  if (idx === -1) {
    // Defansif: target zaten aynı `area_id`'li olmalıydı.
    return target.code;
  }
  return `Masa ${idx + 1}`;
}

/**
 * Toplu etiket Map'i — TablesListPage gibi grid render eden ekranlar için.
 * Bölgesiz masalar `code` aynen döner. Aynı bölgedeki tüm masalar tek geçişte
 * sıralanır → O(N log N) per area, toplam O(N log N).
 */
export function buildTableLabelMap(
  allTables: ReadonlyArray<TableForLabel>,
): Map<string, string> {
  const map = new Map<string, string>();
  // area_id'ye göre grupla.
  const byArea = new Map<string | null, TableForLabel[]>();
  for (const t of allTables) {
    const key = t.area_id;
    const list = byArea.get(key);
    if (list === undefined) byArea.set(key, [t]);
    else list.push(t);
  }
  for (const [areaId, peers] of byArea) {
    if (areaId === null) {
      // Bölgesiz masalar: code aynen.
      for (const t of peers) map.set(t.id, t.code);
      continue;
    }
    const sorted = [...peers].sort((a, b) =>
      a.code.localeCompare(b.code, 'tr', { numeric: true }),
    );
    sorted.forEach((t, idx) => {
      map.set(t.id, `Masa ${idx + 1}`);
    });
  }
  return map;
}
