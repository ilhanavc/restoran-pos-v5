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

/**
 * ADR-041 F3a — ÇEKİRDEK RLS cross-tenant izolasyon matrisi (`orders`).
 *
 * F2 (tables+areas) satırının orders muadili. Seed süperuser (BYPASSRLS) ile
 * iki tenant'a birer sipariş yazar; izolasyon yalnız app_tenant (NOBYPASSRLS)
 * + withTenant context altında beklenir. Ön-koşul: migration 055
 * (orders ENABLE+FORCE+policy) pos_test'te koşmuş olmalı.
 */
describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-041 F3a — çekirdek RLS izolasyonu (orders)',
  () => {
    const O_TA = randomUUID();
    const O_TB = randomUUID();
    const ORDER_A = randomUUID();
    const ORDER_B = randomUUID();

    const oc: Partial<Ctx> = {};

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      oc.pool = pool;
      oc.db = createKysely(pool);
      const db = oc.db;
      await db
        .insertInto('tenants')
        .values([
          { id: O_TA, name: `o-a-${O_TA.slice(0, 8)}`, slug: `o-a-${O_TA.slice(0, 8)}` },
          { id: O_TB, name: `o-b-${O_TB.slice(0, 8)}`, slug: `o-b-${O_TB.slice(0, 8)}` },
        ])
        .execute();
      // store_date trigger tenant_settings.business_day_cutoff_hour okur.
      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: O_TA }, { tenant_id: O_TB }])
        .execute();
      const now = new Date();
      await db
        .insertInto('orders')
        .values([
          {
            id: ORDER_A,
            tenant_id: O_TA,
            table_id: null,
            customer_id: null,
            order_type: 'dine_in',
            takeaway_stage: null,
            status: 'open',
            order_no: 9001,
            total_cents: 1000,
            store_date: now,
            created_at: now,
            updated_at: now,
            waiter_user_id: null,
          },
          {
            id: ORDER_B,
            tenant_id: O_TB,
            table_id: null,
            customer_id: null,
            order_type: 'dine_in',
            takeaway_stage: null,
            status: 'open',
            order_no: 9002,
            total_cents: 2000,
            store_date: now,
            created_at: now,
            updated_at: now,
            waiter_user_id: null,
          },
        ])
        .execute();
    });

    afterAll(async () => {
      if (oc.db && oc.pool) {
        await oc.db.deleteFrom('orders').where('tenant_id', 'in', [O_TA, O_TB]).execute();
        await oc.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', 'in', [O_TA, O_TB])
          .execute();
        await oc.db.deleteFrom('tenants').where('id', 'in', [O_TA, O_TB]).execute();
        await oc.pool.end();
      }
    });

    it('orders: A context içinde app_tenant yalnız A siparişini görür, B görünmez', async () => {
      const db = oc.db!;
      const seen = await withTenant(db, O_TA, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`select id from orders`.execute(trx);
        return res.rows.map((r) => r.id);
      });
      expect(seen).toContain(ORDER_A);
      expect(seen).not.toContain(ORDER_B);
    });

    it('orders: B context içinde yalnız B siparişini görür, A görünmez', async () => {
      const db = oc.db!;
      const seen = await withTenant(db, O_TB, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`select id from orders`.execute(trx);
        return res.rows.map((r) => r.id);
      });
      expect(seen).toContain(ORDER_B);
      expect(seen).not.toContain(ORDER_A);
    });

    it('orders: B context içinde A siparişine UPDATE 0 satır etkiler (policy USING)', async () => {
      const db = oc.db!;
      const affected = await withTenant(db, O_TB, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`
          update orders set total_cents = 5 where id = ${ORDER_A} returning id
        `.execute(trx);
        return res.rows.length;
      });
      expect(affected).toBe(0);
    });

    it('orders: A context içinde B tenant_id ile INSERT WITH CHECK ihlali (reddedilir)', async () => {
      const db = oc.db!;
      await expect(
        withTenant(db, O_TA, async (trx) => {
          await sql`set local role app_tenant`.execute(trx);
          await sql`
            insert into orders
              (id, tenant_id, order_type, status, order_no, total_cents, store_date, created_at, updated_at)
            values
              (${randomUUID()}, ${O_TB}, 'dine_in', 'open', 9999, 100, now(), now(), now())
          `.execute(trx);
        }),
      ).rejects.toThrow();
    });

    it('fail-closed: boş context + app_tenant → orders sıfır satır', async () => {
      const db = oc.db!;
      const n = await db.transaction().execute(async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ n: number }>`
          select count(*)::int as n from orders
        `.execute(trx);
        return res.rows[0]?.n ?? -1;
      });
      expect(n).toBe(0);
    });
  },
);

/**
 * ADR-041 F4a — order-family children + call_logs cross-tenant izolasyon matrisi.
 *
 * order_item_attributes/order_item_batches izolasyonu orders entegrasyon suite'i
 * (app_tenant harness) ile uçtan uca doğrulanır (F3b/F3c order_items/payments
 * deseni); burada standalone iki tablo — call_logs (yeni withTenant sarımlı) +
 * order_no_counters — DB-düzeyi matrisle kanıtlanır. Ön-koşul: migration 058
 * (ENABLE+FORCE+policy) pos_test'te koşmuş olmalı. Seed süperuser (BYPASSRLS);
 * izolasyon yalnız app_tenant (NOBYPASSRLS) + withTenant context altında beklenir.
 */
describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-041 F4a — order-children + call_logs RLS izolasyonu',
  () => {
    const F_TA = randomUUID();
    const F_TB = randomUUID();
    const CALL_A = randomUUID();
    const CALL_B = randomUUID();
    const BIZ_DATE = '2026-01-15';

    const fc: Partial<Ctx> = {};

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      fc.pool = pool;
      fc.db = createKysely(pool);
      const db = fc.db;
      await db
        .insertInto('tenants')
        .values([
          { id: F_TA, name: `f-a-${F_TA.slice(0, 8)}`, slug: `f-a-${F_TA.slice(0, 8)}` },
          { id: F_TB, name: `f-b-${F_TB.slice(0, 8)}`, slug: `f-b-${F_TB.slice(0, 8)}` },
        ])
        .execute();
      await db
        .insertInto('call_logs')
        .values([
          { id: CALL_A, tenant_id: F_TA, raw_phone: '05001112233', normalized_phone: '05001112233', status: 'ringing' },
          { id: CALL_B, tenant_id: F_TB, raw_phone: '05004445566', normalized_phone: '05004445566', status: 'ringing' },
        ])
        .execute();
      await db
        .insertInto('order_no_counters')
        .values([
          { tenant_id: F_TA, business_date: BIZ_DATE, last_no: 5 },
          { tenant_id: F_TB, business_date: BIZ_DATE, last_no: 7 },
        ])
        .execute();
    });

    afterAll(async () => {
      if (fc.db && fc.pool) {
        await fc.db.deleteFrom('call_logs').where('tenant_id', 'in', [F_TA, F_TB]).execute();
        await fc.db.deleteFrom('order_no_counters').where('tenant_id', 'in', [F_TA, F_TB]).execute();
        await fc.db.deleteFrom('tenants').where('id', 'in', [F_TA, F_TB]).execute();
        await fc.pool.end();
      }
    });

    it('call_logs: A context yalnız A satırını görür, B görünmez', async () => {
      const db = fc.db!;
      const seen = await withTenant(db, F_TA, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`select id from call_logs`.execute(trx);
        return res.rows.map((r) => r.id);
      });
      expect(seen).toContain(CALL_A);
      expect(seen).not.toContain(CALL_B);
    });

    it('call_logs: B context içinde A satırına UPDATE 0 satır (policy USING)', async () => {
      const db = fc.db!;
      const affected = await withTenant(db, F_TB, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`
          update call_logs set status = 'dismissed' where id = ${CALL_A} returning id
        `.execute(trx);
        return res.rows.length;
      });
      expect(affected).toBe(0);
    });

    it('call_logs: A context içinde B tenant_id ile INSERT WITH CHECK ihlali (reddedilir)', async () => {
      const db = fc.db!;
      await expect(
        withTenant(db, F_TA, async (trx) => {
          await sql`set local role app_tenant`.execute(trx);
          await sql`
            insert into call_logs (id, tenant_id, normalized_phone, status)
            values (${randomUUID()}, ${F_TB}, '05009998877', 'ringing')
          `.execute(trx);
        }),
      ).rejects.toThrow();
    });

    it('call_logs: fail-closed — boş context + app_tenant → sıfır satır', async () => {
      const db = fc.db!;
      const n = await db.transaction().execute(async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ n: number }>`select count(*)::int as n from call_logs`.execute(trx);
        return res.rows[0]?.n ?? -1;
      });
      expect(n).toBe(0);
    });

    it('order_no_counters: A context yalnız A sayacını görür, B görünmez', async () => {
      const db = fc.db!;
      const seen = await withTenant(db, F_TA, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ tenant_id: string }>`select tenant_id from order_no_counters`.execute(trx);
        return res.rows.map((r) => r.tenant_id);
      });
      expect(seen).toContain(F_TA);
      expect(seen).not.toContain(F_TB);
    });

    it('order_no_counters: B context içinde A sayacına UPDATE 0 satır (policy USING)', async () => {
      const db = fc.db!;
      const affected = await withTenant(db, F_TB, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ tenant_id: string }>`
          update order_no_counters set last_no = 99
          where tenant_id = ${F_TA}::uuid and business_date = ${BIZ_DATE}::date
          returning tenant_id
        `.execute(trx);
        return res.rows.length;
      });
      expect(affected).toBe(0);
    });

    it('order_no_counters: A context içinde B tenant_id ile INSERT WITH CHECK ihlali', async () => {
      const db = fc.db!;
      await expect(
        withTenant(db, F_TA, async (trx) => {
          await sql`set local role app_tenant`.execute(trx);
          await sql`
            insert into order_no_counters (tenant_id, business_date, last_no)
            values (${F_TB}::uuid, '2026-02-01'::date, 1)
          `.execute(trx);
        }),
      ).rejects.toThrow();
    });

    it('order_no_counters: fail-closed — boş context + app_tenant → sıfır satır', async () => {
      const db = fc.db!;
      const n = await db.transaction().execute(async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ n: number }>`select count(*)::int as n from order_no_counters`.execute(trx);
        return res.rows[0]?.n ?? -1;
      });
      expect(n).toBe(0);
    });
  },
);

/**
 * ADR-041 F4b — menü/katalog cross-tenant izolasyon matrisi (products + categories).
 *
 * F4b'nin 7 tablosunun tamamı route-seviyesi entegrasyon suite'lerinde (app_tenant
 * harness) egzersiz edilir (products.test.ts, menu.test.ts, orders-attributes.test.ts);
 * burada iki temsilci tablo — products (FK'li) + categories (parent) — DB-düzeyi
 * matrisle kanıtlanır. Ön-koşul: migration 059. Seed süperuser (BYPASSRLS).
 */
describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-041 F4b — menu/catalog RLS izolasyonu (products + categories)',
  () => {
    const M_TA = randomUUID();
    const M_TB = randomUUID();
    const CAT_A = randomUUID();
    const CAT_B = randomUUID();
    const PROD_A = randomUUID();
    const PROD_B = randomUUID();
    const AG_A = randomUUID();
    const AG_B = randomUUID();
    const AO_A = randomUUID();
    const AO_B = randomUUID();

    const mc: Partial<Ctx> = {};

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      mc.pool = pool;
      mc.db = createKysely(pool);
      const db = mc.db;
      await db
        .insertInto('tenants')
        .values([
          { id: M_TA, name: `m-a-${M_TA.slice(0, 8)}`, slug: `m-a-${M_TA.slice(0, 8)}` },
          { id: M_TB, name: `m-b-${M_TB.slice(0, 8)}`, slug: `m-b-${M_TB.slice(0, 8)}` },
        ])
        .execute();
      await db
        .insertInto('categories')
        .values([
          { id: CAT_A, tenant_id: M_TA, name: 'Kategori A' },
          { id: CAT_B, tenant_id: M_TB, name: 'Kategori B' },
        ])
        .execute();
      await db
        .insertInto('products')
        .values([
          { id: PROD_A, tenant_id: M_TA, category_id: CAT_A, name: 'Ürün A', price_cents: 1000 },
          { id: PROD_B, tenant_id: M_TB, category_id: CAT_B, name: 'Ürün B', price_cents: 2000 },
        ])
        .execute();
      await db
        .insertInto('attribute_groups')
        .values([
          { id: AG_A, tenant_id: M_TA, name: 'Grup A', selection_type: 'single' },
          { id: AG_B, tenant_id: M_TB, name: 'Grup B', selection_type: 'single' },
        ])
        .execute();
      await db
        .insertInto('attribute_options')
        .values([
          { id: AO_A, tenant_id: M_TA, group_id: AG_A, name: 'Seçenek A' },
          { id: AO_B, tenant_id: M_TB, group_id: AG_B, name: 'Seçenek B' },
        ])
        .execute();
    });

    afterAll(async () => {
      if (mc.db && mc.pool) {
        await mc.db.deleteFrom('attribute_options').where('tenant_id', 'in', [M_TA, M_TB]).execute();
        await mc.db.deleteFrom('attribute_groups').where('tenant_id', 'in', [M_TA, M_TB]).execute();
        await mc.db.deleteFrom('products').where('tenant_id', 'in', [M_TA, M_TB]).execute();
        await mc.db.deleteFrom('categories').where('tenant_id', 'in', [M_TA, M_TB]).execute();
        await mc.db.deleteFrom('tenants').where('id', 'in', [M_TA, M_TB]).execute();
        await mc.pool.end();
      }
    });

    it('products: A context yalnız A ürününü görür, B görünmez', async () => {
      const db = mc.db!;
      const seen = await withTenant(db, M_TA, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`select id from products`.execute(trx);
        return res.rows.map((r) => r.id);
      });
      expect(seen).toContain(PROD_A);
      expect(seen).not.toContain(PROD_B);
    });

    it('products: B context içinde A ürününe UPDATE 0 satır (policy USING)', async () => {
      const db = mc.db!;
      const affected = await withTenant(db, M_TB, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`
          update products set price_cents = 5 where id = ${PROD_A}::uuid returning id
        `.execute(trx);
        return res.rows.length;
      });
      expect(affected).toBe(0);
    });

    it('products: A context içinde B tenant_id ile INSERT WITH CHECK ihlali', async () => {
      const db = mc.db!;
      await expect(
        withTenant(db, M_TA, async (trx) => {
          await sql`set local role app_tenant`.execute(trx);
          await sql`
            insert into products (id, tenant_id, category_id, name, price_cents)
            values (${randomUUID()}::uuid, ${M_TB}::uuid, ${CAT_B}::uuid, 'HACK', 1)
          `.execute(trx);
        }),
      ).rejects.toThrow();
    });

    it('categories: A context yalnız A kategorisini görür, B görünmez', async () => {
      const db = mc.db!;
      const seen = await withTenant(db, M_TA, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`select id from categories`.execute(trx);
        return res.rows.map((r) => r.id);
      });
      expect(seen).toContain(CAT_A);
      expect(seen).not.toContain(CAT_B);
    });

    it('categories: B context içinde A kategorisine UPDATE 0 satır (policy USING)', async () => {
      const db = mc.db!;
      const affected = await withTenant(db, M_TB, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`
          update categories set name = 'HACK' where id = ${CAT_A}::uuid returning id
        `.execute(trx);
        return res.rows.length;
      });
      expect(affected).toBe(0);
    });

    it('categories: A context içinde B tenant_id ile INSERT WITH CHECK ihlali', async () => {
      const db = mc.db!;
      await expect(
        withTenant(db, M_TA, async (trx) => {
          await sql`set local role app_tenant`.execute(trx);
          await sql`
            insert into categories (id, tenant_id, name)
            values (${randomUUID()}::uuid, ${M_TB}::uuid, 'HACK')
          `.execute(trx);
        }),
      ).rejects.toThrow();
    });

    it('attribute_groups: A context yalnız A grubunu görür, B görünmez', async () => {
      const db = mc.db!;
      const seen = await withTenant(db, M_TA, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`select id from attribute_groups`.execute(trx);
        return res.rows.map((r) => r.id);
      });
      expect(seen).toContain(AG_A);
      expect(seen).not.toContain(AG_B);
    });

    it('attribute_options: A context yalnız A seçeneğini görür, B görünmez', async () => {
      const db = mc.db!;
      const seen = await withTenant(db, M_TA, async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const res = await sql<{ id: string }>`select id from attribute_options`.execute(trx);
        return res.rows.map((r) => r.id);
      });
      expect(seen).toContain(AO_A);
      expect(seen).not.toContain(AO_B);
    });

    it('menü/katalog 4 tablo: fail-closed — boş context + app_tenant → sıfır satır', async () => {
      const db = mc.db!;
      const counts = await db.transaction().execute(async (trx) => {
        await sql`set local role app_tenant`.execute(trx);
        const p = await sql<{ n: number }>`select count(*)::int as n from products`.execute(trx);
        const c = await sql<{ n: number }>`select count(*)::int as n from categories`.execute(trx);
        const ag = await sql<{ n: number }>`select count(*)::int as n from attribute_groups`.execute(trx);
        const ao = await sql<{ n: number }>`select count(*)::int as n from attribute_options`.execute(trx);
        return {
          products: p.rows[0]?.n ?? -1,
          categories: c.rows[0]?.n ?? -1,
          attribute_groups: ag.rows[0]?.n ?? -1,
          attribute_options: ao.rows[0]?.n ?? -1,
        };
      });
      expect(counts.products).toBe(0);
      expect(counts.categories).toBe(0);
      expect(counts.attribute_groups).toBe(0);
      expect(counts.attribute_options).toBe(0);
    });
  },
);
