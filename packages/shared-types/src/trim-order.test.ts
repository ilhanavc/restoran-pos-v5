import { describe, it, expect } from 'vitest';
import { AreaCreateRequestSchema } from './area.js';
import {
  AttributeGroupCreateRequestSchema,
  AttributeOptionCreateRequestSchema,
} from './attribute.js';
import { CategoryCreateRequestSchema, ProductCreateRequestSchema } from './menu.js';
import { TableCreateRequestSchema } from './table.js';

/**
 * Denetim bulgusu SD-T-A-04 (Blok 2, 2026-07-11) — `.min(1).max(N).trim()`
 * zincir SIRASI hatalıydı: zod `.trim()`'i bir transform olarak SIRADA
 * ÇAĞRILDIĞI YERDE uygular; `.min(1)` boşluk-dolu ham string'i (uzunluğu
 * ≥1) geçiriyor, `.trim()` SONRADAN onu boş string'e indiriyordu — yani
 * yalnızca boşluklardan oluşan bir isim/kod "geçerli" sayılıp BOŞ STRING
 * olarak DB'ye yazılabiliyordu.
 *
 * `tables.code` / `categories.name` / `products.name` için DB'de bu durumu
 * yakalayan bir CHECK YOK (yalnız `NOT NULL`, boş string'i engellemez) —
 * yani bu gerçekten canlı, sömürülebilir bir veri-kalitesi açığıydı.
 * `areas`/`attribute_groups`/`attribute_options` DB CHECK'i olduğu için
 * (23514 ile) korunuyordu, ama kullanıcıya jenerik hata dönüyordu.
 *
 * Fix: `.trim()` zincirde EN BAŞA alındı (`.trim().min(1).max(N)`) — artık
 * boşluk-dolu girdi trim SONRASI boyuta göre reddediliyor.
 */
describe('Trim-önce-min sıra düzeltmesi (denetim SD-T-A-04)', () => {
  it('AreaCreateRequestSchema — yalnız boşluk isim reddedilir', () => {
    const result = AreaCreateRequestSchema.safeParse({ name: '   ' });
    expect(result.success).toBe(false);
  });

  it('AttributeGroupCreateRequestSchema — yalnız boşluk isim reddedilir', () => {
    const result = AttributeGroupCreateRequestSchema.safeParse({
      name: '     ',
      selectionType: 'single',
    });
    expect(result.success).toBe(false);
  });

  it('AttributeOptionCreateRequestSchema — yalnız boşluk isim reddedilir', () => {
    const result = AttributeOptionCreateRequestSchema.safeParse({ name: '  ' });
    expect(result.success).toBe(false);
  });

  it('CategoryCreateRequestSchema — yalnız boşluk isim reddedilir (DB CHECK YOK — en kritik)', () => {
    const result = CategoryCreateRequestSchema.safeParse({ name: '\t\t' });
    expect(result.success).toBe(false);
  });

  it('ProductCreateRequestSchema — yalnız boşluk isim reddedilir (DB CHECK YOK — en kritik)', () => {
    const result = ProductCreateRequestSchema.safeParse({
      categoryId: '11111111-1111-1111-1111-111111111111',
      name: '   ',
      priceCents: 1000,
    });
    expect(result.success).toBe(false);
  });

  it('TableCreateRequestSchema — yalnız boşluk kod reddedilir (DB CHECK YOK — en kritik)', () => {
    const result = TableCreateRequestSchema.safeParse({ code: '   ' });
    expect(result.success).toBe(false);
  });

  it('normal isim/kod hâlâ kabul edilir + baş/son boşluk kırpılır (regresyon-yok kanıtı)', () => {
    const area = AreaCreateRequestSchema.safeParse({ name: '  Bahçe  ' });
    expect(area.success).toBe(true);
    if (area.success) expect(area.data.name).toBe('Bahçe');

    const table = TableCreateRequestSchema.safeParse({ code: '  M05  ' });
    expect(table.success).toBe(true);
    if (table.success) expect(table.data.code).toBe('M05');
  });
});
