import { describe, expect, it } from 'vitest';
import { LoginRequestSchema } from './auth.js';

/**
 * Blok 2 denetim bulgusu SD-T-B-05 — KASITLI KIRMIZI karakterizasyon.
 *
 * auth.ts LoginRequestSchema.password = z.string().min(1) — üst sınır YOK.
 * Aynı dosyada RefreshRequestSchema.refreshToken `.max(512)` savunma-derinliği
 * almışken parola alanı sınırsız: 1 MB'lık parola zod'dan geçip bcrypt'e
 * ulaşır (bcrypt maliyeti girdi uzunluğuyla artar → login endpoint'inde
 * CPU-DoS vektörü; rate-limiter tek başına yeterli değil).
 *
 * Beklenen: makul üst sınır (örn. .max(200)) ile red.
 * Bugün: kabul → bu test fix'e kadar KIRMIZI kalır.
 */
describe('LoginRequest parola üst sınırı (SD-T-B-05)', () => {
  it('SD-T-B-05 1000 karakterlik parola reddedilmeli (bugün: kabul ediliyor)', () => {
    const result = LoginRequestSchema.safeParse({
      email: 'test@example.com',
      password: 'x'.repeat(1000),
    });
    expect(result.success).toBe(false);
  });
});
