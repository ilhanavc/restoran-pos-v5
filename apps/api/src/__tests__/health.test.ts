import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { buildApp } from '../app';

/**
 * /health is public (no auth). It must prove DB reachability without
 * disclosing the PostgreSQL/OS version string (API-AZ-12, ADR-047 K9).
 * pos-release smoke only needs `"status":"ok"`.
 */
function appWith(query: ReturnType<typeof vi.fn>) {
  return buildApp({
    pool: { query } as unknown as Pool,
    db: {} as Kysely<DB>,
    accessSecret: 'test-secret-min-32-chars-please-be-long-enough',
    agentSecret: 'agent-secret-min-32-chars-please-be-long-enough',
    tenantId: '00000000-0000-0000-0000-000000000000',
    webOrigin: 'http://localhost:5173',
  });
}

describe('GET /health', () => {
  it('returns ok without any version fingerprint', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const res = await request(appWith(query)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).not.toHaveProperty('pg_version');
    expect(JSON.stringify(res.body)).not.toMatch(/PostgreSQL|ubuntu|gcc/i);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when the DB is unreachable', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connection refused'));
    const res = await request(appWith(query)).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
  });
});
