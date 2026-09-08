import type { ErrorRequestHandler } from 'express';
import { toHttpError } from '../errors.js';
import { logger } from '../logger.js';
import { captureError } from '../observability/sentry.js';

/**
 * ADR-006 §2 — Tek merkezi error middleware. Express'in 4 argümanlı imza
 * sözleşmesi gereği `_next` parametresi imzada kalmalı. `app.use(errorHandler)`
 * çağrısı tüm route'lardan SONRA gelmeli.
 *
 * ADR-040 — 5xx (beklenmeyen sunucu hatası) Sentry'ye raporlanır; dönen event
 * id yanıta `reference` olarak eklenir (code-style §81). Sentry devre dışıysa
 * `captureError` no-op döner, davranış değişmez. 4xx (istemci hatası) Sentry'ye
 * gitmez — gürültü olmasın.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, body } = toHttpError(err);
  if (status >= 500) {
    const reference = captureError(err);
    logger.error({ err, sentryEventId: reference }, '[errorHandler] unhandled error');
    if (reference !== undefined) {
      body.error.reference = reference;
    }
  }
  res.status(status).json(body);
};
