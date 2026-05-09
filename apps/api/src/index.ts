import 'dotenv/config';
import { createServer } from 'node:http';
import { createPool, createKysely } from '@restoran-pos/db';
import { buildApp } from './app';
import { createRealtimeServer } from './realtime/server.js';
import { startTtlCleanup } from './cron/ttl-cleanup.js';
import { logger } from './logger.js';

const port = process.env['PORT'] ?? 3001;

const accessSecret = process.env['JWT_ACCESS_SECRET'];
if (accessSecret === undefined || accessSecret.length < 32) {
  throw new Error(
    'JWT_ACCESS_SECRET is required (min 32 chars) — set it in .env',
  );
}

const tenantId =
  process.env['TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001';

const databaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/pos_dev';

const pool = createPool({ connectionString: databaseUrl });
const db = createKysely(pool);

// ADR-016 §11 — Caller bridge shared secret. `undefined` ise bridge endpoint'i
// fail-closed (401). Prod kurulumda set edilir; dev/CI'da opsiyonel.
const bridgeToken = process.env['BRIDGE_TOKEN'];

process.on('unhandledRejection', (reason) => {
  // Normalize reason to avoid leaking DB connection strings or tokens from
  // raw Error messages (e.g. pg driver errors contain DATABASE_URL).
  const safeReason =
    reason instanceof Error
      ? { name: reason.name, message: reason.message.replace(/:[^@\s]+@/g, ':***@') }
      : { raw: String(reason).slice(0, 200) };
  logger.error({ reason: safeReason }, '[api] unhandledRejection');
});

// ADR-010 + ADR-020 K12 — Realtime io, app'e referans olarak geçecek
// (kitchen.orderSent / kitchen.itemStatusChanged / order:* emit'leri
// için). Wire sırası kritik: io → app → httpServer.on('request', app).
//
// 1. Bare http server (henüz request listener yok)
const httpServer = createServer();

// 2. Socket.IO realtime — bare httpServer'a upgrade handler attach eder
const realtime = createRealtimeServer({
  httpServer,
  accessSecret,
  webOrigin: process.env['WEB_ORIGIN'] ?? 'http://localhost:5173',
});

// 3. Express app — io referansı ile build (deps.io tanımlı; ordersRouter
//    ve diğer route'lar emit edebilir)
const app = buildApp({
  pool,
  db,
  accessSecret,
  tenantId,
  webOrigin: process.env['WEB_ORIGIN'] ?? 'http://localhost:5173',
  io: realtime.io,
  ...(bridgeToken !== undefined ? { bridgeToken } : {}),
});

// 4. HTTP request handler olarak app'i bağla (Socket.IO upgrade events
//    ayrı path'te akmaya devam eder)
httpServer.on('request', app);

httpServer.listen(port, () => {
  logger.info({ port }, '[api] Listening on http://localhost:%s', String(port));
});

// ADR-002 §13 — TTL cleanup cron. Test ortamında ve DISABLE_CRON=1 ile devre dışı.
if (process.env['NODE_ENV'] !== 'test' && process.env['DISABLE_CRON'] !== '1') {
  startTtlCleanup({ pool, db });
}
