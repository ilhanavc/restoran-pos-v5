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
import type { Kysely, Transaction } from 'kysely';
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

/**
 * ADR-041 F2 — PİLOT RLS cross-tenant izolasyon matrisi (`tables` + `areas`).
 *
 * ⚠️ Süperuser tuzağı: testler `postgres` süperuser bağlantısıyla koşar →
 * süperuser RLS'i BYPASS eder. RLS'i GERÇEKTEN sınamak için sorgular
 * `SET LOCAL ROLE app_tenant` (NOBYPASSRLS runtime rolü) altında koşturulur.
 * Aksi halde test RLS'i hiç exercise etmez → sahte-yeşil.
 *
 * Ön-koşul: migration 054 (RLS ENABLE+FORCE+policy) pos_test'te koşmuş olmalı.
 * Seed satırları süperuser (BYPASSRLS) ile yazılır — bilerek; izolasyon yalnız
 * app_tenant rolü altında beklenir.
 */
describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-041 F2 — pilot RLS izolasyonu (tables + areas)',
  () => {
    const T_A = randomUUID();
    const T_B = randomUUID();
    const TABLE_A = randomUUID();
    const TABLE_B = randomUUID();
    const AREA_A = randomUUID();
    const AREA_B = randomUUID();

    const rlsCtx: Partial<Ctx> = {};

    /**
     * Verilen (opsiyonel) tenant context'i is_local set_config ile enjekte eder,
     * ardından `SET LOCAL ROLE app_tenant` ile rolü RLS'e-tabi role düşürür ve
     * `fn`'i o transaction'da koşar. `tenantId === null` → context set edilmez
     * (fail-closed / boş-context senaryosu).
     */
    async function asAppTenant<T>(
      db: Kysely<DB>,
      tenantId: string | null,
      fn: (trx: Transaction<DB>) => Promise<T>,
    ): Promise<T> {
      return db.transaction().execute(async (trx) => {
        if (tenantId !== null) {
          await sql`select set_config('app.current_tenant_id', ${tenantId}, true)`.execute(
            trx,
          );
        }
        await sql`set local role app_tenant`.execute(trx);
        return fn(trx);
      });
    }

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      rlsCtx.pool = pool;
      rlsCtx.db = createKysely(pool);
      const db = rlsCtx.db;
      // Seed (süperuser → RLS bypass): iki tenant + her birine 1 masa + 1 bölge.
      await db
        .insertInto('tenants')
        .values([
          { id: T_A, name: `rls-a-${T_A.slice(0, 8)}`, slug: `rls-a-${T_A.slice(0, 8)}` },
          { id: T_B, name: `rls-b-${T_B.slice(0, 8)}`, slug: `rls-b-${T_B.slice(0, 8)}` },
        ])
        .execute();
      await db
        .insertInto('tables')
        .values([
          { id: TABLE_A, tenant_id: T_A, code: 'RA1' },
          { id: TABLE_B, tenant_id: T_B, code: 'RB1' },
        ])
        .execute();
      await db
        .insertInto('areas')
        .values([
          { id: AREA_A, tenant_id: T_A, name: 'Bölge A' },
          { id: AREA_B, tenant_id: T_B, name: 'Bölge B' },
        ])
        .execute();
    });

    afterAll(async () => {
      if (rlsCtx.db && rlsCtx.pool) {
        // Süperuser cleanup (RLS bypass): önce çocuk satırlar, sonra tenants.
        await rlsCtx.db.deleteFrom('tables').where('tenant_id', 'in', [T_A, T_B]).execute();
        await rlsCtx.db.deleteFrom('areas').where('tenant_id', 'in', [T_A, T_B]).execute();
        await rlsCtx.db.deleteFrom('tenants').where('id', 'in', [T_A, T_B]).execute();
        await rlsCtx.pool.end();
      }
    });

    it('tables: A context içinde app_tenant yalnız A satırını görür, B görünmez', async () => {
      const db = rlsCtx.db!;
      const seen = await withTenant(db, T_A, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`select id from tables`.execute(trx);
        return res.rows.map((r) => r.id);
      });
      expect(seen).toContain(TABLE_A);
      expect(seen).not.toContain(TABLE_B);
    });

    it('areas: A context içinde app_tenant yalnız A satırını görür, B görünmez', async () => {
      const db = rlsCtx.db!;
      const seen = await withTenant(db, T_A, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`select id from areas`.execute(trx);
        return res.rows.map((r) => r.id);
      });
      expect(seen).toContain(AREA_A);
      expect(seen).not.toContain(AREA_B);
    });

    it('tables: B context içinde A satırına UPDATE 0 satır etkiler (policy USING)', async () => {
      const db = rlsCtx.db!;
      const affected = await withTenant(db, T_B, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`
          update tables set capacity = 9 where id = ${TABLE_A} returning id
        `.execute(trx);
        return res.rows.length;
      });
      expect(affected).toBe(0);
    });

    it('areas: B context içinde A satırına DELETE 0 satır etkiler (policy USING)', async () => {
      const db = rlsCtx.db!;
      const affected = await withTenant(db, T_B, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`
          delete from areas where id = ${AREA_A} returning id
        `.execute(trx);
        return res.rows.length;
      });
      expect(affected).toBe(0);
    });

    it('tables: A context içinde B tenant_id ile INSERT WITH CHECK ihlali (reddedilir)', async () => {
      const db = rlsCtx.db!;
      await expect(
        withTenant(db, T_A, async (trx) => {
          await sql`set local role app_tenant`.execute(trx);
          await sql`
            insert into tables (id, tenant_id, code)
            values (${randomUUID()}, ${T_B}, 'HACK')
          `.execute(trx);
        }),
      ).rejects.toThrow();
    });

    it('fail-closed: boş context + app_tenant → tables sıfır satır', async () => {
      const db = rlsCtx.db!;
      const n = await asAppTenant(db, null, async (trx) => {
        const res = await sql<{ n: number }>`
          select count(*)::int as n from tables
        `.execute(trx);
        return res.rows[0]?.n ?? -1;
      });
      expect(n).toBe(0);
    });

    it('fail-closed: boş context + app_tenant → areas sıfır satır', async () => {
      const db = rlsCtx.db!;
      const n = await asAppTenant(db, null, async (trx) => {
        const res = await sql<{ n: number }>`
          select count(*)::int as n from areas
        `.execute(trx);
        return res.rows[0]?.n ?? -1;
      });
      expect(n).toBe(0);
    });

    // Regresyon guard — orders.ts:1237 dine-in snapshot consumer'ı (tables⋈areas).
    // Bu tablolar iki router DIŞINDA yalnız burada okunur; wrap unutulursa RLS
    // altında (app_tenant) 0 satır → tableCodeSnapshot/areaNameSnapshot sessizce
    // null kalırdı. Süperuser test bağlantısı bunu maskeler; bu yüzden desen
    // burada app_tenant + withTenant context altında açıkça doğrulanır.
    it('orders snapshot deseni: withTenant+app_tenant altında tables⋈areas satırı döner', async () => {
      const db = rlsCtx.db!;
      const row = await withTenant(db, T_A, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        return trx
          .selectFrom('tables')
          .leftJoin('areas', (join) =>
            join
              .onRef('areas.id', '=', 'tables.area_id')
              .onRef('areas.tenant_id', '=', 'tables.tenant_id'),
          )
          .select(['tables.code as t_code', 'areas.name as a_name'])
          .where('tables.tenant_id', '=', T_A)
          .where('tables.id', '=', TABLE_A)
          .executeTakeFirst();
      });
      expect(row?.t_code).toBe('RA1');
    });
  },
);
