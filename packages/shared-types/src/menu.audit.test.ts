import { describe, it, expect } from 'vitest';
import {
  CategoryCreateRequestSchema,
  CategoryUpdateRequestSchema,
  ProductCreateRequestSchema,
  ProductUpdateRequestSchema,
  ProductVariantWriteSchema,
  ProductReorderRequestSchema,
  CategoriesReorderRequestSchema,
  CategoryIconSchema,
  CategoryColorSchema,
} from './menu.js';

const VALID_CATEGORY_ID = '11111111-1111-1111-1111-111111111111';

/**
 * QA — Blok 2 / Hat C — menu.ts sınır-zorlama testleri (ADDITIVE, GREEN).
 */

describe('menu.ts — CategoryCreateRequestSchema / UpdateRequestSchema (audit)', () => {
  it('geçerli minimum payload kabul eder', () => {
    const r = CategoryCreateRequestSchema.safeParse({ name: 'Pideler' });
    expect(r.success).toBe(true);
  });

  it('name boş string reddeder (min 1)', () => {
    const r = CategoryCreateRequestSchema.safeParse({ name: '' });
    expect(r.success).toBe(false);
  });

  it('name 65 karakter reddeder (max 64)', () => {
    const r = CategoryCreateRequestSchema.safeParse({ name: 'A'.repeat(65) });
    expect(r.success).toBe(false);
  });

  it('name unicode Türkçe karakter (Çiğköfte) kabul eder', () => {
    const r = CategoryCreateRequestSchema.safeParse({ name: 'Çiğköfteler' });
    expect(r.success).toBe(true);
  });

  it('icon whitelist dışı değer reddeder', () => {
    const r = CategoryCreateRequestSchema.safeParse({ name: 'Pideler', icon: 'Rocket' });
    expect(r.success).toBe(false);
  });

  it('color whitelist dışı hex değer reddeder (closed-set)', () => {
    const r = CategoryCreateRequestSchema.safeParse({ name: 'Pideler', color: '#000000' });
    expect(r.success).toBe(false);
  });

  it('boş PATCH body reddeder (patch:empty_body)', () => {
    const r = CategoryUpdateRequestSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('sortOrder negatif reddeder', () => {
    const r = CategoryUpdateRequestSchema.safeParse({ sortOrder: -1 });
    expect(r.success).toBe(false);
  });
});

describe('menu.ts — ProductCreateRequestSchema / UpdateRequestSchema — para alanı (audit)', () => {
  const base = { categoryId: VALID_CATEGORY_ID, name: 'Karışık Pide', priceCents: 15000 };

  it('geçerli minimum payload kabul eder', () => {
    const r = ProductCreateRequestSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('priceCents negatif reddeder', () => {
    const r = ProductCreateRequestSchema.safeParse({ ...base, priceCents: -100 });
    expect(r.success).toBe(false);
  });

  it('priceCents float (150.5) reddeder', () => {
    const r = ProductCreateRequestSchema.safeParse({ ...base, priceCents: 150.5 });
    expect(r.success).toBe(false);
  });

  it('priceCents string ("15000") reddeder — no coerce', () => {
    const r = ProductCreateRequestSchema.safeParse({ ...base, priceCents: '15000' });
    expect(r.success).toBe(false);
  });

  it('priceCents=0 kabul eder (ücretsiz ikram ürünü olabilir)', () => {
    const r = ProductCreateRequestSchema.safeParse({ ...base, priceCents: 0 });
    expect(r.success).toBe(true);
  });

  it('priceCents NaN reddeder', () => {
    const r = ProductCreateRequestSchema.safeParse({ ...base, priceCents: NaN });
    expect(r.success).toBe(false);
  });

  it('name 129 karakter reddeder (max 128)', () => {
    const r = ProductCreateRequestSchema.safeParse({ ...base, name: 'A'.repeat(129) });
    expect(r.success).toBe(false);
  });

  it('description 1001 karakter reddeder (max 1000)', () => {
    const r = ProductCreateRequestSchema.safeParse({ ...base, description: 'A'.repeat(1001) });
    expect(r.success).toBe(false);
  });

  it('categoryId geçersiz UUID reddeder', () => {
    const r = ProductCreateRequestSchema.safeParse({ ...base, categoryId: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });

  it('boş PATCH body reddeder (patch:empty_body)', () => {
    const r = ProductUpdateRequestSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('menu.ts — ProductVariantWriteSchema + is_default superRefine (audit)', () => {
  it('birden fazla isDefault=true reddeder (variants:multiple_default)', () => {
    const r = ProductCreateRequestSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      name: 'Pide',
      priceCents: 10000,
      variants: [
        { name: 'Küçük', priceDeltaCents: -500, isDefault: true },
        { name: 'Büyük', priceDeltaCents: 500, isDefault: true },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('hiç isDefault=true olmayan variants array reddeder (variants:no_default)', () => {
    const r = ProductCreateRequestSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      name: 'Pide',
      priceCents: 10000,
      variants: [{ name: 'Küçük', priceDeltaCents: -500, isDefault: false }],
    });
    expect(r.success).toBe(false);
  });

  it('tam 1 isDefault=true kabul eder', () => {
    const r = ProductCreateRequestSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      name: 'Pide',
      priceCents: 10000,
      variants: [{ name: 'Küçük', priceDeltaCents: -500, isDefault: true }],
    });
    expect(r.success).toBe(true);
  });

  it('boş variants array kuralı devre dışı bırakır (variantsız ürün geçerli)', () => {
    const r = ProductCreateRequestSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      name: 'Pide',
      priceCents: 10000,
      variants: [],
    });
    expect(r.success).toBe(true);
  });

  it('51 variant reddeder (max 50)', () => {
    const variants = Array.from({ length: 51 }, (_, i) => ({
      name: `V${i}`,
      priceDeltaCents: 0,
      isDefault: i === 0,
    }));
    const r = ProductCreateRequestSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      name: 'Pide',
      priceCents: 10000,
      variants,
    });
    expect(r.success).toBe(false);
  });

  it('ProductVariantWriteSchema priceDeltaCents aşırı negatif (-999999999999) kabul eder — SD-T-C-05 kanıtı', () => {
    const r = ProductVariantWriteSchema.safeParse({
      name: 'Aşırı İskonto',
      priceDeltaCents: -999_999_999_999,
    });
    expect(r.success).toBe(true);
  });

  it('sortOrder 32768 reddeder (SMALLINT max 32767)', () => {
    const r = ProductVariantWriteSchema.safeParse({
      name: 'Küçük',
      priceDeltaCents: 0,
      sortOrder: 32768,
    });
    expect(r.success).toBe(false);
  });
});

describe('menu.ts — reorder request şemaları (audit)', () => {
  it('ProductReorderRequestSchema boş productIds reddeder', () => {
    const r = ProductReorderRequestSchema.safeParse({ productIds: [] });
    expect(r.success).toBe(false);
  });

  it('CategoriesReorderRequestSchema geçersiz UUID içeren dizi reddeder', () => {
    const r = CategoriesReorderRequestSchema.safeParse({ categoryIds: ['xyz'] });
    expect(r.success).toBe(false);
  });

  it('CategoryIconSchema/CategoryColorSchema closed-set whitelist dışını reddeder', () => {
    expect(CategoryIconSchema.safeParse('Rocket').success).toBe(false);
    expect(CategoryColorSchema.safeParse('#ffffff').success).toBe(false);
    expect(CategoryIconSchema.safeParse('Pizza').success).toBe(true);
  });
});
