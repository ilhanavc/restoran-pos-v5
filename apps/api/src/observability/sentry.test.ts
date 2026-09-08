import { describe, it, expect } from 'vitest';
import { scrubSentryEvent, captureError } from './sentry.js';

/**
 * ADR-040 Güvenlik/KVKK — Sentry'ye giden event PII taşımamalı.
 * Kapsamlı redaction (anahtar + serbest-metin) testleri:
 * `packages/shared-types/src/pii.test.ts`. Burada Sentry wrapper'ı + fail-safe.
 */
describe('scrubSentryEvent (beforeSend wrapper)', () => {
  it('iç içe event içindeki PII\'yi maskeler, yapısal alanları korur', () => {
    const raw = {
      type: undefined,
      level: 'error',
      request: {
        headers: { authorization: 'Bearer abc' },
        url: 'https://api/customers?phone=05321112233',
        data: { productName: 'Pide' },
      },
    } as unknown as Parameters<typeof scrubSentryEvent>[0];
    const out = scrubSentryEvent(raw) as unknown as {
      level: string;
      request: {
        headers: { authorization: string };
        url: string;
        data: { productName: string };
      };
    };
    expect(out.request.headers.authorization).toBe('[REDACTED]');
    expect(out.request.url).not.toContain('05321112233'); // query PII scrub
    expect(out.request.data.productName).toBe('Pide'); // korunur
    expect(out.level).toBe('error'); // yapısal alan korunur
  });
});

describe('captureError (fail-safe)', () => {
  it('DSN yokken (init edilmemiş) undefined döner, fırlatmaz', () => {
    // Test ortamında SENTRY_DSN yok → initSentry çağrılmadı → no-op.
    expect(captureError(new Error('boom'))).toBeUndefined();
  });
});
