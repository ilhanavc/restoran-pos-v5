import 'dotenv/config';
import { createPool, createKysely } from '@restoran-pos/db';
import { buildApp } from './app';
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

const app = buildApp({
  pool,
  db,
  accessSecret,
  tenantId,
  webOrigin: process.env['WEB_ORIGIN'] ?? 'http://localhost:5173',
});

process.on('unhandledRejection', (reason) => {
  // Normalize reason to avoid leaking DB connection strings or tokens from
  // raw Error messages (e.g. pg driver errors contain DATABASE_URL).
  const safeReason =
    reason instanceof Error
      ? { name: reason.name, message: reason.message.replace(/:[^@\s]+@/g, ':***@') }
      : { raw: String(reason).slice(0, 200) };
  logger.error({ reason: safeReason }, '[api] unhandledRejection');
});

app.listen(port, () => {
  logger.info({ port }, '[api] Listening on http://localhost:%s', String(port));
});
