import { describe, it, expect } from 'vitest';
import {
  deepRedact,
  redactPiiString,
  SENSITIVE_BODY_KEYS,
  SENSITIVE_HEADER_KEYS,
} from './pii.js';

describe('redactPiiString (serbest-metin PII — HIGH-1)', () => {
  it('gömülü e-postayı maskeler', () => {
    expect(redactPiiString('kullanıcı ali@ornek.com giriş yaptı')).toBe(
      'kullanıcı [REDACTED] giriş yaptı',
    );
  });

  it('telefon numarasını (10+ rakam) maskeler', () => {
    expect(redactPiiString('arayan 0532 111 22 33 kayıt')).toContain(
      '[REDACTED]',
    );
    expect(redactPiiString('arayan 0532 111 22 33 kayıt')).not.toContain(
      '532',
    );
  });

  it('TCKN / kart / IBAN rakamlarını maskeler', () => {
    expect(redactPiiString('tckn 12345678901')).toBe('tckn [REDACTED]');
    expect(redactPiiString('kart 4111111111111111')).toBe('kart [REDACTED]');
  });

  it('tarih (YYYY-MM-DD, 8 rakam) yanlış-pozitif DEĞİL', () => {
    expect(redactPiiString('store_date 2026-09-07')).toBe(
      'store_date 2026-09-07',
    );
  });

  it('PII olmayan metni değiştirmez', () => {
    expect(redactPiiString('Pide siparişi hazır')).toBe('Pide siparişi hazır');
  });
});

describe('deepRedact (anahtar + serbest-metin, iç içe)', () => {
  it('tüm hassas gövde + header anahtarlarını maskeler', () => {
    const input: Record<string, string> = {};
    for (const k of [...SENSITIVE_BODY_KEYS, ...SENSITIVE_HEADER_KEYS]) {
      input[k] = 'GİZLİ';
    }
    const out = deepRedact(input) as Record<string, string>;
    for (const k of [...SENSITIVE_BODY_KEYS, ...SENSITIVE_HEADER_KEYS]) {
      expect(out[k], `${k} maskelenmeli`).toBe('[REDACTED]');
    }
  });

  it('anahtar eşleşmesi büyük/küçük harf duyarsız', () => {
    const out = deepRedact({ Phone: 'x', TOKEN: 'y' }) as Record<string, string>;
    expect(out['Phone']).toBe('[REDACTED]');
    expect(out['TOKEN']).toBe('[REDACTED]');
  });

  it('iç içe yapı + serbest-metin (exception mesajı vektörü)', () => {
    const event = {
      request: {
        url: 'https://api/x?phone=05321112233',
        headers: { authorization: 'Bearer abc' },
        data: { productName: 'Pide' },
      },
      exception: {
        values: [{ value: 'Müşteri ali@x.com bulunamadı' }],
      },
    };
    const out = deepRedact(event) as typeof event;
    expect(out.request.headers.authorization).toBe('[REDACTED]');
    expect(out.request.url).not.toContain('05321112233'); // query PII scrub
    expect(out.request.data.productName).toBe('Pide'); // korunur
    expect(out.exception.values[0]?.value).toContain('[REDACTED]'); // mesaj PII
  });

  it('dizi içindeki nesneleri temizler', () => {
    const out = deepRedact([{ pan: '4111' }, { name: 'ok' }]) as Array<
      Record<string, string>
    >;
    expect(out[0]?.['pan']).toBe('[REDACTED]');
    expect(out[1]?.['name']).toBe('ok');
  });
});
