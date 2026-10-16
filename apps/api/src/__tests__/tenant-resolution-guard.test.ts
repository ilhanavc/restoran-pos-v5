import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import { createAppTenantPool } from './helpers/appTenantPool';
import { assertTenantResolution } from '../config/tenantResolutionGuard.js';
import { slugRateLimitKey, DEFAULT_SLUG_KEY } from '../auth/tenantResolution.js';
import { captureError } from '../observability/sentry.js';
import { logger } from '../logger.js';

vi.mock('../observability/sentry.js', () => ({
  captureError: vi.fn(),
}));

/**
 * ADR-042 K4 — tenant çözümü açılış guard'ı (eski M6 sunset guard'ın yerine).
 *
 * **Sözleşme değişti:** `tenants > 1` ARTIK BİR HATA DEĞİL — ADR-042 tenant'ı
 * işletme kodundan çözüyor, ikinci işletme desteklenen bir durum. Guard
 * kaldırılmadı, dönüştürüldü; artık çözüm mekanizmasının kendi **sessiz**
 * başarısızlıklarına bakıyor:
 *
 *   (i)  `TENANT_ID` geçersizse → slug'sız girişlerin ve öneksiz token'ların
 *        TAMAMI sessizce 401 olur (force-RLS'te context'siz okuma hata
 *        fırlatmaz, 0 satır döner) → prod'da fail-fast.
 *   (ii) slug biçim ihlali → `captureError`, API durmaz.
 *   (iii) çok tenant + legacy fallback → `logger.warn`.
 *   + varsayılan tenant'ın slug'ını rate-limit anahtar üreticisine besler.
 *
 * ⚠️ Rol teyidi korunuyor: guard `app_tenant` altında koşmalı. `SET LOCAL ROLE`
 * transaction dışında sessizce etkisizdir; doğrulanmazsa "yetki var" sonucu
 * süperuser altında ölçülür ve sahte-yeşil kalır.
 *
 * ⚠️ `tenants` paylaşımlı test DB'sinde çok satırlıdır (her dosya kendi
 * tenant'ını seed eder) → "tek tenant" senaryosu izole edilemez.
 */

const DB_URL = process.env['DATABASE_URL'];

interface Ctx {
  pool: Pool;
  db: Kysely<DB>;
  appPool: Pool;
  appDb: Kysely<DB>;
}

const ctx: Partial<Ctx> = {};

const T_DEFAULT = randomUUID();
const SLUG_DEFAULT = `trg-${T_DEFAULT.slice(0, 8)}`;

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-042 K4 — tenant çözümü guard',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      ctx.pool = pool;
      ctx.db = createKysely(pool);
      const appPool = createAppTenantPool(DB_URL ?? '');
      ctx.appPool = appPool;
      ctx.appDb = createKysely(appPool);

      await ctx.db
        .insertInto('tenants')
        .values({ id: T_DEFAULT, name: 'Guard Default', slug: SLUG_DEFAULT })
        .execute();
    });

    beforeEach(() => {
      vi.mocked(captureError).mockClear();
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('tenants').where('id', '=', T_DEFAULT).execute();
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

    it('app_tenant `tenants` tablosunu okuyabilir — yeni GRANT gerekmiyor iddiasının kanıtı', async () => {
      const r = await sql<{ n: string }>`
        select count(*)::text as n from public.tenants where deleted_at is null
      `.execute(ctx.appDb!);
      expect(Number(r.rows[0]?.n ?? '-1')).toBeGreaterThanOrEqual(1);
    });

    it('🔑 GEÇERLİ varsayılan tenant → FIRLATMAZ ve slug rate-limit\'e beslenir', async () => {
      // Besleme ÖNCESİ: slug kendi anahtarını üretir (iki ayrı kova = 2× bütçe).
      expect(slugRateLimitKey(SLUG_DEFAULT)).toBe(SLUG_DEFAULT);

      await expect(
        assertTenantResolution(ctx.appDb!, T_DEFAULT),
      ).resolves.toBeUndefined();

      // Besleme SONRASI: varsayılan tenant'ın slug'ı slug'SIZ istekle AYNI
      // kovaya düşer — yoksa o hesaba 15 dakikada 5 değil 10 deneme düşerdi.
      expect(slugRateLimitKey(SLUG_DEFAULT)).toBe(DEFAULT_SLUG_KEY);
      // Başka bir işletmenin kodu kanonikleşMEZ (çapraz-tenant kilit yok).
      expect(slugRateLimitKey('baska-isletme')).toBe('baska-isletme');
    });

    it('🔴 GEÇERSİZ TENANT_ID → logger.error + captureError (prod\'da fail-fast)', async () => {
      // Bu kontrol bugünkü `TENANT_ID` fail-fast'inin EKSİK yarısıdır: env'in
      // var olduğu denetleniyordu, GEÇERLİ olduğu değil. Geçersizse kesinti
      // hiçbir hata logu üretmeden yaşanırdı.
      const errorLog = vi.spyOn(logger, 'error');
      const ghost = randomUUID();

      // NODE_ENV test → process.exit ÇAĞRILMAZ, yalnız loglanır.
      await expect(
        assertTenantResolution(ctx.appDb!, ghost),
      ).resolves.toBeUndefined();

      expect(vi.mocked(captureError)).not.toHaveBeenCalled(); // prod dışı
      expect(errorLog).toHaveBeenCalled();
      const msg = String(errorLog.mock.calls[0]?.[1] ?? '');
      expect(msg).toContain('tenants tablosunda yok');
      errorLog.mockRestore();
    });

    it('çok tenant + legacy fallback → logger.warn (hata DEĞİL, artık meşru durum)', async () => {
      // Eski sözleşmede bu `captureError` üretiyordu. ADR-042 ile ikinci
      // işletme desteklendiği için sinyal "hata"dan "istemciler güncellenmemiş
      // olabilir" uyarısına indirildi.
      const warnLog = vi.spyOn(logger, 'warn');
      await assertTenantResolution(ctx.appDb!, T_DEFAULT);

      const n = await sql<{ n: string }>`
        select count(*)::text as n from public.tenants where deleted_at is null
      `.execute(ctx.appDb!);
      if (Number(n.rows[0]?.n ?? '0') > 1) {
        expect(warnLog).toHaveBeenCalled();
        expect(vi.mocked(captureError)).not.toHaveBeenCalled();
      }
      warnLog.mockRestore();
    });
  },
);
