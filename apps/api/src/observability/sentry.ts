import * as Sentry from '@sentry/node';
import { deepRedact } from '@restoran-pos/shared-types';
import { logger } from '../logger.js';

/**
 * ADR-040 — Observability (Sentry Cloud, EU/Frankfurt region).
 *
 * Fail-safe: `SENTRY_DSN` env yoksa Sentry HİÇ init edilmez (dev/test/CI'da
 * sessiz no-op). Prod'da DSN set edilir → tam kapsam.
 *
 * KVKK: hata payload'ı PII taşıyabilir. `beforeSend` gönderilecek event'i
 * `deepRedact` (shared-types TEK KAYNAK) ile temizler — hem hassas anahtarlar
 * hem string'e gömülü serbest-metin PII (e-posta, telefon, TCKN, kart, IBAN,
 * URL query) maskelenir (security-reviewer HIGH-1).
 */

let enabled = false;

/**
 * `beforeSend` kancası — event gönderilmeden önce PII temizliği.
 * Test edilebilir olması için ayrı export.
 */
export function scrubSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  return deepRedact(event) as Sentry.ErrorEvent;
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
  // ADR-040 — veri AB'de kalmalı. Region DSN host'una bağlıdır; kod zorlayamaz
  // ama EU olmayan DSN operatör hatasına işaret eder → uyar (engelleme).
  if (!dsn.includes('.de.sentry.io')) {
    logger.warn(
      '[sentry] DSN EU (.de.sentry.io) host içermiyor — KVKK veri-yerleşimi doğrula',
    );
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
    // KVKK — request body/PII varsayılan toplama kapalı (explicit).
    sendDefaultPii: false,
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
