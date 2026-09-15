/**
 * ADR-041 (Tenant İzolasyon — Defense-in-Depth) Faz 1 entegrasyon testleri.
 *
 * F1 KAPSAMI: yalnız altyapı. Henüz RLS policy YOK → davranış birebir aynı.
 * Bu dosya F2-F4'te aile-aile cross-tenant izolasyon matrisiyle BÜYÜYECEK
 * (her RLS-açılan tablo bir satır ekler; RLS'siz tablo merge edilmez — DoD).
 *
 * F1'de kanıtlanan invariant'lar:
 *  1. withTenant içinde current_setting('app.current_tenant_id', true) === tenantId.
 *  2. is_local=true → transaction dışında (havuzdaki client) context BOŞ döner
 *     (pool-sızıntısı yok; session-level SET kullanılmıyor).
 *  3. Geçersiz tenantId fail-fast (transaction hiç açılmaz).
 *  4. app_tenant (uygulama rolü, NOBYPASSRLS) grant kanıtı: tabloya SELECT/INSERT
 *     yetkisi var (RLS henüz kapalı → tam erişim; grant'ların doğruluğu kanıtı).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createPool, createKysely, withTenant, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';

const DB_URL = process.env['DATABASE_URL'];
const TENANT_A = randomUUID();

interface Ctx {
  pool: Pool;
  db: Kysely<DB>;
}
const ctx: Partial<Ctx> = {};

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-041 F1 — tenant context altyapısı',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      ctx.pool = pool;
      ctx.db = createKysely(pool);
      // Grant kanıtı için tenant satırı (FK bağımlılığı olmadan izole).
      await ctx.db
        .insertInto('tenants')
        .values({
          id: TENANT_A,
          name: `iso-${TENANT_A.slice(0, 8)}`,
          slug: `iso-${TENANT_A.slice(0, 8)}`,
        })
        .execute();
    });

    afterAll(async () => {
      if (ctx.db && ctx.pool) {
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_A).execute();
        await ctx.pool.end();
      }
    });

    it('withTenant içinde current_setting beklenen tenantId döner', async () => {
      const db = ctx.db!;
      const value = await withTenant(db, TENANT_A, async (trx) => {
        const row = await sql<{ v: string | null }>`
          select current_setting('app.current_tenant_id', true) as v
        `.execute(trx);
        return row.rows[0]?.v ?? null;
      });
      expect(value).toBe(TENANT_A);
    });

    it('is_local kanıtı: aynı bağlantı (max:1) yeniden kullanılınca context boş', async () => {
      // KRİTİK: max:1 havuz → withTenant'ın kullandığı fiziksel bağlantı, sonraki
      // "dışarıdaki" sorguda GARANTİ yeniden kullanılır. Böylece boş sonuç yalnız
      // is_local=true reset'ini kanıtlar. (Default max:10 havuzda dışarı sorgusu
      // farklı — hiç dokunulmamış — bağlantıya düşüp "vakum-yeşil" verebilirdi;
      // session-level SET sızıntısı o hâlde yakalanmazdı — security-review MED.)
      const pool1 = createPool({ connectionString: DB_URL ?? '', max: 1 });
      const db1 = createKysely(pool1);
      try {
        // withTenant context'i set eder + COMMIT'te is_local ile sıfırlar.
        await withTenant(db1, TENANT_A, async () => undefined);
        // AYNI bağlantıda düz sorgu: is_local reset çalışıyorsa boş; session-level
        // SET sızıntısı olsaydı bu tek bağlantı kirli kalır → TENANT_A dönerdi.
        const outside = await sql<{ v: string | null }>`
          select current_setting('app.current_tenant_id', true) as v
        `.execute(db1);
        const v = outside.rows[0]?.v ?? null;
        expect(v === null || v === '').toBe(true);
      } finally {
        await pool1.end();
      }
    });

    it('geçersiz tenantId fail-fast (transaction açılmaz)', async () => {
      const db = ctx.db!;
      await expect(withTenant(db, 'not-a-uuid', async () => 1)).rejects.toThrow(
        TypeError,
      );
      await expect(withTenant(db, '', async () => 1)).rejects.toThrow(TypeError);
    });

    it('app_tenant rolü grant kanıtı: tenants tablosuna SELECT/INSERT yetkisi', async () => {
      const db = ctx.db!;
      const priv = await sql<{ can_select: boolean; can_insert: boolean }>`
        select
          has_table_privilege('app_tenant', 'public.tenants', 'SELECT') as can_select,
          has_table_privilege('app_tenant', 'public.tenants', 'INSERT') as can_insert
      `.execute(db);
      expect(priv.rows[0]?.can_select).toBe(true);
      expect(priv.rows[0]?.can_insert).toBe(true);
    });

    it('app_tenant rolü davranışsal kanıt: SET LOCAL ROLE ile SELECT çalışır (RLS yok)', async () => {
      const db = ctx.db!;
      // Tek transaction içinde app_tenant'ın gerçek runtime yetkisini kanıtla:
      // SET LOCAL ROLE app_tenant → o rolün privilege'larıyla SELECT. RLS henüz
      // yok → satır görünür (grant + erişim çalışıyor). is_local: COMMIT'te reset.
      const count = await db.transaction().execute(async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ n: number }>`
          select count(*)::int as n from tenants where id = ${TENANT_A}
        `.execute(trx);
        return res.rows[0]?.n ?? 0;
      });
      expect(count).toBe(1);
    });
  },
);
