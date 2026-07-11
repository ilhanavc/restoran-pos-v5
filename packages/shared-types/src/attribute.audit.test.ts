import { describe, it, expect } from 'vitest';
import {
  AttributeSelectionTypeEnum,
  AttributeGroupCreateRequestSchema,
  AttributeGroupUpdateRequestSchema,
  AttributeOptionSchema,
  AttributeOptionCreateRequestSchema,
  AttributeOptionUpdateRequestSchema,
  EffectiveAttributeGroupSchema,
} from './attribute.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('AttributeSelectionTypeEnum', () => {
  it('single/multiple kabul eder, başka değer reddeder', () => {
    expect(AttributeSelectionTypeEnum.safeParse('single').success).toBe(true);
    expect(AttributeSelectionTypeEnum.safeParse('multiple').success).toBe(true);
    expect(AttributeSelectionTypeEnum.safeParse('any').success).toBe(false);
  });
});

describe('AttributeGroupCreateRequestSchema — sınır testleri', () => {
  const base = { name: 'Boyut', selectionType: 'single' as const };

  it('name 1..60 karakter kabul, 61 reddeder', () => {
    expect(
      AttributeGroupCreateRequestSchema.safeParse({ ...base, name: 'a'.repeat(60) }).success,
    ).toBe(true);
    expect(
      AttributeGroupCreateRequestSchema.safeParse({ ...base, name: 'a'.repeat(61) }).success,
    ).toBe(false);
  });

  it('isRequired/sortOrder verilmezse default uygular', () => {
    const r = AttributeGroupCreateRequestSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.isRequired).toBe(false);
      expect(r.data.sortOrder).toBe(0);
    }
  });

  it('sortOrder SMALLINT üst sınırını (32767) zorlar', () => {
    expect(
      AttributeGroupCreateRequestSchema.safeParse({ ...base, sortOrder: 32768 }).success,
    ).toBe(false);
  });
});

describe('AttributeGroupUpdateRequestSchema — boş body refine', () => {
  it('boş body reddeder', () => {
    expect(AttributeGroupUpdateRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('AttributeOptionSchema / CreateRequestSchema — extraPriceCents ±10000 sınırı (ADR-012 Karar 4)', () => {
  it('sınır değerleri ±10000 kabul eder', () => {
    expect(
      AttributeOptionCreateRequestSchema.safeParse({ name: 'Büyük', extraPriceCents: 10000 }).success,
    ).toBe(true);
    expect(
      AttributeOptionCreateRequestSchema.safeParse({ name: 'İndirim', extraPriceCents: -10000 }).success,
    ).toBe(true);
  });

  it('±10000 dışını reddeder', () => {
    expect(
      AttributeOptionCreateRequestSchema.safeParse({ name: 'Aşırı', extraPriceCents: 10001 }).success,
    ).toBe(false);
    expect(
      AttributeOptionCreateRequestSchema.safeParse({ name: 'Aşırı', extraPriceCents: -10001 }).success,
    ).toBe(false);
  });

  it('extraPriceCents float reddeder (para kuralı — integer kuruş)', () => {
    expect(
      AttributeOptionCreateRequestSchema.safeParse({ name: 'Orta', extraPriceCents: 5.5 }).success,
    ).toBe(false);
  });

  it('extraPriceCents verilmezse default 0', () => {
    const r = AttributeOptionCreateRequestSchema.safeParse({ name: 'Normal' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.extraPriceCents).toBe(0);
  });

  it('AttributeOptionSchema (entity) aynı ±10000 sınırını korur', () => {
    const opt = {
      id: VALID_UUID,
      tenantId: VALID_UUID,
      groupId: VALID_UUID,
      name: 'Büyük',
      extraPriceCents: 20000,
      isDefault: false,
      sortOrder: 0,
      deletedAt: null,
      createdAt: '2026-07-11T10:00:00.000Z',
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    expect(AttributeOptionSchema.safeParse(opt).success).toBe(false);
  });
});

describe('AttributeOptionUpdateRequestSchema — boş body refine', () => {
  it('boş body reddeder', () => {
    expect(AttributeOptionUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it('yalnız isDefault:false ile geçerli sayılır', () => {
    expect(AttributeOptionUpdateRequestSchema.safeParse({ isDefault: false }).success).toBe(true);
  });
});

describe('EffectiveAttributeGroupSchema — extend + nested array', () => {
  it('geçerli product/category source + boş options array kabul eder', () => {
    const group = {
      id: VALID_UUID,
      tenantId: VALID_UUID,
      name: 'Boyut',
      selectionType: 'single' as const,
      isRequired: true,
      sortOrder: 0,
      deletedAt: null,
      createdAt: '2026-07-11T10:00:00.000Z',
      updatedAt: '2026-07-11T10:00:00.000Z',
      source: 'product' as const,
      options: [],
    };
    expect(EffectiveAttributeGroupSchema.safeParse(group).success).toBe(true);
  });

  it('source alanı yalnız product/category kabul eder', () => {
    const group = {
      id: VALID_UUID,
      tenantId: VALID_UUID,
      name: 'Boyut',
      selectionType: 'single' as const,
      isRequired: true,
      sortOrder: 0,
      deletedAt: null,
      createdAt: '2026-07-11T10:00:00.000Z',
      updatedAt: '2026-07-11T10:00:00.000Z',
      source: 'imported' as unknown,
      options: [],
    };
    expect(EffectiveAttributeGroupSchema.safeParse(group).success).toBe(false);
  });
});
