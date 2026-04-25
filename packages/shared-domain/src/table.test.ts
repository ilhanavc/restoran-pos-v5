import { describe, expect, it } from 'vitest';
import {
  canOpenOrderOnTable,
  getTableStatusTransition,
  isTableOccupied,
  isValidTableStatusTransition,
} from './table.js';
import type { TableRow } from '@restoran-pos/shared-types';

const makeTable = (status: TableRow['status']): TableRow => ({
  id: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  tableNo: 1,
  label: 'Masa 1',
  capacity: 4,
  zone: null,
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('isTableOccupied', () => {
  it('occupied table → true', () => { expect(isTableOccupied(makeTable('occupied'))).toBe(true); });
  it('available table → false', () => { expect(isTableOccupied(makeTable('available'))).toBe(false); });
});

describe('canOpenOrderOnTable', () => {
  it('available → can open', () => { expect(canOpenOrderOnTable(makeTable('available'))).toBe(true); });
  it('reserved → can open', () => { expect(canOpenOrderOnTable(makeTable('reserved'))).toBe(true); });
  it('occupied → cannot open', () => { expect(canOpenOrderOnTable(makeTable('occupied'))).toBe(false); });
  it('cleaning → cannot open', () => { expect(canOpenOrderOnTable(makeTable('cleaning'))).toBe(false); });
});

describe('isValidTableStatusTransition', () => {
  it('available → occupied valid', () => { expect(isValidTableStatusTransition('available', 'occupied')).toBe(true); });
  it('occupied → cleaning valid', () => { expect(isValidTableStatusTransition('occupied', 'cleaning')).toBe(true); });
  it('cleaning → occupied invalid', () => { expect(isValidTableStatusTransition('cleaning', 'occupied')).toBe(false); });
  it('available → cleaning invalid', () => { expect(isValidTableStatusTransition('available', 'cleaning')).toBe(false); });
});

describe('getTableStatusTransition', () => {
  it('returns valid:true for valid transition', () => {
    const result = getTableStatusTransition('available', 'occupied');
    expect(result.valid).toBe(true);
  });
  it('returns valid:false with reason for invalid', () => {
    const result = getTableStatusTransition('cleaning', 'occupied');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain('cleaning');
  });
});
