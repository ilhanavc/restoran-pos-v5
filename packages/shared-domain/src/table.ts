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
