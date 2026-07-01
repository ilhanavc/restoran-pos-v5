import { describe, expect, it } from 'vitest';
import {
  canOpenOrderOnTable,
  getTableStatusTransition,
  groupOccupiedTotal,
  isTableOccupied,
  isValidTableStatusTransition,
  selectVisibleTables,
  UNASSIGNED_AREA,
  type VisibleTableInput,
} from './table.js';
import type { TableRow, TableStatus } from '@restoran-pos/shared-types';

const makeTable = (status: TableRow['status']): TableRow => ({
  id: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  tableNo: 1,
  label: 'Masa 1',
  capacity: 4,
  zone: null,
  areaId: null,
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

// ADR-009 Amendment 2026-06-30 Karar D — masa tahtası grup filtresi + sıralama.
const AREA_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const AREA_B = 'bbbbbbbb-0000-0000-0000-000000000002';

const makeVisible = (
  overrides: Partial<VisibleTableInput> & Pick<VisibleTableInput, 'code'>,
): VisibleTableInput => ({
  area_id: AREA_A,
  status: 'available' as TableStatus,
  display_no: null,
  ...overrides,
});

describe('selectVisibleTables — grup filtresi', () => {
  it('seçili bölgenin masalarını döndürür (diğer bölge + orphan hariç)', () => {
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'A1', area_id: AREA_A, display_no: 1 }),
      makeVisible({ code: 'B1', area_id: AREA_B, display_no: 1 }),
      makeVisible({ code: 'X', area_id: null, display_no: null }),
    ];
    const result = selectVisibleTables(tables, AREA_A);
    expect(result.map((t) => t.code)).toEqual(['A1']);
  });

  it('UNASSIGNED_AREA seçiliyse yalnız bölgesiz (area_id=null) orphan döndürür', () => {
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'A1', area_id: AREA_A, display_no: 1 }),
      makeVisible({ code: 'X', area_id: null, display_no: null }),
      makeVisible({ code: 'Y', area_id: null, display_no: null }),
    ];
    const result = selectVisibleTables(tables, UNASSIGNED_AREA);
    expect(result.map((t) => t.code).sort()).toEqual(['X', 'Y']);
  });

  it('boş girdi → boş array', () => {
    expect(selectVisibleTables([], AREA_A)).toEqual([]);
  });

  it('eşleşen masa yoksa boş array', () => {
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'B1', area_id: AREA_B, display_no: 1 }),
    ];
    expect(selectVisibleTables(tables, AREA_A)).toEqual([]);
  });
});

describe('selectVisibleTables — sıralama', () => {
  it('BÖLGESIZ (orphan) grupta dolu masalar önce (occupied-first)', () => {
    // Orphan grup: display_no yok (hepsi null), fiziksel sıra yok → dolu üste.
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'X1', area_id: null, display_no: null, status: 'available' }),
      makeVisible({ code: 'X2', area_id: null, display_no: null, status: 'occupied' }),
      makeVisible({ code: 'X3', area_id: null, display_no: null, status: 'available' }),
    ];
    const result = selectVisibleTables(tables, UNASSIGNED_AREA);
    // X2 (occupied) ilk sırada; kalanlar code doğal-sayı-duyarlı (X1, X3).
    expect(result.map((t) => t.code)).toEqual(['X2', 'X1', 'X3']);
  });

  it('GERÇEK bölgede sıralama display_no-sabit — dolu masa üste ZIPLAMAZ', () => {
    // ADR-009 Karar D Amendment: gerçek bölgede occupied-first UYGULANMAZ; masa
    // kartı fiziksel display_no ile yerinde kalır (dolunca konumdan tanınır).
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'A1', display_no: 1, status: 'available' }),
      makeVisible({ code: 'A2', display_no: 2, status: 'occupied' }),
      makeVisible({ code: 'A3', display_no: 3, status: 'available' }),
    ];
    const result = selectVisibleTables(tables, AREA_A);
    // display_no sırası korunur [1,2,3]; occupied A2 üste TAŞINMAZ.
    expect(result.map((t) => t.display_no)).toEqual([1, 2, 3]);
  });

  it('aynı doluluk içinde display_no artan sıralanır', () => {
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'A3', display_no: 3 }),
      makeVisible({ code: 'A1', display_no: 1 }),
      makeVisible({ code: 'A2', display_no: 2 }),
    ];
    const result = selectVisibleTables(tables, AREA_A);
    expect(result.map((t) => t.display_no)).toEqual([1, 2, 3]);
  });

  it('display_no null olan masa EN SONA düşer (+Infinity)', () => {
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'A-null', display_no: null }),
      makeVisible({ code: 'A2', display_no: 2 }),
      makeVisible({ code: 'A1', display_no: 1 }),
    ];
    const result = selectVisibleTables(tables, AREA_A);
    expect(result.map((t) => t.code)).toEqual(['A1', 'A2', 'A-null']);
  });

  it('eşit display_no → code doğal-sayı-duyarlı sıralanır (10 > 2)', () => {
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'Masa 10', display_no: null }),
      makeVisible({ code: 'Masa 2', display_no: null }),
      makeVisible({ code: 'Masa 1', display_no: null }),
    ];
    const result = selectVisibleTables(tables, AREA_A);
    // numeric:true → "Masa 2" < "Masa 10" (leksikografik değil).
    expect(result.map((t) => t.code)).toEqual(['Masa 1', 'Masa 2', 'Masa 10']);
  });

  it('girdi array mutasyona uğramaz (saf)', () => {
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'A2', display_no: 2, status: 'occupied' }),
      makeVisible({ code: 'A1', display_no: 1, status: 'available' }),
    ];
    const snapshot = tables.map((t) => t.code);
    selectVisibleTables(tables, AREA_A);
    expect(tables.map((t) => t.code)).toEqual(snapshot);
  });
});

describe('groupOccupiedTotal', () => {
  it('seçili bölge için (dolu/toplam) sayar', () => {
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'A1', status: 'occupied' }),
      makeVisible({ code: 'A2', status: 'available' }),
      makeVisible({ code: 'A3', status: 'occupied' }),
      makeVisible({ code: 'B1', area_id: AREA_B, status: 'occupied' }),
    ];
    expect(groupOccupiedTotal(tables, AREA_A)).toEqual({
      occupied: 2,
      total: 3,
    });
  });

  it('UNASSIGNED_AREA için orphan (dolu/toplam) sayar', () => {
    const tables: VisibleTableInput[] = [
      makeVisible({ code: 'X', area_id: null, status: 'occupied' }),
      makeVisible({ code: 'Y', area_id: null, status: 'available' }),
      makeVisible({ code: 'A1', area_id: AREA_A, status: 'occupied' }),
    ];
    expect(groupOccupiedTotal(tables, UNASSIGNED_AREA)).toEqual({
      occupied: 1,
      total: 2,
    });
  });

  it('boş girdi → {occupied:0, total:0}', () => {
    expect(groupOccupiedTotal([], AREA_A)).toEqual({ occupied: 0, total: 0 });
  });
});
