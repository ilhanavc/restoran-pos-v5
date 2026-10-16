import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, createKysely, withTenant, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import { createAppTenantPool } from './helpers/appTenantPool';
import {
  seedDemoTenant,
  LiveTenantBarrierError,
} from '../../scripts/seed-demo-tenant';

/**
 * ADR-043 — demo tenant tohumlama script'inin davranış testleri.
 *
 * Üç şeyi kilitler:
 *   1. 🔴 **K5 bariyeri** — hedef, canlı tenant ise script HİÇ YAZMADAN reddeder.
 *   2. **İdempotency** — ikinci koşum satır sayısını değiştirmez (K4.3; demo
 *      verisini tazelemenin tek yolu yeniden koşmak olduğu için bu şart).
 *   3. **Çapraz-tenant izolasyon** — `app_tenant` rolü altında, yani RLS
 *      gerçekten ısırırken.
 *
 * ⚠️ İzolasyon iddiası **sessiz-0 tuzağına** açıktır: yanlış/eksik tenant
 * context'i de 0 satır döndürür ([[feedback_verify_role_switch_with_current_user]]).
 * Bu yüzden her "karşı tenant 0 satır" iddiasının yanında **kendi tenant'ının
 * satır sayısı > 0** akıl sağlığı kontrolü var — ikisi birlikte kanıttır.
 */

const DB_URL = process.env['DATABASE_URL'];

const LIVE_TENANT_ID = randomUUID();
const DEMO_TENANT_ID = randomUUID();
const LIVE_SLUG = `live-${randomUUID().slice(0, 8)}`;
const DEMO_SLUG = `demo-${randomUUID().slice(0, 8)}`;

/** Canlı tenant'ta duran, demo tohumlamasının ASLA görmemesi gereken ürün. */
const LIVE_ONLY_PRODUCT = 'Canli Tenant Urunu';

interface TestCtx {
  pool: Pool;
  appPool: Pool;
  db: Kysely<DB>;
  appDb: Kysely<DB>;
}

const ctx: Partial<TestCtx> = {};

/**
 * ⚠️ `tenant_id` AÇIKÇA filtrelenir — yalnız `withTenant` context'ine
 * güvenilmez. Bu helper fixture pool'uyla (postgres **superuser**) da
 * çağrılıyor ve superuser RLS'i **bypass** eder: context ayarlansa bile satır
 * süzülmez, sayı GLOBAL olur. İlk hâli böyleydi ve "tenant başına" sandığım
 * sayılar aslında tüm tenant'ları topluyordu (dry-run testi 0 yerine 16 gördü).
 * [[feedback_rls_test_harness_app_tenant_role]]
 */
async function countIn(
  db: Kysely<DB>,
  tenantId: string,
  table: 'areas' | 'tables' | 'categories' | 'products' | 'users',
): Promise<number> {
  const row = await withTenant(db, tenantId, async (trx) =>
    trx
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as('c'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow(),
  );
  return Number(row.c);
}

describe.skipIf(DB_URL === undefined)('seed-demo-tenant (ADR-043)', () => {
  beforeAll(async () => {
    const url = DB_URL as string;
    ctx.pool = createPool({ connectionString: url });
    ctx.db = createKysely(ctx.pool);
    ctx.appPool = createAppTenantPool(url);
    ctx.appDb = createKysely(ctx.appPool);

    const db = ctx.db;

    // İki tenant: biri "canlı" (bariyerin koruyacağı), biri demo.
    await db
      .insertInto('tenants')
      .values([
        { id: LIVE_TENANT_ID, name: 'Canli Restoran', slug: LIVE_SLUG },
        { id: DEMO_TENANT_ID, name: 'Demo Restoran', slug: DEMO_SLUG },
      ])
      .execute();

    // Canlı tenant'a bir kategori + ürün: izolasyonun karşı tarafı.
    const liveCategoryId = randomUUID();
    await db
      .insertInto('categories')
      .values({
        id: liveCategoryId,
        tenant_id: LIVE_TENANT_ID,
        name: 'Canli Kategori',
      })
      .execute();
    await db
      .insertInto('products')
      .values({
        id: randomUUID(),
        tenant_id: LIVE_TENANT_ID,
        category_id: liveCategoryId,
        name: LIVE_ONLY_PRODUCT,
        price_cents: 12_345,
      })
      .execute();
  });

  afterAll(async () => {
    const db = ctx.db;
    if (db !== undefined) {
      const ids = [LIVE_TENANT_ID, DEMO_TENANT_ID];
      // FK zinciri: ürün → kategori, masa → bölge. Çocuklar önce
      // ([[feedback_cross_fk_test_cleanup_chain]] — 23503 tuzağı).
      await db.deleteFrom('products').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('categories').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('tables').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('areas').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('users').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('tenants').where('id', 'in', ids).execute();
      await db.destroy();
    }
    if (ctx.appDb !== undefined) await ctx.appDb.destroy();
  });

  it('🔴 K5: hedef CANLI tenant ise reddeder ve HİÇBİR ŞEY yazmaz', async () => {
    const db = ctx.db as Kysely<DB>;

    const before = {
      areas: await countIn(db, LIVE_TENANT_ID, 'areas'),
      tables: await countIn(db, LIVE_TENANT_ID, 'tables'),
      categories: await countIn(db, LIVE_TENANT_ID, 'categories'),
      products: await countIn(db, LIVE_TENANT_ID, 'products'),
      users: await countIn(db, LIVE_TENANT_ID, 'users'),
    };

    await expect(
      seedDemoTenant(db, {
        slug: LIVE_SLUG,
        waiterUsername: 'demo-garson',
        dryRun: false,
        waiterPassword: 'demopass1234',
        liveTenantId: LIVE_TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(LiveTenantBarrierError);

    const after = {
      areas: await countIn(db, LIVE_TENANT_ID, 'areas'),
      tables: await countIn(db, LIVE_TENANT_ID, 'tables'),
      categories: await countIn(db, LIVE_TENANT_ID, 'categories'),
      products: await countIn(db, LIVE_TENANT_ID, 'products'),
      users: await countIn(db, LIVE_TENANT_ID, 'users'),
    };

    // "Hata fırlattı" yetmez — yazmadığı SAYILARAK kanıtlanır.
    expect(after).toEqual(before);
    // Akıl sağlığı: canlı tenant'ın kendi verisi hâlâ yerinde (sayaç çalışıyor).
    expect(before.products).toBeGreaterThan(0);
  });

  it('demo tenantı tohumlar: bölge, masa, kategori, ürün, waiter', async () => {
    const db = ctx.db as Kysely<DB>;

    const result = await seedDemoTenant(db, {
      slug: DEMO_SLUG,
      waiterUsername: 'demo-garson',
      dryRun: false,
      waiterPassword: 'demopass1234',
      liveTenantId: LIVE_TENANT_ID,
    });

    expect(result.tenantId).toBe(DEMO_TENANT_ID);
    expect(result.created.areas).toBe(2);
    expect(result.created.tables).toBe(10);
    expect(result.created.categories).toBe(4);
    expect(result.created.products).toBe(15);
    expect(result.created.waiter).toBe(true);

    // Ürün kategoriye bağlı olmak ZORUNDA (products.category_id NOT NULL).
    const orphan = await withTenant(db, DEMO_TENANT_ID, async (trx) =>
      trx
        .selectFrom('products')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('category_id', 'is', null)
        .executeTakeFirstOrThrow(),
    );
    expect(Number(orphan.c)).toBe(0);
  });

  it('idempotent: ikinci koşum hiçbir satır eklemez', async () => {
    const db = ctx.db as Kysely<DB>;

    const before = {
      areas: await countIn(db, DEMO_TENANT_ID, 'areas'),
      tables: await countIn(db, DEMO_TENANT_ID, 'tables'),
      categories: await countIn(db, DEMO_TENANT_ID, 'categories'),
      products: await countIn(db, DEMO_TENANT_ID, 'products'),
      users: await countIn(db, DEMO_TENANT_ID, 'users'),
    };

    const result = await seedDemoTenant(db, {
      slug: DEMO_SLUG,
      waiterUsername: 'demo-garson',
      dryRun: false,
      waiterPassword: 'demopass1234',
      liveTenantId: LIVE_TENANT_ID,
    });

    expect(result.created).toEqual({
      areas: 0,
      tables: 0,
      categories: 0,
      products: 0,
      waiter: false,
    });

    const after = {
      areas: await countIn(db, DEMO_TENANT_ID, 'areas'),
      tables: await countIn(db, DEMO_TENANT_ID, 'tables'),
      categories: await countIn(db, DEMO_TENANT_ID, 'categories'),
      products: await countIn(db, DEMO_TENANT_ID, 'products'),
      users: await countIn(db, DEMO_TENANT_ID, 'users'),
    };
    expect(after).toEqual(before);
  });

  it('çapraz-tenant izolasyon: app_tenant altında, sessiz-0 kontrolüyle', async () => {
    const appDb = ctx.appDb as Kysely<DB>;

    // Demo context'i: kendi ürünleri görünür (akıl sağlığı), canlının ürünü YOK.
    // ⚠️ Burada `tenant_id` filtresi BİLEREK YOK — süzmeyi RLS'in yaptığını
    // göstermek istiyoruz, WHERE'in değil. `app_tenant` NOBYPASSRLS'tir.
    const demoOwnRow = await withTenant(appDb, DEMO_TENANT_ID, async (trx) =>
      trx
        .selectFrom('products')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .executeTakeFirstOrThrow(),
    );
    const demoOwn = Number(demoOwnRow.c);
    expect(demoOwn).toBe(15); // > 0 → context gerçekten çalışıyor, 0 "sessiz" değil

    const demoSeesLive = await withTenant(appDb, DEMO_TENANT_ID, async (trx) =>
      trx
        .selectFrom('products')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('name', '=', LIVE_ONLY_PRODUCT)
        .executeTakeFirstOrThrow(),
    );
    expect(Number(demoSeesLive.c)).toBe(0);

    // Ters yön: canlı context'i kendi ürününü görür, demo ürünlerini görmez.
    const liveOwn = await withTenant(appDb, LIVE_TENANT_ID, async (trx) =>
      trx
        .selectFrom('products')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('name', '=', LIVE_ONLY_PRODUCT)
        .executeTakeFirstOrThrow(),
    );
    expect(Number(liveOwn.c)).toBe(1); // akıl sağlığı

    const liveSeesDemo = await withTenant(appDb, LIVE_TENANT_ID, async (trx) =>
      trx
        .selectFrom('products')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('name', '=', 'Karışık Pide')
        .executeTakeFirstOrThrow(),
    );
    expect(Number(liveSeesDemo.c)).toBe(0);
  });

  it('dry-run hiçbir şey yazmaz', async () => {
    const db = ctx.db as Kysely<DB>;
    const freshSlug = `dry-${randomUUID().slice(0, 8)}`;
    const freshId = randomUUID();
    await db
      .insertInto('tenants')
      .values({ id: freshId, name: 'Dry Run', slug: freshSlug })
      .execute();

    try {
      const result = await seedDemoTenant(db, {
        slug: freshSlug,
        waiterUsername: 'demo-garson',
        dryRun: true,
        waiterPassword: 'demopass1234',
        liveTenantId: LIVE_TENANT_ID,
      });

      // Rapor "yaratılacaktı" der…
      expect(result.created.products).toBe(15);
      // …ama DB'de hiçbir şey yok.
      expect(await countIn(db, freshId, 'products')).toBe(0);
      expect(await countIn(db, freshId, 'areas')).toBe(0);
    } finally {
      await db.deleteFrom('products').where('tenant_id', '=', freshId).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', freshId).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', freshId).execute();
      await db.deleteFrom('areas').where('tenant_id', '=', freshId).execute();
      await db.deleteFrom('users').where('tenant_id', '=', freshId).execute();
      await db.deleteFrom('tenants').where('id', '=', freshId).execute();
    }
  });
});
