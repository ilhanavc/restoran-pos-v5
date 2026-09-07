import * as Sentry from '@sentry/node';
import {
  logger,
  SENSITIVE_BODY_KEYS,
  SENSITIVE_HEADER_KEYS,
} from '../logger.js';

/**
 * ADR-040 — Observability (Sentry Cloud, EU/Frankfurt region).
 *
 * Fail-safe: `SENTRY_DSN` env yoksa Sentry HİÇ init edilmez (dev/test/CI'da
 * sessiz no-op). Prod'da DSN set edilir → tam kapsam. Böylece ortam sızıntısı
 * olmaz ve dev'de dış çağrı yapılmaz.
 *
 * KVKK: hata payload'ı PII taşıyabilir. `beforeSend` gönderilecek event'i
 * derinlemesine temizler; hassas anahtar politikası `logger.ts` ile TEK
 * kaynaktan gelir (SENSITIVE_BODY_KEYS + SENSITIVE_HEADER_KEYS) → drift yok.
 */

const REDACTED = '[REDACTED]';
const MAX_SCRUB_DEPTH = 8;

// Küçük harfe indirgenmiş hassas anahtar kümesi (O(1) lookup).
const SENSITIVE_KEY_SET = new Set<string>(
  [...SENSITIVE_BODY_KEYS, ...SENSITIVE_HEADER_KEYS].map((k) =>
    k.toLowerCase(),
  ),
);

let enabled = false;

/**
 * Sentry event'ini (veya iç içe herhangi bir değeri) derinlemesine tarar;
 * anahtarı hassas listede olan alanların DEĞERİNİ maskeler. Yapısal Sentry
 * alanları (event_id, level, vb.) hassas ada uymadığından dokunulmaz.
 */
export function deepScrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepScrub(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_SET.has(key.toLowerCase())
      ? REDACTED
      : deepScrub(val, depth + 1);
  }
  return out;
}

/**
 * `beforeSend` kancası — event gönderilmeden önce PII temizliği.
 * Test edilebilir olması için ayrı export.
 */
export function scrubSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  return deepScrub(event) as Sentry.ErrorEvent;
}

/**
 * Uygulama başlangıcında (index.ts, dotenv'den SONRA) çağrılır.
 * DSN yoksa no-op.
 */
export function initSentry(): void {
  const dsn = process.env['SENTRY_DSN'];
  if (dsn === undefined || dsn.trim() === '') {
    logger.info('[sentry] SENTRY_DSN yok — hata izleme devre dışı (no-op)');
    return;
  }
  const sampleRateRaw = process.env['SENTRY_SAMPLE_RATE'];
  const sampleRate =
    sampleRateRaw !== undefined && sampleRateRaw !== ''
      ? Number(sampleRateRaw)
      : 1.0;
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'production',
    // Performans izleme kapsam DIŞI (ADR-040 — yalnız hata görünürlüğü).
    tracesSampleRate: 0,
    sampleRate: Number.isFinite(sampleRate) ? sampleRate : 1.0,
    // KVKK — her event gönderilmeden önce PII temizlenir.
    beforeSend: (event) => scrubSentryEvent(event),
  });
  enabled = true;
  logger.info('[sentry] hata izleme etkin (EU region)');
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * Bir hatayı Sentry'ye raporlar ve event id'sini (reference-id) döner.
 * Sentry devre dışıysa `undefined` — çağıran taraf koşulsuz çağırabilir.
 */
export function captureError(err: unknown): string | undefined {
  if (!enabled) return undefined;
  return Sentry.captureException(err);
}
