import { describe, it, expect } from 'vitest';
import { ReportRangeQuerySchema, DailyCloseQuerySchema } from './reports.js';

/**
 * QA — Blok 2 / Hat C — KASITLI KIRMIZI test.
 *
 * Bulgu: SD-T-C-01 [HIGH] [BUG] reports.ts yyyyMmDd regex takvim-geçerli
 * tarihi doğrulamıyor.
 *
 * Kanıt: `packages/shared-types/src/reports.ts:45` —
 *   `const yyyyMmDd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);`
 * Bu regex yalnız RAKAM-ŞEKLİ kontrol eder; ay 01-12, gün 01-31 aralığını
 * DOĞRULAMAZ. Aynı kusur `DailyCloseQuerySchema.date`'te de var
 * (reports.ts:428-433).
 *
 * Senaryo: "2026-02-30" (Şubat'ın 30'u yok) gibi takvimde var olmayan bir
 * GÜN zod validation'ından GEÇER (ay taşması — örn. "2026-13-05" — ayrı bir
 * yoldan, `ReportRangeQuerySchema`'nın 90-gün `refine`'ındaki `new Date()`
 * hesaplaması `Invalid Date`/`NaN` ürettiği için kazara reddedilir; bu
 * test dosyasına dahil edilmedi — bkz. reports.audit.test.ts "KÖK-NEDEN
 * kanıtı"). Geçen değer sonra route handler'da `new Date(...)` / tarih
 * kütüphanesine (`getDailyCloseWindow`) verilir; JS Date taşan günü
 * SESSİZCE bir sonraki aya yuvarlar (örn. "2026-02-30T00:00:00Z" →
 * 2026-03-02). Sonuç: Z-raporu / günlük ciro penceresi YANLIŞ bir güne
 * kayar — kullanıcı "30 Şubat" istiyor sanır ama sistem "2 Mart" verisini
 * gösterir. Finansal rapor bütünlüğü (ADR-015) için sessiz hatalı davranış
 * kabul edilemez.
 *
 * Etki: Muhasebe/gün-sonu raporlarında yanlış gün verisi sessizce üretilir.
 * Öneri: regex yerine (veya ek olarak) gerçek takvim doğrulaması — örn.
 *   `.refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')) &&
 *      new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s)`
 * Etiket: MVP-fix (finansal rapor doğruluğu; ADR-015 kapsamında).
 *
 * Bu test KASITLI KIRMIZI — doğru davranışı (takvim-dışı tarih reddedilmeli)
 * assert eder, mevcut şema bunu sağlamadığı için başarısız olur.
 */
describe('SD-T-C-01 reports.ts — takvim-dışı tarih reddedilmeli (KASITLI KIRMIZI)', () => {
  it('SD-T-C-01a ReportRangeQuerySchema "2026-02-30" (Şubat 30 yok) reddetmeli', () => {
    const r = ReportRangeQuerySchema.safeParse({
      range: 'custom',
      from: '2026-02-30',
      to: '2026-02-30',
    });
    // Beklenen (doğru) davranış: reddedilmeli. Mevcut şema kabul ediyor.
    expect(r.success).toBe(false);
  });

  it('SD-T-C-01c DailyCloseQuerySchema "2026-02-30" (Z-raporu tarihi) reddetmeli', () => {
    const r = DailyCloseQuerySchema.safeParse({ date: '2026-02-30' });
    expect(r.success).toBe(false);
  });
});
