import 'dotenv/config';
import express from 'express';
import { Pool } from 'pg';

const app = express();
const port = process.env['PORT'] ?? 3001;

const pool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ??
    'postgresql://postgres:postgres@localhost:5432/pos_dev',
});

app.get('/health', async (_req, res) => {
  try {
    const result = await pool.query<{ version: string }>('SELECT version()');
    const version = result.rows[0]?.version ?? 'unknown';
    res.json({
      status: 'ok',
      pg_version: version,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      message: err instanceof Error ? err.message : 'pg connection failed',
      ts: new Date().toISOString(),
    });
  }
});

app.listen(port, () => {
  console.log(`[api] Dinleniyor: http://localhost:${port.toString()}`);
});
