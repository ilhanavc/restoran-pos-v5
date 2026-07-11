import { describe, it, expect } from 'vitest';
import { ProductVariantWriteSchema } from './menu.js';

/**
 * QA — Blok 2 / Hat C — KASITLI KIRMIZI test.
 *
 * Bulgu: SD-T-C-05 [HIGH] [BUG] menu.ts — `ProductVariantWriteSchema.priceDeltaCents`
 * hiçbir alt/üst sınıra sahip değil.
 *
 * Kanıt: `packages/shared-types/src/menu.ts:183` —
 *   `priceDeltaCents: z.number().int(),`
 * (`MoneyCentsSchema` gibi `.nonnegative()`/bir üst sınır DEĞİL — bilinçli
 * olarak signed, ADR-003 §8.6 Amendment 2026-04-28. Ama işaretli olması
 * makul; SINIRSIZ olması değil.)
 *
 * Senaryo: Bir admin (veya ele geçirilmiş admin oturumu) `priceDeltaCents:
 * -999999999999` gibi aşırı bir değerle variant oluşturursa: base fiyatla
 * toplandığında (`basePrice + delta`, shared-domain sipariş hesabında)
 * nihai birim fiyat KESİNLİKLE negatife düşer. Şema seviyesinde hiçbir
 * sağduyu sınırı (sanity bound) yok — yalnız `.int()` (tamsayı) kontrolü
 * var. Bu, POS'un "ödeme tutarı asla negatif/anlamsız olmaz" ilkesine
 * (CLAUDE.md "Asla" listesi — para bütünlüğü) aykırı bir şema boşluğu.
 *
 * Etki: Menü admin ekranından (kasıtlı veya yanlışlıkla — örn. eksik sıfır
 * kontrolü olmayan bir form) girilen aşırı delta, sipariş toplamını
 * negatife çekebilir; ödeme/adisyon toplamında tutarsızlık riski.
 *
 * Öneri: `priceDeltaCents` için sağduyu sınırı ekle — örn.
 *   `z.number().int().min(-100_000_000).max(100_000_000)` (±1.000.000 TL)
 * DB `price_cents INTEGER CHECK (price_cents >= 0)` zaten base fiyatı
 * negatife izin vermiyor (000_init.sql:187); ama variant + base toplamı
 * ayrı bir yerde (shared-domain) hesaplanıyorsa CHECK bunu yakalamayabilir
 * — şema katmanında erken sağduyu sınırı savunma-derinliği sağlar.
 * Etiket: MVP-fix (para bütünlüğü, ADR-003 §8.6 kapsamında).
 *
 * Bu test KASITLI KIRMIZI — doğru davranışı (aşırı delta reddedilmeli)
 * assert eder; mevcut şema sınırsız olduğu için başarısız olur.
 */
describe('SD-T-C-05 menu.ts — ProductVariantWriteSchema.priceDeltaCents sağduyu sınırına sahip olmalı (KASITLI KIRMIZI)', () => {
  it('SD-T-C-05a priceDeltaCents = -999.999.999.999 (aşırı negatif) reddedilmeli', () => {
    const r = ProductVariantWriteSchema.safeParse({
      name: 'Aşırı İskonto',
      priceDeltaCents: -999_999_999_999,
    });
    expect(r.success).toBe(false);
  });

  it('SD-T-C-05b priceDeltaCents = +999.999.999.999 (aşırı pozitif) reddedilmeli', () => {
    const r = ProductVariantWriteSchema.safeParse({
      name: 'Aşırı Zam',
      priceDeltaCents: 999_999_999_999,
    });
    expect(r.success).toBe(false);
  });
});
