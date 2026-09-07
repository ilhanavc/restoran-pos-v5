import pino, { type LoggerOptions } from 'pino';

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

/**
 * PII / kimlik-bilgisi taşıyan gövde alan adları — tek kaynak (KVKK).
 * Hem pino redact path'leri (`req.body.<key>`) hem Sentry `beforeSend`
 * scrubber'ı (bkz. `observability/sentry.ts`) bu listeden türetilir; iki
 * yerde ayrı liste tutulmaz → drift yok (ADR-040 Güvenlik/KVKK).
 */
export const SENSITIVE_BODY_KEYS = [
  'password',
  'email',
  'phone',
  'token',
  'refresh_token',
  'refreshToken',
  'accessToken',
  'currentPassword',
  'newPassword',
  'cardNumber',
  'cvv',
  'pan',
  'iban',
  'tckn',
] as const;

/**
 * Hassas HTTP header adları (küçük harf). Sentry event'inde header
 * temizliğinde kullanılır; pino tarafında yapısal path'ler aşağıda.
 */
export const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'set-cookie',
] as const;

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
