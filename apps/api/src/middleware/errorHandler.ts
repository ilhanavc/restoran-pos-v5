import type { ErrorRequestHandler } from 'express';
import { toHttpError } from '../errors.js';

/**
 * ADR-006 §2 — Tek merkezi error middleware. Express'in 4 argümanlı imza
 * sözleşmesi gereği `_next` parametresi imzada kalmalı. `app.use(errorHandler)`
 * çağrısı tüm route'lardan SONRA gelmeli.
 *
 * NOT: Sprint 0 Madde 5 (pino logger) geldiğinde bu console.error tümüyle kalkacak.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, body } = toHttpError(err);
  if (status >= 500) {
    console.error('[errorHandler]', err);
  }
  res.status(status).json(body);
};
