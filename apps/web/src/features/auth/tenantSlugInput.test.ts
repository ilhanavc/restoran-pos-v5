import { describe, expect, it } from 'vitest';
import {
  LoginRequestSchema,
  normalizeTenantSlug,
} from '@restoran-pos/shared-types';

/**
 * ADR-042 K1.1/K1.7 — işletme kodu girdisinin istemci-tarafı sözleşmesi.
 *
 * Buradaki iki iddia, ikisi de **ampirik olarak yaşanmış** hata sınıflarını
 * kilitliyor:
 *
 *  1. **Boş değer `undefined` olmalı.** Şema `.optional()` AMA regex'li —
 *     boş string doğrulamadan GEÇMEZ. Dönüşüm olmasaydı "boş bırakmak
 *     geçerlidir" kuralı sessizce kırılır, kullanıcı formu gönderemez ve
 *     (panel kapalıyken) hiçbir hata da göremezdi.
 *  2. **Türkçe I ailesi.** `"İ".toLowerCase()` JS'te `i` + birleşik nokta
 *     (U+0307) üretir → salt-ASCII CHECK'ine takılır. Türk klavyesinde
 *     `DİLAN` yazan kullanıcı reddedilir ve ekranda küçük harf yazdığını
 *     gördüğü için sebebini bulamaz.
 */
describe('normalizeTenantSlug (ADR-042)', () => {
  it('boş ve yalnız-boşluk girdi boşa indirgenir (şemada undefined olacak)', () => {
    expect(normalizeTenantSlug('')).toBe('');
    expect(normalizeTenantSlug('   ')).toBe('');
  });

  it('kırpar ve küçük harfe indirir', () => {
    expect(normalizeTenantSlug('  Dilan-Pide  ')).toBe('dilan-pide');
  });

  it('🔑 Türkçe İ / I / ı → i (yoksa ayırt edilemez bir ret doğar)', () => {
    expect(normalizeTenantSlug('DİLAN')).toBe('dilan');
    expect(normalizeTenantSlug('DILAN')).toBe('dilan');
    expect(normalizeTenantSlug('dılan')).toBe('dilan');
    // Negatif kontrol niteliğinde: ham toLowerCase bunu YAPMAZ.
    expect('DİLAN'.toLowerCase()).not.toBe('dilan');
  });

  it('diğer Türkçe harfler DEĞİŞTİRİLMEZ — sessizce başka bir koda dönmesin', () => {
    // ş/ğ/ü eşlenseydi kullanıcının yazdığı kod farklı bir işletmeye
    // gidebilirdi. Bunlar reddedilir ve kullanıcıya söylenir (i18n `invalid`).
    expect(normalizeTenantSlug('şube')).toBe('şube');
  });
});

describe('LoginRequestSchema.tenantSlug — normalize sonrası', () => {
  const parse = (slug: string | undefined) =>
    LoginRequestSchema.safeParse({
      email: 'a@b.co',
      password: 'xxxxxxxx',
      ...(slug === undefined ? {} : { tenantSlug: slug }),
    });

  it('alan HİÇ gönderilmezse geçerli (boş bırakmak geçerli bir giriştir)', () => {
    expect(parse(undefined).success).toBe(true);
  });

  it('boş string GEÇERSİZ — bu yüzden girdi undefined\'a çevrilmek ZORUNDA', () => {
    expect(parse('').success).toBe(false);
  });

  it('normalize edilmiş Türkçe girdi kabul edilir', () => {
    const r = parse(normalizeTenantSlug('DİLAN-PİDE'));
    expect(r.success, 'normalize sonrası reddedildi').toBe(true);
    if (r.success) expect(r.data.tenantSlug).toBe('dilan-pide');
  });

  it('boşluklu ve tireyle biten kod reddedilir', () => {
    expect(parse('dilan pide').success).toBe(false);
    expect(parse('dilan-pide-').success).toBe(false);
  });
});
