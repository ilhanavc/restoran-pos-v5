import { describe, it, expect } from 'vitest';
import {
  AreaSchema,
  AreaCreateRequestSchema,
  AreaUpdateRequestSchema,
  TableAreaAssignRequestSchema,
  AreaSyncRequestSchema,
} from './area.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('AreaCreateRequestSchema — sınır testleri', () => {
  it('name 1..40 karakter kabul, 0 ve 41 reddeder', () => {
    expect(AreaCreateRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(AreaCreateRequestSchema.safeParse({ name: 'a'.repeat(40) }).success).toBe(true);
    expect(AreaCreateRequestSchema.safeParse({ name: 'a'.repeat(41) }).success).toBe(false);
  });

  it('name Türkçe karakterli gerçekçi girdi kabul eder', () => {
    expect(AreaCreateRequestSchema.safeParse({ name: 'Bahçe Katı' }).success).toBe(true);
  });

  it('sortOrder 0..32767 (SMALLINT) sınırını zorlar', () => {
    expect(AreaCreateRequestSchema.safeParse({ name: 'A', sortOrder: 0 }).success).toBe(true);
    expect(AreaCreateRequestSchema.safeParse({ name: 'A', sortOrder: 32767 }).success).toBe(true);
    expect(AreaCreateRequestSchema.safeParse({ name: 'A', sortOrder: 32768 }).success).toBe(false);
    expect(AreaCreateRequestSchema.safeParse({ name: 'A', sortOrder: -1 }).success).toBe(false);
  });

  it('sortOrder float reddeder', () => {
    expect(AreaCreateRequestSchema.safeParse({ name: 'A', sortOrder: 1.5 }).success).toBe(false);
  });
});

describe('AreaUpdateRequestSchema — boş body refine', () => {
  it('boş body reddeder (patch:empty_body)', () => {
    expect(AreaUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it('yalnız name ile geçerli sayılır', () => {
    expect(AreaUpdateRequestSchema.safeParse({ name: 'Teras' }).success).toBe(true);
  });
});

describe('TableAreaAssignRequestSchema — snake_case body', () => {
  it('area_id null kabul eder (unassign)', () => {
    expect(TableAreaAssignRequestSchema.safeParse({ area_id: null }).success).toBe(true);
  });

  it('area_id geçersiz UUID reddeder', () => {
    expect(TableAreaAssignRequestSchema.safeParse({ area_id: 'bolge-1' }).success).toBe(false);
  });

  it('area_id eksikse reddeder (required, optional değil)', () => {
    expect(TableAreaAssignRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('AreaSyncRequestSchema — count sınırı', () => {
  it('0..100 aralığını kabul eder', () => {
    expect(AreaSyncRequestSchema.safeParse({ count: 0 }).success).toBe(true);
    expect(AreaSyncRequestSchema.safeParse({ count: 100 }).success).toBe(true);
  });

  it('100 üstü / negatif reddeder', () => {
    expect(AreaSyncRequestSchema.safeParse({ count: 101 }).success).toBe(false);
    expect(AreaSyncRequestSchema.safeParse({ count: -1 }).success).toBe(false);
  });
});

describe('AreaSchema — entity (soft-delete alanı dahil)', () => {
  it('deletedAt null (aktif bölge) kabul eder', () => {
    const area = {
      id: VALID_UUID,
      tenantId: VALID_UUID,
      name: 'Salon',
      sortOrder: 0,
      deletedAt: null,
      createdAt: '2026-07-11T10:00:00.000Z',
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    expect(AreaSchema.safeParse(area).success).toBe(true);
  });

  it('sortOrder negatifse entity şeması bile reddeder (nonnegative)', () => {
    const area = {
      id: VALID_UUID,
      tenantId: VALID_UUID,
      name: 'Salon',
      sortOrder: -1,
      deletedAt: null,
      createdAt: '2026-07-11T10:00:00.000Z',
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    expect(AreaSchema.safeParse(area).success).toBe(false);
  });
});
