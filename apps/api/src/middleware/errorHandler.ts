import type { ErrorRequestHandler } from 'express';
import { toHttpError } from '../errors.js';
import { logger } from '../logger.js';

/**
 * ADR-006 §2 — Tek merkezi error middleware. Express'in 4 argümanlı imza
 * sözleşmesi gereği `_next` parametresi imzada kalmalı. `app.use(errorHandler)`
 * çağrısı tüm route'lardan SONRA gelmeli.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, body } = toHttpError(err);
  if (status >= 500) {
    logger.error({ err }, '[errorHandler] unhandled error');
  }
  res.status(status).json(body);
};
