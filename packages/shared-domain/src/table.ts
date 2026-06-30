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
