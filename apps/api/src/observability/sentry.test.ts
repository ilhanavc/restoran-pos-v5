import { describe, it, expect } from 'vitest';
import { deepScrub, scrubSentryEvent, captureError } from './sentry.js';
import { SENSITIVE_BODY_KEYS, SENSITIVE_HEADER_KEYS } from '../logger.js';

/**
 * ADR-040 Güvenlik/KVKK — Sentry'ye giden event PII taşımamalı.
 * `beforeSend` (scrubSentryEvent → deepScrub) hassas anahtarları maskeler.
 */
describe('sentry deepScrub (KVKK PII temizliği)', () => {
  it('tüm hassas gövde anahtarlarını maskeler', () => {
    const input: Record<string, string> = {};
    for (const key of SENSITIVE_BODY_KEYS) input[key] = 'GİZLİ';
    const out = deepScrub(input) as Record<string, string>;
    for (const key of SENSITIVE_BODY_KEYS) {
      expect(out[key], `${key} maskelenmeli`).toBe('[REDACTED]');
    }
  });

  it('hassas header anahtarlarını maskeler', () => {
    const input: Record<string, string> = {};
    for (const key of SENSITIVE_HEADER_KEYS) input[key] = 'Bearer secret';
    const out = deepScrub(input) as Record<string, string>;
    for (const key of SENSITIVE_HEADER_KEYS) {
      expect(out[key]).toBe('[REDACTED]');
    }
  });

  it('anahtar eşleşmesi büyük/küçük harf duyarsız', () => {
    const out = deepScrub({ Phone: '5321112233', TOKEN: 'x' }) as Record<
      string,
      string
    >;
    expect(out['Phone']).toBe('[REDACTED]');
    expect(out['TOKEN']).toBe('[REDACTED]');
  });

  it('iç içe (nested) yapıda PII maskeler, hassas olmayanı korur', () => {
    const event = {
      request: {
        headers: { authorization: 'Bearer abc' },
        data: { phone: '5321112233', productName: 'Pide' },
      },
      extra: { user: { tckn: '12345678901', role: 'cashier' } },
    };
    const out = deepScrub(event) as typeof event;
    expect(out.request.headers.authorization).toBe('[REDACTED]');
    expect(out.request.data.phone).toBe('[REDACTED]');
    expect(out.request.data.productName).toBe('Pide'); // korunur
    expect(out.extra.user.tckn).toBe('[REDACTED]');
    expect(out.extra.user.role).toBe('cashier'); // korunur
  });

  it('dizi (array) içindeki nesneleri de temizler', () => {
    const out = deepScrub([{ pan: '4111' }, { name: 'ok' }]) as Array<
      Record<string, string>
    >;
    expect(out[0]?.['pan']).toBe('[REDACTED]');
    expect(out[1]?.['name']).toBe('ok');
  });

  it('scrubSentryEvent event nesnesini temizleyip döner', () => {
    const raw = {
      type: undefined,
      level: 'error',
      request: { data: { password: 'p' } },
    } as unknown as Parameters<typeof scrubSentryEvent>[0];
    const scrubbed = scrubSentryEvent(raw) as unknown as {
      level: string;
      request: { data: { password: string } };
    };
    expect(scrubbed.request.data.password).toBe('[REDACTED]');
    expect(scrubbed.level).toBe('error'); // yapısal alan korunur
  });
});

describe('sentry captureError (fail-safe)', () => {
  it('DSN yokken (init edilmemiş) undefined döner, fırlatmaz', () => {
    // Test ortamında SENTRY_DSN yok → initSentry çağrılmadı → no-op.
    expect(captureError(new Error('boom'))).toBeUndefined();
  });
});
