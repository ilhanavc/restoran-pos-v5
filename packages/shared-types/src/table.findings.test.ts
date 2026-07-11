import { describe, it, expect } from 'vitest';
import { TableCreateRequestSchema, TableUpdateRequestSchema } from './table.js';

/**
 * Blok 2 / Hat A — KASITLI KIRMIZI karakterizasyon testleri (table.ts).
 *
 * Bulgu: SD-T-A-04 [HIGH][BUG] `.min(1).max(N).trim()` zincir SIRASI —
 * boşluk-yalnız string'i "dolu" kabul edip trim SONRASI boş string üretiyor.
 *
 * Kanıt: table.ts:29 — `code: z.string().min(1).max(32).trim()`.
 * Zod ZodString checks dizisi EKLENDIĞI SIRAYLA çalışır: `min`/`max` kontrolü
 * HAM (trim edilmemiş) veri üzerinde yapılır, `trim` EN SONDA bir transform
 * olarak çalışır ve çıktı değerini değiştirir ama önceki min/max sonucunu
 * geri almaz. Sonuç: code="   " (3 boşluk) → min(1) ham veri üzerinde
 * 3>=1 GEÇER → trim çıktıyı "" yapar → safeParse.success=true, data.code="".
 *
 * Bu AYNI desen area.ts (`name: z.string().min(1).max(40).trim()`) ve
 * attribute.ts (`name: z.string().min(1).max(60).trim()` — hem group hem
 * option) içinde de var — bkz. area.findings.test.ts / attribute.findings.test.ts.
 *
 * Etki: DB CHECK `length(name) BETWEEN 1 AND 40` (area.ts:23 yorumu) gibi
 * kısıtlar varsa, boş string DB'ye ulaştığında ham Postgres CHECK ihlali
 * (23514) fırlatır — temiz 400 VALIDATION_ERROR yerine beklenmeyen 500.
 * DB CHECK yoksa (table.ts `code` kolonunda böyle bir CHECK doğrulanmadı),
 * kullanıcı "   " girip Kaydet'e basarsa masa/bölge/grup adı SESSİZCE boş
 * kalır — kasiyer ekranında isimsiz masa/kategori görünür.
 *
 * Öneri: Zincir sırası tersine çevrilmeli: `.trim().min(1).max(N)` (önce
 * trim, sonra uzunluk kontrolü) — tüm 4 yerde (table.ts, area.ts,
 * attribute.ts×2).
 * Etiket: MVP-fix
 */
describe('SD-T-A-04 — TableCreateRequestSchema.code boşluk-yalnız string bypass (kasıtlı kırmızı)', () => {
  it('SD-T-A-04a code="   " (yalnız boşluk) REDDEDİLMELİ (trim sonrası boş kalıyor)', () => {
    const r = TableCreateRequestSchema.safeParse({ code: '   ' });
    // Beklenen (doğru) davranış: reddet. Şu an: kabul ediyor (data.code === '') → KIRMIZI.
    expect(r.success).toBe(false);
  });

  it('SD-T-A-04b TableUpdateRequestSchema.code aynı bypass\'ı taşır', () => {
    const r = TableUpdateRequestSchema.safeParse({ code: '\t\t' });
    expect(r.success).toBe(false);
  });
});
