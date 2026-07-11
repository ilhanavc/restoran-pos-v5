import { describe, it, expect } from 'vitest';
import { TenantSettingsUpdateSchema } from './settings.js';

/**
 * QA — Blok 2 / Hat C — settings.ts sınır-zorlama testleri (ADDITIVE, GREEN).
 */

describe('settings.ts — TenantSettingsUpdateSchema (audit)', () => {
  it('boş body reddeder (patch:empty_body)', () => {
    const r = TenantSettingsUpdateSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('geçerli IANA timezone kabul eder', () => {
    const r = TenantSettingsUpdateSchema.safeParse({ timezone: 'Europe/Istanbul' });
    expect(r.success).toBe(true);
  });

  it('rakam/özel karakter içeren timezone reddeder', () => {
    const r = TenantSettingsUpdateSchema.safeParse({ timezone: 'Europe/Istanbul123!' });
    expect(r.success).toBe(false);
  });

  it('boş string timezone reddeder (regex +required)', () => {
    const r = TenantSettingsUpdateSchema.safeParse({ timezone: '' });
    expect(r.success).toBe(false);
  });

  it('SD-T-C-09 kanıtı: 10.000 karakter uzunluğunda regex-uyumlu "sahte" timezone kabul eder (uzunluk sınırı yok)', () => {
    // IANA_TZ_REGEX = /^[A-Za-z_]+(?:\/[A-Za-z_]+)*$/ — tekrarlı segment sayısını
    // veya segment uzunluğunu sınırlamıyor. Gerçekte var olmayan bir TZ (DB
    // trigger'ı reddeder) ama zod katmanında hiçbir uzunluk engeli yok.
    const fakeTz = 'A'.repeat(10_000);
    const r = TenantSettingsUpdateSchema.safeParse({ timezone: fakeTz });
    expect(r.success).toBe(true);
  });

  it('callerIdStationUserId null kabul eder (atama temizleme)', () => {
    const r = TenantSettingsUpdateSchema.safeParse({ callerIdStationUserId: null });
    expect(r.success).toBe(true);
  });

  it('callerIdStationUserId geçersiz UUID reddeder', () => {
    const r = TenantSettingsUpdateSchema.safeParse({ callerIdStationUserId: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });

  it('callerIdBypassPatterns 51 eleman reddeder (max 50)', () => {
    const r = TenantSettingsUpdateSchema.safeParse({
      callerIdBypassPatterns: Array.from({ length: 51 }, (_, i) => `0850${i}`),
    });
    expect(r.success).toBe(false);
  });

  it('callerIdBypassPatterns boş string eleman reddeder (min 1)', () => {
    const r = TenantSettingsUpdateSchema.safeParse({ callerIdBypassPatterns: [''] });
    expect(r.success).toBe(false);
  });

  it('callerIdBypassPatterns 201 karakterlik eleman reddeder (max 200)', () => {
    const r = TenantSettingsUpdateSchema.safeParse({
      callerIdBypassPatterns: ['0'.repeat(201)],
    });
    expect(r.success).toBe(false);
  });
});
