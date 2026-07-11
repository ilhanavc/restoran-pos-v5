import { describe, it, expect } from 'vitest';
import { AreaCreateRequestSchema, AreaUpdateRequestSchema } from './area.js';

/**
 * Blok 2 / Hat A — KASITLI KIRMIZI karakterizasyon testleri (area.ts).
 *
 * Bulgu: SD-T-A-04 [HIGH][BUG] (table.findings.test.ts kökeni) — aynı
 * `.min(1).max(N).trim()` sıra hatası area.ts:27 `name` alanında da var.
 * DB CHECK `length(name) BETWEEN 1 AND 40 WHERE deleted_at IS NULL`
 * (area.ts:23 yorumu) devreye girerse boş-trim edilmiş isim ham Postgres
 * CHECK ihlaliyle (23514) 500'e düşer.
 * Etiket: MVP-fix
 */
describe('SD-T-A-04 (area.ts yayılımı) — AreaCreateRequestSchema.name boşluk-yalnız bypass (kasıtlı kırmızı)', () => {
  it('SD-T-A-04c name="   " (yalnız boşluk) REDDEDİLMELİ', () => {
    const r = AreaCreateRequestSchema.safeParse({ name: '   ' });
    expect(r.success).toBe(false);
  });

  it('SD-T-A-04d AreaUpdateRequestSchema.name aynı bypass\'ı taşır', () => {
    const r = AreaUpdateRequestSchema.safeParse({ name: '  \n ' });
    expect(r.success).toBe(false);
  });
});
