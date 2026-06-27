import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';

/**
 * Güvenlik (Session 70 denetimi) — agent auth endpoint rate-limit regression.
 *
 * /agent/register + /agent/refresh `agentAuthLimiter` (30/15dk-IP) ile
 * korunur (apiKey brute-force + bcrypt CPU DoS). Bu test limiter'ın gerçekten
 * bağlı olduğunu kanıtlar; gelecekte sessizce kaldırılırsa kırılır.
 *
 * Limiter middleware validation/bcrypt'ten ÖNCE çalışır → geçersiz body ile
 * (zod fail, DB/bcrypt'e dokunmadan) ucuz test edilebilir. Ayrı dosya =
 * izole buildApp = taze limiter sayacı (diğer agent testlerini etkilemez).
 */

const DB_URL = process.env['DATABASE_URL'];

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
}

const ctx: Partial<TestCtx> = {};
const TENANT_ID = '00000000-0000-0000-0000-0000000000aa';

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'agent auth endpoint rate-limit (Session 70 güvenlik)',
  () => {
    beforeAll(() => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.app = buildApp({
        pool,
        db,
        accessSecret: 'test-secret-min-32-chars-please-be-long-enough',
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });
    });

    afterAll(async () => {
      if (ctx.db !== undefined) await ctx.db.destroy();
    });

    it('30 istekten sonra /agent/register → 429 AUTH_RATE_LIMITED', async () => {
      // Geçersiz body → limiter geçer (count++) → zod 400 (bcrypt/DB yok).
      // Limit 30: ilk 30 istek 429 DEĞİL, 31. istek 429.
      for (let i = 0; i < 30; i++) {
        const res = await request(ctx.app!)
          .post('/print/v1/agent/register')
          .send({});
        expect(res.status).not.toBe(429);
      }
      const blocked = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({});
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('AUTH_RATE_LIMITED');
    });
  },
);
