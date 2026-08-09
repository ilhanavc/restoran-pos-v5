import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { auditLogsRouter } from '../routes/audit-logs';
import { errorHandler } from '../middleware/errorHandler';

/**
 * ADR-037 K5 — rate-limit (60 istek/dk/IP) ve **bypass'ın prod'da inert olması**.
 *
 * Güvenlik denetimi bulgusu: `E2E_BYPASS_AUDIT_LIMIT` tek başına, herhangi bir
 * ortamda (prod dahil) korumayı sıfırlayabiliyordu. Rate-limit, ele geçirilmiş
 * bir admin oturumunun günlüğü toplu sıyırmasını yavaşlatan TEK mekanizmadır
 * (K5 "okuma kayıt altına alınmaz" kabulünün karşılığı).
 *
 * DB'siz koşar: limiter `authenticate`'ten ÖNCEDİR (yetkisiz probing DB'ye
 * vurmadan sayılır), dolayısıyla 429 davranışı token'sız gözlemlenebilir.
 * Limiter tetiklenmediğinde istek `authenticate`'e düşer ve 401 alır — bu da
 * "bypass çalışıyor" kanıtıdır.
 */

const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const RATE_LIMIT = 60;

const originalEnv = {
  nodeEnv: process.env['NODE_ENV'],
  bypass: process.env['E2E_BYPASS_AUDIT_LIMIT'],
};

/** Router her `buildApp`'te yeni limiter kurar → env'i ÖNCE ayarla. */
function buildTestApp(): Express {
  const app = express();
  app.use(
    '/audit-logs',
    auditLogsRouter({
      db: null as unknown as Kysely<DB>,
      accessSecret: ACCESS_SECRET,
    }),
  );
  app.use(errorHandler);
  return app;
}

/**
 * Sayaç per-IP'dir ve her `buildTestApp()` kendi in-memory store'unu kurar →
 * testler birbirini etkilemez (`trust proxy` AYARLI DEĞİL; supertest tek
 * loopback IP'den bağlanır, bu yüzden `X-Forwarded-For` GÖNDERİLMEZ —
 * express-rate-limit onu yok sayıp uyarı basardı).
 */
async function hammer(app: Express, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i += 1) {
    // Sıralı (paralel değil): limiter sayacı deterministik ilerlesin.
    const res = await request(app).get('/audit-logs');
    statuses.push(res.status);
  }
  return statuses;
}

describe('ADR-037 K5 — /audit-logs rate-limit', () => {
  beforeEach(() => {
    delete process.env['NODE_ENV'];
    delete process.env['E2E_BYPASS_AUDIT_LIMIT'];
  });

  afterEach(() => {
    if (originalEnv.nodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalEnv.nodeEnv;
    if (originalEnv.bypass === undefined) {
      delete process.env['E2E_BYPASS_AUDIT_LIMIT'];
    } else {
      process.env['E2E_BYPASS_AUDIT_LIMIT'] = originalEnv.bypass;
    }
  });

  it(`bypass YOKken ${RATE_LIMIT}. istekten sonra 429 AUDIT_RATE_LIMITED`, async () => {
    const app = buildTestApp();
    const statuses = await hammer(app, RATE_LIMIT + 2);

    // İlk 60 istek limiter'ı geçer (auth yok → 401), sonrakiler 429.
    expect(statuses.slice(0, RATE_LIMIT).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);

    const limited = await request(app).get('/audit-logs');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('AUDIT_RATE_LIMITED');
  });

  it('NODE_ENV=production altında bypass env\'i korumayı KAPATAMAZ', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['E2E_BYPASS_AUDIT_LIMIT'] = '1';
    const app = buildTestApp();

    const statuses = await hammer(app, RATE_LIMIT + 2);
    expect(statuses.at(-1)).toBe(429);
  });

  it('prod DIŞINDA bypass env\'i limiti kaldırır (test/E2E ihtiyacı)', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['E2E_BYPASS_AUDIT_LIMIT'] = '1';
    const app = buildTestApp();

    const statuses = await hammer(app, RATE_LIMIT + 5);
    // Hiç 429 yok; hepsi auth katmanına düşüp 401 alır.
    expect(statuses.every((s) => s === 401)).toBe(true);
  });
});
