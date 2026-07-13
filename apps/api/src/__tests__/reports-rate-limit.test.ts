import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';

/**
 * Güvenlik (Session 94 denetim fix, R7-DOS-01) — /reports rate-limit regression.
 *
 * Rapor endpoint'leri ağır tarih-aralığı aggregation yapar; `reportsLimiter`
 * (120/dk-IP) bunları DoS'a karşı korur. Bu test limiter'ın gerçekten bağlı
 * olduğunu kanıtlar; gelecekte sessizce kaldırılırsa/gevşetilirse kırılır.
 *
 * Limiter auth'tan ÖNCE çalışır (reportsRouter'ın ilk middleware'i) → geçersiz
 * (token'sız) istekle ucuz test edilebilir: limiter sayar → requireAuth 401
 * (DB'ye dokunmadan). Ayrı dosya + ayrı buildApp = taze limiter sayacı; sabit
 * X-Forwarded-For (trust proxy=1) → tek IP keyi, izole sayım.
 *
 * Kendini savunur: E2E_BYPASS_REPORTS_LIMIT'i buildApp ÖNCESİ zorla KAPAT
 * (reports.test bunu '1' set eder; thread-pool'da env paylaşılırsa sızmasın).
 */

const DB_URL = process.env['DATABASE_URL'];

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  prevBypass: string | undefined;
}

const ctx: Partial<TestCtx> = {};
const TENANT_ID = '00000000-0000-0000-0000-0000000000bb';
// Sabit tek IP — bu suite'in 121 isteği aynı limiter key'ine düşer.
const CLIENT_IP = '203.0.113.94';

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  '/reports rate-limit (Session 94 R7-DOS-01)',
  () => {
    beforeAll(() => {
      // Limiter construction'da env'i yakalar → buildApp'ten ÖNCE zorla kapat.
      ctx.prevBypass = process.env['E2E_BYPASS_REPORTS_LIMIT'];
      delete process.env['E2E_BYPASS_REPORTS_LIMIT'];
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
      if (ctx.prevBypass === undefined) {
        delete process.env['E2E_BYPASS_REPORTS_LIMIT'];
      } else {
        process.env['E2E_BYPASS_REPORTS_LIMIT'] = ctx.prevBypass;
      }
    });

    it('120 istekten sonra /reports → 429 REPORTS_RATE_LIMITED', async () => {
      // Token yok → limiter geçer (count++) → requireAuth 401 (DB yok).
      // Limit 120: ilk 120 istek 429 DEĞİL (401), 121. istek 429.
      for (let i = 0; i < 120; i++) {
        const res = await request(ctx.app!)
          .get('/reports/kpi/today-revenue')
          .set('X-Forwarded-For', CLIENT_IP);
        expect(res.status).not.toBe(429);
      }
      const blocked = await request(ctx.app!)
        .get('/reports/kpi/today-revenue')
        .set('X-Forwarded-For', CLIENT_IP);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('REPORTS_RATE_LIMITED');
      expect(blocked.body.error.message_key).toBe('error.reports.rateLimited');
    });
  },
);
