import 'dotenv/config';
import { createPool, createKysely } from '@restoran-pos/db';
import { buildApp } from './app';

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
  // eslint-disable-next-line no-console
  console.error('[api] unhandledRejection', reason);
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] Dinleniyor: http://localhost:${port.toString()}`);
});
