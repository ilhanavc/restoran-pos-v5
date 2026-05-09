import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Server as IoServer } from 'socket.io';
import type { DB } from '@restoran-pos/db';
import {
  authRouter,
  tablesRouter,
  menuRouter,
  ordersRouter,
  usersRouter,
  productsRouter,
  areasRouter,
  settingsRouter,
  attributeGroupsRouter,
  categoryAttributesRouter,
  productAttributesRouter,
  paymentsRouter,
  reportsRouter,
  customersRouter,
  callerIdRouter,
  bridgeCallerIdRouter,
  kdsRouter,
} from './routes';
import { errorHandler } from './middleware/errorHandler.js';

export interface BuildAppOptions {
  pool: Pool;
  db: Kysely<DB>;
  accessSecret: string;
  tenantId: string;
  webOrigin: string;
  /**
   * ADR-016 §11 — Caller bridge shared secret. `undefined` ise bridge
   * endpoint'i fail-closed çalışır (her istek 401). Test'ler stub değer
   * geçer, prod `index.ts` env üzerinden okur.
   */
  bridgeToken?: string;
  /**
   * ADR-010 + ADR-020 K12 — Socket.IO server. `undefined` ise emit no-op
   * (test default). Prod `index.ts` createRealtimeServer().io geçer; tests
   * stub geçerek emit assert edebilir (kitchen.orderSent, order:created vs.).
   */
  io?: IoServer;
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
  // Bulk import (Excel müşteri içe aktarma 1000+ satır) için 10mb limit.
  app.use(express.json({ limit: '10mb' }));

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

  // ADR-012 attribute-groups routes — daha spesifik path'ler /menu ve
  // /products genel router'larından ÖNCE mount edilir (Express greedy
  // prefix matching). categoryAttributesRouter / productAttributesRouter
  // mergeParams ile parent `:id`'yi inherit eder.
  app.use('/attribute-groups', attributeGroupsRouter({ db: opts.db, accessSecret: opts.accessSecret }));
  app.use(
    '/menu/categories/:id/attribute-groups',
    categoryAttributesRouter({ db: opts.db, accessSecret: opts.accessSecret }),
  );
  app.use(
    '/products/:id/attribute-groups',
    productAttributesRouter({ db: opts.db, accessSecret: opts.accessSecret }),
  );

  app.use('/tables', tablesRouter({ db: opts.db, accessSecret: opts.accessSecret }));
  app.use('/menu', menuRouter({ db: opts.db, accessSecret: opts.accessSecret }));
  app.use(
    '/orders',
    ordersRouter({
      db: opts.db,
      accessSecret: opts.accessSecret,
      ...(opts.io !== undefined ? { io: opts.io } : {}),
    }),
  );
  // ADR-020 — KDS endpoints (Phase 3 Sprint 12 PR-2b).
  app.use('/kds', kdsRouter({ db: opts.db, accessSecret: opts.accessSecret }));
  app.use('/users', usersRouter({ db: opts.db, accessSecret: opts.accessSecret }));
  app.use('/products', productsRouter({ db: opts.db, accessSecret: opts.accessSecret }));
  app.use('/areas', areasRouter({ db: opts.db, accessSecret: opts.accessSecret }));
  app.use('/settings', settingsRouter({ db: opts.db, accessSecret: opts.accessSecret }));
  app.use('/payments', paymentsRouter({ db: opts.db, accessSecret: opts.accessSecret }));
  app.use('/reports', reportsRouter({ db: opts.db, accessSecret: opts.accessSecret }));

  // ADR-016 §11 — Müşteri rehberi + Caller ID.
  app.use('/customers', customersRouter({ db: opts.db, accessSecret: opts.accessSecret }));
  app.use(
    '/caller-id',
    callerIdRouter({
      db: opts.db,
      accessSecret: opts.accessSecret,
      bridgeToken: opts.bridgeToken,
    }),
  );
  // Bridge endpoint X-Bridge-Token + X-Tenant-Id header'ları ile auth olur;
  // JWT akışından ayrı path prefix.
  app.use(
    '/bridge/caller-id',
    bridgeCallerIdRouter({
      db: opts.db,
      accessSecret: opts.accessSecret,
      bridgeToken: opts.bridgeToken,
    }),
  );

  // ADR-006 §2 — must be last; tüm route'lardan sonra
  app.use(errorHandler);

  return app;
}
