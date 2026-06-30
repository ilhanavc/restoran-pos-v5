/**
 * Dev seed script — lokal geliştirme ortamı için.
 *
 * Idempotent: aynı sabit UUID'lerle INSERT ... ON CONFLICT DO NOTHING.
 * 4-guard pattern (ADR-003): NODE_ENV=production iken ALLOW_SEED=true gerekir.
 *
 * Çalıştırma: pnpm --filter @restoran-pos/db seed
 *
 * UYARI: admin1234 şifresi YALNIZ dev ortamı içindir, prod'a kesinlikle gitmez.
 */

// === GUARD: production'da ALLOW_SEED olmadan çalışmaz ===
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
  console.error('[seed] blocked: NODE_ENV=production and ALLOW_SEED!==true');
  process.exit(1);
}

// ESM-CJS interop: bcryptjs paket "exports" field tanımlamadığı için
// "type": "module" altında explicit dosya yolu gerekiyor.
import bcrypt from 'bcryptjs/index.js';
import { createPool } from './connection.js';
import { createKysely } from './kysely.js';

// === SABİT UUID'ler (idempotency için) ===
const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const ADMIN_USER_ID = '00000000-0000-7000-8000-000000000002';
// Garson kullanıcı — mobil garson app (Phase 4) gerçek-API girişi için. Mobil
// uygulama yalnız 'waiter' rolüyle test edilir (ABAC, ADR-025 K4). Dev-only.
const WAITER_USER_ID = '00000000-0000-7000-8000-000000000003';

const TABLE_IDS = [
  '00000000-0000-7000-8000-00000000001a',
  '00000000-0000-7000-8000-00000000001b',
  '00000000-0000-7000-8000-00000000001c',
  '00000000-0000-7000-8000-00000000001d',
  '00000000-0000-7000-8000-00000000001e',
] as const;

const CATEGORY_FOOD_ID = '00000000-0000-7000-8000-000000000021';
const CATEGORY_DRINK_ID = '00000000-0000-7000-8000-000000000022';
const CATEGORY_DESSERT_ID = '00000000-0000-7000-8000-000000000023';

const AREA_INSIDE_ID = '00000000-0000-7000-8000-000000000041';
const AREA_GARDEN_ID = '00000000-0000-7000-8000-000000000042';

interface SeedProduct {
  id: string;
  category_id: string;
  name: string;
  price_cents: number;
}

const PRODUCTS: readonly SeedProduct[] = [
  { id: '00000000-0000-7000-8000-000000000031', category_id: CATEGORY_FOOD_ID, name: 'Karışık Pide', price_cents: 15000 },
  { id: '00000000-0000-7000-8000-000000000032', category_id: CATEGORY_FOOD_ID, name: 'Mercimek Çorbası', price_cents: 8000 },
  { id: '00000000-0000-7000-8000-000000000033', category_id: CATEGORY_FOOD_ID, name: 'Adana Kebap', price_cents: 22000 },
  { id: '00000000-0000-7000-8000-000000000034', category_id: CATEGORY_DRINK_ID, name: 'Ayran', price_cents: 3500 },
  { id: '00000000-0000-7000-8000-000000000035', category_id: CATEGORY_DESSERT_ID, name: 'Sütlaç', price_cents: 6500 },
] as const;

interface SeedCounts {
  tenants: number;
  tenant_settings: number;
  users: number;
  tables: number;
  categories: number;
  products: number;
  areas: number;
}

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[seed] missing env: set MIGRATOR_DATABASE_URL or DATABASE_URL');
    process.exit(1);
  }

  const pool = createPool({ connectionString });
  const db = createKysely(pool);

  // bcrypt cost 12 — apps/api ile aynı (BCRYPT_COST default).
  const adminPasswordHash = await bcrypt.hash('admin1234', 12);
  const waiterPasswordHash = await bcrypt.hash('garson1234', 12);

  const counts: SeedCounts = {
    tenants: 0,
    tenant_settings: 0,
    users: 0,
    tables: 0,
    categories: 0,
    products: 0,
    areas: 0,
  };

  try {
    await db.transaction().execute(async (trx) => {
      // 1) tenants
      const tenantInsert = await trx
        .insertInto('tenants')
        .values({ id: TENANT_ID, name: 'Demo Restoran', slug: 'demo-restoran' })
        .onConflict((oc) => oc.column('id').doNothing())
        .executeTakeFirst();
      counts.tenants = Number(tenantInsert.numInsertedOrUpdatedRows ?? 0n);

      // 2) tenant_settings (orders trigger gereksinimi — Phase 2 hazırlığı)
      const settingsInsert = await trx
        .insertInto('tenant_settings')
        .values({
          tenant_id: TENANT_ID,
          timezone: 'Europe/Istanbul',
        })
        .onConflict((oc) => oc.column('tenant_id').doNothing())
        .executeTakeFirst();
      counts.tenant_settings = Number(settingsInsert.numInsertedOrUpdatedRows ?? 0n);

      // 3) admin user
      const userInsert = await trx
        .insertInto('users')
        .values({
          id: ADMIN_USER_ID,
          tenant_id: TENANT_ID,
          role: 'admin',
          username: 'admin',
          email: 'admin@local.test',
          password_hash: adminPasswordHash,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .executeTakeFirst();
      counts.users += Number(userInsert.numInsertedOrUpdatedRows ?? 0n);

      // 3.5) waiter user — mobil garson app girişi (garson@local.test / garson1234).
      const waiterInsert = await trx
        .insertInto('users')
        .values({
          id: WAITER_USER_ID,
          tenant_id: TENANT_ID,
          role: 'waiter',
          username: 'garson',
          email: 'garson@local.test',
          password_hash: waiterPasswordHash,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .executeTakeFirst();
      counts.users += Number(waiterInsert.numInsertedOrUpdatedRows ?? 0n);

      // 4) areas (Sprint 8b — Salon bölgeleri, ADR-009)
      // Tables INSERT öncesi yazılır ki table.area_id (composite FK) sağlanabilsin.
      // v3 paritesi: 2. area uppercase ("BAHÇE") — admin user-input pattern.
      const areas = [
        { id: AREA_INSIDE_ID, name: 'İç Salon', sort_order: 1 },
        { id: AREA_GARDEN_ID, name: 'BAHÇE', sort_order: 2 },
      ] as const;
      for (const area of areas) {
        const areaInsert = await trx
          .insertInto('areas')
          .values({
            id: area.id,
            tenant_id: TENANT_ID,
            name: area.name,
            sort_order: area.sort_order,
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .executeTakeFirst();
        counts.areas += Number(areaInsert.numInsertedOrUpdatedRows ?? 0n);
      }

      // 4.5) tables (code = "MASA 1".."MASA 5") — Sprint 8c: ilk 3 İç Salon,
      // son 2 BAHÇE (sadece YENİ insert için; mevcut DB rows için tek-seferlik
      // UPDATE ayrıca). Idempotent: ON CONFLICT DO NOTHING.
      for (let i = 0; i < TABLE_IDS.length; i++) {
        const tableId = TABLE_IDS[i];
        if (tableId === undefined) continue; // noUncheckedIndexedAccess
        const code = `MASA ${i + 1}`;
        const areaId = i < 3 ? AREA_INSIDE_ID : AREA_GARDEN_ID;
        // ADR-009 Amendment 2026-06-30 Karar A: kalıcı per-bölge display_no.
        // İç Salon (i 0..2) → 1,2,3; BAHÇE (i 3..4) → 1,2. Migration mevcut DB'leri
        // backfill etti; bu yalnız TAZE seed içindir (NULL → etiket code'a düşerdi).
        const displayNo = i < 3 ? i + 1 : i - 2;
        const tableInsert = await trx
          .insertInto('tables')
          .values({
            id: tableId,
            tenant_id: TENANT_ID,
            code,
            capacity: 4,
            area_id: areaId,
            display_no: displayNo,
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .executeTakeFirst();
        counts.tables += Number(tableInsert.numInsertedOrUpdatedRows ?? 0n);
      }

      // 5) categories
      const categories = [
        { id: CATEGORY_FOOD_ID, name: 'Yemek', sort_order: 1 },
        { id: CATEGORY_DRINK_ID, name: 'İçecek', sort_order: 2 },
        { id: CATEGORY_DESSERT_ID, name: 'Tatlı', sort_order: 3 },
      ] as const;

      for (const cat of categories) {
        const catInsert = await trx
          .insertInto('categories')
          .values({
            id: cat.id,
            tenant_id: TENANT_ID,
            name: cat.name,
            sort_order: cat.sort_order,
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .executeTakeFirst();
        counts.categories += Number(catInsert.numInsertedOrUpdatedRows ?? 0n);
      }

      // 6) products
      for (const product of PRODUCTS) {
        const productInsert = await trx
          .insertInto('products')
          .values({
            id: product.id,
            tenant_id: TENANT_ID,
            category_id: product.category_id,
            name: product.name,
            price_cents: product.price_cents,
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .executeTakeFirst();
        counts.products += Number(productInsert.numInsertedOrUpdatedRows ?? 0n);
      }
    });

    console.log(
      `[seed] tenants: ${counts.tenants} inserted, ` +
        `tenant_settings: ${counts.tenant_settings} inserted, ` +
        `users: ${counts.users} inserted, ` +
        `tables: ${counts.tables} inserted, ` +
        `areas: ${counts.areas} inserted, ` +
        `categories: ${counts.categories} inserted, ` +
        `products: ${counts.products} inserted`,
    );
    console.log('[seed] done.');
  } catch (err) {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  } finally {
    // Kysely.destroy() altta yatan pool'u zaten kapatıyor; ayrıca pool.end()
    // çağırmak "Called end on pool more than once" hatası verir.
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
