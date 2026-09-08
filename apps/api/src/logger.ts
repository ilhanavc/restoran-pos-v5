import pino, { type LoggerOptions } from 'pino';
import { SENSITIVE_BODY_KEYS } from '@restoran-pos/shared-types';

// Only safe, non-PII fields from Error objects are emitted.
// Full err object is never serialized — avoids stack/config/response leaking tokens.
function safeErrSerializer(err: unknown): Record<string, unknown> {
  if (err == null || typeof err !== 'object') return { raw: String(err) };
  const e = err as Record<string, unknown>;
  return {
    name: typeof e['name'] === 'string' ? e['name'] : 'Error',
    code: typeof e['code'] === 'string' ? e['code'] : undefined,
    cause: typeof e['cause'] === 'string' ? e['cause'] : undefined,
    messageKey: typeof e['messageKey'] === 'string' ? e['messageKey'] : undefined,
    httpStatus: typeof e['httpStatus'] === 'number' ? e['httpStatus'] : undefined,
    // Stack only in non-prod to avoid verbose prod logs
    stack:
      process.env['NODE_ENV'] !== 'production' && typeof e['stack'] === 'string'
        ? e['stack']
        : undefined,
  };
}

const isProd = process.env['NODE_ENV'] === 'production';

// PII hassas-anahtar politikası TEK KAYNAK: @restoran-pos/shared-types/pii.
// pino body redact path'leri (`req.body.<key>`) bu listeden türer; aynı liste
// Sentry beforeSend'de de kullanılır (api + web) → drift yok (ADR-040).
const options: LoggerOptions = {
  level: isProd ? 'info' : 'debug',
  serializers: {
    err: safeErrSerializer,
  },
  redact: {
    paths: [
      // Request auth headers
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["proxy-authorization"]',
      'req.headers["x-api-key"]',
      'req.headers["x-auth-token"]',
      // Request body PII / credentials — tek kaynak SENSITIVE_BODY_KEYS'ten türer
      ...SENSITIVE_BODY_KEYS.map((k) => `req.body.${k}`),
      // Response cookie
      'res.headers["set-cookie"]',
      // axios-style error config (external HTTP calls)
      'err.config.headers.authorization',
      'err.config.data',
      'err.response.data',
    ],
    censor: '[REDACTED]',
  },
};

if (!isProd) {
  // Conditional assignment avoids `transport: undefined` which trips
  // exactOptionalPropertyTypes in tsconfig.
  options.transport = { target: 'pino-pretty', options: { colorize: true } };
}

export const logger = pino(options);
