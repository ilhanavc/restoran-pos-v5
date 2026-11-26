import type { TableRow, TableStatus } from '@restoran-pos/shared-types';

const VALID_TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  available: ['occupied', 'reserved'],
  occupied: ['cleaning', 'available'],
  reserved: ['occupied', 'available'],
  cleaning: ['available'],
};

export function isTableOccupied(table: TableRow): boolean {
  return table.status === 'occupied';
}

export function canOpenOrderOnTable(table: TableRow): boolean {
  return table.status === 'available' || table.status === 'reserved';
}

export function isValidTableStatusTransition(from: TableStatus, to: TableStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getTableStatusTransition(
  from: TableStatus,
  to: TableStatus,
): { valid: true; from: TableStatus; to: TableStatus } | { valid: false; reason: string } {
  if (isValidTableStatusTransition(from, to)) {
    return { valid: true, from, to };
  }
  return { valid: false, reason: `Invalid transition: ${from} → ${to}` };
}

/**
 * Kanonik masa görüntü etiketi (ADR-009 Amendment 2026-06-30 Karar A).
 *
 * Masa etiketi TEK kaynaktan türetilir: bölgeli + `display_no` atanmış masa →
 * kalıcı per-bölge "Masa {display_no}" — silme/ekleme/sync ile KAYMAZ, fiziksel
 * masa etiketiyle eşleşir (eski pozisyonel ordinal kusurunu giderir). Bölgesiz
 * (orphan, `display_no === null`) masa → ham `code`. Web + mobil board/header/
 * modal + backend snapshot/fiş/KDS HEPSİ bu util'i kullanır → tek isim uzayı
 * (eski 4-namespace uyuşmazlığı; fiş ile ekranın farklı masa göstermesi giderildi).
 */
export interface TableLabelInput {
  code: string;
  area_id: string | null;
  display_no: number | null;
}

/**
 * Bölge-içi kalıcı görüntü numarası ya da `null` (bölgesiz → çağıran `code`'a düşer).
 * Frontend i18n için: `n !== null ? t('tables.tableLabel', { number: n }) : code`
 * (hardcoded "Masa" yasağı — string'i i18n key üretir).
 */
export function tableDisplayNo(t: TableLabelInput): number | null {
  return t.area_id !== null && t.display_no !== null ? t.display_no : null;
}

/**
 * Tam etiket string'i — backend snapshot/fiş/KDS için ("Masa N" veya ham `code`).
 * Bu Türkçe literal yalnız backend (i18n'siz) içindir; frontend `tableDisplayNo`
 * + i18n key kullanır.
 */
export function tableLabel(t: TableLabelInput): string {
  const n = tableDisplayNo(t);
  return n !== null ? `Masa ${n}` : t.code;
}

/**
 * "Bölgesiz" (orphan) sözde-grup sentinel'i — ADR-009 Amendment 2026-06-30
 * Karar C(b)/D. `selectedAreaId` bu değere eşitse filtre `area_id === null`
 * masaları döndürür. Gerçek bölge id'leri UUID olduğundan bu literal ile
 * ÇAKIŞMAZ. Web + mobil TEK kaynaktan (bu sabit) türetir — eskiden her frontend
 * kendi lokal sentinel'ini tutuyordu (drift riski).
 */
export const UNASSIGNED_AREA = '__unassigned__';

/**
 * Masa tahtası grup filtresi + sıralaması için gereken minimum masa şekli
 * (ADR-009 Amendment 2026-06-30 Karar D). Web `ApiTable` + mobil `ApiTable`
 * ikisi de bu alanları içerir; util generic `<T extends VisibleTableInput>`
 * ile tam satırı korur (projeksiyon alanları kaybolmaz).
 */
export interface VisibleTableInput {
  area_id: string | null;
  status: TableStatus;
  /** Kalıcı per-bölge görüntü numarası; null = bölgesiz orphan (Karar A). */
  display_no: number | null;
  code: string;
}

/**
 * Seçili gruba (`selectedAreaId`) ait masaları filtreler — `UNASSIGNED_AREA`
 * ise bölgesiz orphan'lar (`area_id === null`), aksi halde o bölgenin masaları.
 * SAF: girdiyi mutasyona uğratmaz, yeni array döndürmez (yalnız filter helper).
 */
function filterGroup<T extends VisibleTableInput>(
  tables: readonly T[],
  selectedAreaId: string,
): T[] {
  if (selectedAreaId === UNASSIGNED_AREA) {
    return tables.filter((tbl) => tbl.area_id === null);
  }
  return tables.filter((tbl) => tbl.area_id === selectedAreaId);
}

/**
 * Masa tahtası görünür + SIRALI masa listesi (ADR-009 Amendment 2026-06-30
 * Karar D — web + mobil TEK sıralama kaynağı; eskiden her frontend inline
 * `code.localeCompare` yapıyordu, web occupied-first sıralamadan yoksundu).
 *
 * Sıra kuralı (ADR-009 Karar D Amendment 2026-06-30):
 *   1. YALNIZ bölgesiz ("Bölgesiz"/orphan) grupta dolu (occupied) masalar ÖNCE —
 *      bu grupta `display_no` yok (hepsi null), kalıcı fiziksel sıra da yok, o
 *      yüzden garsonun açık adisyonu üste taşımak güvenli. Gerçek bölgelerde bu
 *      taşıma UYGULANMAZ: masa kartları fiziksel `display_no` ile sabit kalır
 *      (dolunca yerinden zıplamaz → garson konumdan tanır).
 *   2. `display_no` artan — null (orphan) EN SONA (+Infinity).
 *   3. Eşitlikte `code` doğal-sayı-duyarlı Türkçe sıralama (`localeCompare`).
 *
 * SAF: `tables` mutasyona uğramaz — her zaman YENİ array döner.
 */
export function selectVisibleTables<T extends VisibleTableInput>(
  tables: readonly T[],
  selectedAreaId: string,
): T[] {
  const group = filterGroup(tables, selectedAreaId);
  const isOrphan = selectedAreaId === UNASSIGNED_AREA;
  // Kopya üzerinde sort — girdi immutable (readonly kontratı).
  return [...group].sort((a, b) => {
    // Occupied-first YALNIZ bölgesiz grupta; gerçek bölgeler display_no-sabit.
    if (isOrphan) {
      const aOccupied = a.status === 'occupied' ? 0 : 1;
      const bOccupied = b.status === 'occupied' ? 0 : 1;
      if (aOccupied !== bOccupied) return aOccupied - bOccupied;
    }
    // null display_no (orphan) sıralamada en sona düşer.
    const aNo = a.display_no ?? Number.POSITIVE_INFINITY;
    const bNo = b.display_no ?? Number.POSITIVE_INFINITY;
    if (aNo !== bNo) return aNo - bNo;
    return a.code.localeCompare(b.code, 'tr', { numeric: true });
  });
}

/**
 * Seçili grubun (dolu/toplam) sayacı — pill/tab rozeti için (Karar D).
 * `selectVisibleTables` ile AYNI grup filtresini kullanır → web + mobil
 * rozet matematiği birebir aynı (eskiden her frontend kendi reduce'unu yazıyordu).
 */
export function groupOccupiedTotal<T extends VisibleTableInput>(
  tables: readonly T[],
  selectedAreaId: string,
): { occupied: number; total: number } {
  const group = filterGroup(tables, selectedAreaId);
  const occupied = group.filter((tbl) => tbl.status === 'occupied').length;
  return { occupied, total: group.length };
}
