import * as Sentry from '@sentry/react';

/**
 * ADR-040 — Web hata izleme (Sentry Cloud, EU/Frankfurt).
 *
 * Fail-safe: `VITE_SENTRY_DSN` yoksa init edilmez (dev/CI'da no-op).
 * KVKK: web event'i de gönderilmeden önce hassas anahtarlar maskelenir
 * (`beforeSend`). Web ayrı bundle olduğundan anahtar listesi burada tutulur;
 * api tarafı `logger.ts` SENSITIVE_BODY_KEYS ile aynı politikayı izler.
 */

const REDACTED = '[REDACTED]';
const MAX_SCRUB_DEPTH = 8;

const SENSITIVE_KEYS = new Set(
  [
    'password',
    'currentpassword',
    'newpassword',
    'token',
    'refresh_token',
    'refreshtoken',
    'accesstoken',
    'cardnumber',
    'cvv',
    'pan',
    'iban',
    'tckn',
    'authorization',
    'cookie',
  ].map((k) => k.toLowerCase()),
);

function deepScrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => deepScrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? REDACTED
      : deepScrub(val, depth + 1);
  }
  return out;
}

let enabled = false;

export function initWebSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (dsn === undefined || dsn === '') return; // no-op
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Performans izleme kapsam DIŞI (ADR-040 — yalnız hata görünürlüğü).
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: (event) => deepScrub(event) as typeof event,
  });
  enabled = true;
}

export function captureWebError(err: unknown): void {
  if (enabled) Sentry.captureException(err);
}
