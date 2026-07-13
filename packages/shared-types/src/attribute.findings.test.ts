import { describe, it, expect } from 'vitest';
import {
  AttributeGroupCreateRequestSchema,
  AttributeOptionCreateRequestSchema,
} from './attribute.js';

/**
 * Blok 2 / Hat A — KASITLI KIRMIZI karakterizasyon testleri (attribute.ts).
 *
 * Bulgu: SD-T-A-04 (table.findings.test.ts kökeni) — aynı `.min(1).max(N).trim()`
 * sıra hatası attribute.ts:33 (`AttributeGroupCreateRequestSchema.name`) ve
 * attribute.ts:83 (`AttributeOptionCreateRequestSchema.name`) içinde de var.
 * Etiket: MVP-fix
 */
describe('SD-T-A-04 (attribute.ts yayılımı) — grup/option name boşluk-yalnız bypass (kasıtlı kırmızı)', () => {
  it('SD-T-A-04e AttributeGroupCreateRequestSchema.name="   " REDDEDİLMELİ', () => {
    const r = AttributeGroupCreateRequestSchema.safeParse({
      name: '   ',
      selectionType: 'single',
    });
    expect(r.success).toBe(false);
  });

  it('SD-T-A-04f AttributeOptionCreateRequestSchema.name="   " REDDEDİLMELİ', () => {
    const r = AttributeOptionCreateRequestSchema.safeParse({ name: '   ' });
    expect(r.success).toBe(false);
  });
});
