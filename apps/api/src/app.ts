import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { DB } from '@restoran-pos/db';
import { authRouter } from './routes';
import { errorHandler } from './middleware/errorHandler.js';

export interface BuildAppOptions {
  pool: Pool;
  db: Kysely<DB>;
  accessSecret: string;
  tenantId: string;
  webOrigin: string;
}

/**
 * Express app fabrikası — listen()'i çağırmaz, sadece app döner.
 * Test'ler de prod entry de bu fabrikadan geçer.
 */
export function buildApp(opts: BuildAppOptions): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: opts.webOrigin, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    try {
      const result = await opts.pool.query<{ version: string }>(
        'SELECT version()',
      );
      const version = result.rows[0]?.version ?? 'unknown';
      res.json({
        status: 'ok',
        pg_version: version,
        ts: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: 'error',
        message: 'database connection failed',
        ts: new Date().toISOString(),
      });
    }
  });

  app.use(
    '/auth',
    authRouter({
      db: opts.db,
      accessSecret: opts.accessSecret,
      tenantId: opts.tenantId,
    }),
  );

  // ADR-006 §2 — must be last; tüm route'lardan sonra
  app.use(errorHandler);

  return app;
}
