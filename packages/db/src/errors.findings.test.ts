import { describe, expect, it } from 'vitest';
import { mapPgError } from './errors.js';

/**
 * Blok 3 denetim bulgusu DB-SEC-01 — KASITLI KIRMIZI karakterizasyon.
 *
 * errors.ts:28 — RepositoryError constructor'ı `detail`'i hem `.detail`
 * alanına HEM `super(...)` ile `.message`'a gömer. errors.ts:69 — 23505
 * (unique_violation) için `pgErr.detail` doğrudan geçirilir. PostgreSQL'in
 * unique-violation `detail` metni çakışan DEĞERİ içerir:
 *   "Key (email)=(ali@example.com) already exists."
 * Bu, `logger.error(err)` (pino varsayılanı `err.message`) çağrıldığında
 * müşteri/kullanıcı e-postasını (ve customers'ta telefonu) log'a sızdırır —
 * KVKK-PII ihlali. Repository katmanı "raw pg hatası asla sızmaz" sözü
 * veriyor ama PII-taşıyan detail'i message'a koyarak kendi sözünü çiğniyor.
 *
 * Beklenen: hata mesajı ham PII (e-posta) içermemeli.
 * Bugün: içeriyor → bu test fix'e (detail redaksiyonu) kadar KIRMIZI kalır.
 * Not: gerçek log sızması api handler'ının loglama şekline de bağlı → Blok 4.
 */
describe('mapPgError PII sızıntısı (DB-SEC-01)', () => {
  it('DB-SEC-01 23505 unique hata mesajı ham e-postayı içermemeli (bugün: sızıyor)', () => {
    const pgErr = {
      code: '23505',
      detail: 'Key (email)=(ali@example.com) already exists.',
      message: 'duplicate key value violates unique constraint "users_email_key"',
    };
    const mapped = mapPgError(pgErr);
    expect(mapped).not.toBeNull();
    // .message KVKK-PII taşımamalı (yalnız .cause/.messageKey makine-okur olmalı):
    expect(mapped!.message).not.toContain('ali@example.com');
  });
});
