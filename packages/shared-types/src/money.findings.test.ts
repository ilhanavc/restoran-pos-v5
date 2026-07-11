import { describe, it, expect } from 'vitest';
import { MoneyCentsSchema, PositiveCentsSchema } from './money.js';

/**
 * Blok 2 / Hat A — KASITLI KIRMIZI karakterizasyon testleri.
 *
 * Bulgu: SD-T-A-01 [HIGH][BUG] Para şemalarında üst sınır (.max()) yok.
 *
 * Kanıt: money.ts — `MoneyCentsSchema = z.number().int().nonnegative()`,
 * `PositiveCentsSchema = z.number().int().positive()`. İkisinde de üst sınır
 * YOK. Bu şemalar order.ts (totalCents, unitPriceCents, ...) ve payment.ts
 * (amountCents, cashReceivedCents, tipAmountCents, ...) tarafından re-use
 * edilir; DB kolonları Postgres INTEGER (INT4, max 2,147,483,647) —
 * packages/db/migrations/000_init.sql:257,287,289,305 (`total_cents`,
 * `unit_price_cents`, `amount_cents` hepsi `INTEGER`).
 *
 * Senaryo: bir client amountCents=3_000_000_000 (INT4 sınırının üstü)
 * gönderirse zod safeParse BAŞARILI döner (bu dosyadaki testler bunu
 * kanıtlıyor — hepsi ŞU AN kırmızı). Sunucu bu değeri INSERT/UPDATE'e
 * geçirirse Postgres `22003 numeric_value_out_of_range` fırlatır; route
 * handler'da özel yakalama yoksa bu 500 olarak client'a döner (400
 * VALIDATION_ERROR yerine) — kullanıcı deneyimi + öngörülemeyen hata riski.
 *
 * Ayrıca Number.MAX_SAFE_INTEGER (2^53-1) üstü değerler için `.int()`
 * (Number.isInteger) hâlâ true döner ama IEEE-754 float precision kaybı
 * olur — "asla float/double para" ilkesine dolaylı ihlal riski.
 *
 * Öneri: MoneyCentsSchema/PositiveCentsSchema'ya Postgres INT4 sınırına
 * hizalı `.max(2_147_483_647)` eklenmeli.
 * Etiket: MVP-fix
 */
describe('SD-T-A-01 — MoneyCentsSchema üst sınır eksikliği (kasıtlı kırmızı)', () => {
  it('SD-T-A-01a Postgres INT4 sınırının (2_147_483_647) ÜSTÜNDEKİ bir tutarı reddetmeli', () => {
    // Beklenen (doğru) davranış: reddet. Şu an: kabul ediyor → test KIRMIZI.
    const r = MoneyCentsSchema.safeParse(2_147_483_648);
    expect(r.success).toBe(false);
  });

  it('SD-T-A-01b 3 milyar kuruş (30 milyon TL) gibi gerçekçi-olmayan devasa tutarı reddetmeli', () => {
    const r = MoneyCentsSchema.safeParse(3_000_000_000);
    expect(r.success).toBe(false);
  });

  it('SD-T-A-01c Number.MAX_SAFE_INTEGER üstü (float precision kaybı bölgesi) değeri reddetmeli', () => {
    // 2^53 + 2 — Number.isInteger true döner ama JS artık bitişik integer'ları
    // ayırt edemez (precision loss bölgesi). Para alanı için kabul edilemez.
    const dangerous = Number.MAX_SAFE_INTEGER + 3;
    const r = MoneyCentsSchema.safeParse(dangerous);
    expect(r.success).toBe(false);
  });

  it('SD-T-A-01d PositiveCentsSchema aynı sınırsızlığı miras alır — INT4 üstünü reddetmeli', () => {
    const r = PositiveCentsSchema.safeParse(9_999_999_999);
    expect(r.success).toBe(false);
  });
});
