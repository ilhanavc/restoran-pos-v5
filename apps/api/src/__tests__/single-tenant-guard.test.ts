import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import { createAppTenantPool } from './helpers/appTenantPool';
import { warnIfMultiTenant } from '../config/singleTenantGuard.js';
import { captureError } from '../observability/sentry.js';
import { logger } from '../logger.js';

/**
 * Sentry kanalı mock'lanır (Amd6 K4 ile aynı gerekçe, retention-watchdog
 * testinin deseni): alarmın yalnız üretildiğini değil **gerçekten Sentry'ye
 * bildirildiğini** de doğrulamak için.
 */
vi.mock('../observability/sentry.js', () => ({
  captureError: vi.fn(),
}));

/**
 * ADR-041 Amendment 7 Karar 4 — **sunset guard (M6)** testleri.
 *
 * Kabul kriteri 13: `tenants` tablosunda birden fazla satır varken boot →
 * `captureError` + `logger.error` ÇAĞRILIR, **API ayağa kalkar** (fail-fast
 * DEĞİL). M4/M5'ten bilinçli sapma: ikinci tenant eklemek meşru bir iştir;
 * amaç engellemek değil, tek-tenant varsayımının sessiz kalmasını önlemektir.
 *
 * ⚠️ Rol teyidi (K7 ek kural 1): guard `app_tenant` altında koşmalıdır —
 * prod'da uygulama o rolle bağlanır ve `tenants` SELECT yetkisi Amd5 ile
 * canlıdır. `SET LOCAL ROLE` transaction dışında sessizce etkisiz olduğu için
 * ilk test `current_user`'ı doğrular; aksi halde "yetki var" sonucu süperuser
 * altında ölçülmüş olur ve sahte-yeşil kalırdı.
 *
 * ⚠️ `tenants` paylaşımlı test DB'sinde çok satırlıdır (her test dosyası kendi
 * tenant'ını seed eder) → "tek tenant" senaryosu izole edilemez. Bu yüzden
 * eşik davranışı iki yönlü doğrulanır: sayım > 1 ise alarm YANAR, sayım ≤ 1
 * ise YANMAZ.
 */

const DB_URL = process.env['DATABASE_URL'];

interface Ctx {
  pool: Pool;
  db: Kysely<DB>;
  appPool: Pool;
  appDb: Kysely<DB>;
}

const ctx: Partial<Ctx> = {};

const T_ONE = randomUUID();
const T_TWO = randomUUID();

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-041 Amd7 K4 — tek-tenant sunset guard (M6)',
  () => {
    beforeAll(() => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      ctx.pool = pool;
      ctx.db = createKysely(pool);
      const appPool = createAppTenantPool(DB_URL ?? '');
      ctx.appPool = appPool;
      ctx.appDb = createKysely(appPool);
    });

    beforeEach(() => {
      vi.mocked(captureError).mockClear();
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('tenants')
          .where('id', 'in', [T_ONE, T_TWO])
          .execute();
        await ctx.db.destroy();
      }
      if (ctx.appDb !== undefined) await ctx.appDb.destroy();
    });

    it('ROL TEYİDİ: guard app_tenant altında koşar (sahte-yeşil kapısı)', async () => {
      const r = await sql<{ u: string }>`select current_user as u`.execute(
        ctx.appDb!,
      );
      expect(r.rows[0]?.u).toBe('app_tenant');
    });

    it('app_tenant `tenants` tablosunu SAYABİLİR (Amd5 GRANT\'i canlı)', async () => {
      // Guard'ın ön-koşulu: yeni GRANT gerekmediği iddiasının ampirik kanıtı.
      const r = await sql<{ n: string }>`
        select count(*)::text as n from public.tenants where deleted_at is null
      `.execute(ctx.appDb!);
      expect(Number(r.rows[0]?.n ?? '-1')).toBeGreaterThanOrEqual(0);
    });

    it('eşik davranışı: sayım > 1 ise alarm YANAR, ≤ 1 ise YANMAZ', async () => {
      const current = await sql<{ n: string }>`
        select count(*)::text as n from public.tenants where deleted_at is null
      `.execute(ctx.appDb!);
      const n = Number(current.rows[0]?.n ?? '0');

      const errorLog = vi.spyOn(logger, 'error');
      await warnIfMultiTenant(ctx.appDb!);

      if (n > 1) {
        expect(vi.mocked(captureError)).toHaveBeenCalledTimes(1);
      } else {
        expect(vi.mocked(captureError)).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
      }
      errorLog.mockRestore();
    });

    it('iki tenant → captureError + logger.error ÇAĞRILIR, FIRLATMAZ (API ayakta kalır)', async () => {
      await ctx.db!
        .insertInto('tenants')
        .values([
          {
            id: T_ONE,
            name: `m6-a-${T_ONE.slice(0, 8)}`,
            slug: `m6-a-${T_ONE.slice(0, 8)}`,
          },
          {
            id: T_TWO,
            name: `m6-b-${T_TWO.slice(0, 8)}`,
            slug: `m6-b-${T_TWO.slice(0, 8)}`,
          },
        ])
        .execute();

      const errorLog = vi.spyOn(logger, 'error');

      // FIRLATMAZ — boot devam eder (M4/M5'in `process.exit(1)`'inden farkı).
      await expect(warnIfMultiTenant(ctx.appDb!)).resolves.toBeUndefined();

      expect(vi.mocked(captureError)).toHaveBeenCalledTimes(1);
      const reported = vi.mocked(captureError).mock.calls[0]?.[0];
      expect(reported).toBeInstanceOf(Error);
      expect((reported as Error).message).toContain('Amd7 K4 sunset koşulu');
      expect(errorLog).toHaveBeenCalledTimes(1);

      errorLog.mockRestore();
    });
  },
);
