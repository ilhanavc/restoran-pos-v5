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
      // Request body PII / credentials
      'req.body.password',
      'req.body.email',
      'req.body.phone',
      'req.body.token',
      'req.body.refresh_token',
      'req.body.refreshToken',
      'req.body.accessToken',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.cardNumber',
      'req.body.cvv',
      'req.body.pan',
      'req.body.iban',
      'req.body.tckn',
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
