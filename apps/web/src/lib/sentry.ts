import * as Sentry from '@sentry/react';
import { deepRedact } from '@restoran-pos/shared-types';

/**
 * ADR-040 — Web hata izleme (Sentry Cloud, EU/Frankfurt).
 *
 * Fail-safe: `VITE_SENTRY_DSN` yoksa init edilmez (dev/CI'da no-op).
 * KVKK: event gönderilmeden önce `deepRedact` (shared-types TEK KAYNAK) ile
 * hem hassas anahtarlar hem serbest-metin PII maskelenir — api ile aynı
 * politika, drift yok.
 */

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
    beforeSend: (event) => deepRedact(event) as typeof event,
  });
  enabled = true;
}

export function captureWebError(err: unknown): void {
  if (enabled) Sentry.captureException(err);
}
