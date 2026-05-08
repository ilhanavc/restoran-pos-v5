/**
 * E2E DB seed (ADR-019 §3 + §3.1).
 *
 * Kysely direct: HTTP endpoint YOK, packages/db üzerinden doğrudan DB.
 * Idempotent: her global-setup'ta TRUNCATE + INSERT. Sabit UUID'ler.
 *
 * UYARI: TRUNCATE bütün e2e tablolarını siler. Üçlü guard:
 *  - NODE_ENV=production iken fail-fast
 *  - CI ≠ 'true' iken DB ismi pos_dev|pos_main ise fail-fast (geliştirici dev DB'si korunur)
 *  - Default DATABASE_URL → pos_e2e (lokal'da kazara dev DB'ye dokunulamaz)
 */

import bcrypt from 'bcryptjs/index.js';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  TEST_TENANT_ID,
  ADMIN_USER_ID,
  CASHIER_USER_ID,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  CASHIER_EMAIL,
  CASHIER_PASSWORD,
  CATEGORY_FOOD_ID,
  CATEGORY_DRINK_ID,
  PRODUCT_PIDE_ID,
  PRODUCT_AYRAN_ID,
  AREA_INSIDE_ID,
  TABLE_1_ID,
} from '../helpers/test-data';

/**
 * Tüm e2e veri setini sıfırlayıp yeniden yazar.
 * @param connectionString DB URL (test DB'si — production'da çağrılmaz)
 */
export async function truncateAndSeed(connectionString: string): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('[e2e/seed] NODE_ENV=production — fail-fast');
  }

  // ADR-019 §3.1: Lokal'da pos_dev'e truncate dev verisini siler.
  // CI'de postgres service container ephemeral (her job yeniden başlar) — reuse güvenli.
  const isCI = process.env['CI'] === 'true' || process.env['CI'] === '1';
  if (!isCI && /\/(pos_dev|pos_main)(\?|$)/.test(connectionString)) {
    throw new Error(
      '[e2e/seed] LOKAL koşum tespit edildi (CI≠true) ve DB ismi pos_dev|pos_main. ' +
        'Dev verisi silinmesin diye fail-fast. Çözüm: createdb pos_e2e + ' +
        'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pos_e2e. ' +
        'Talimat: apps/web/e2e/README.md',
    );
  }

  const pool = new Pool({ connectionString, max: 4 });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  try {
    // 1) TRUNCATE — yabancı anahtar zincirini bozmamak için CASCADE.
    //    ADR-019 §3: DB reuse, ama her run idempotent başlangıç.
    await sql`
      TRUNCATE TABLE
        payment_items,
        payments,
        order_item_attributes,
        order_items,
        orders,
        product_attribute_groups,
        category_attribute_groups,
        attribute_options,
        attribute_groups,
        products,
        categories,
        tables,
        areas,
        refresh_tokens,
        users,
        tenant_settings,
        tenants
      RESTART IDENTITY CASCADE
    `.execute(db);

    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const cashierHash = await bcrypt.hash(CASHIER_PASSWORD, 12);

    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('tenants')
        .values({
          id: TEST_TENANT_ID,
          name: 'E2E Test Restoran',
          slug: 'e2e-test',
        })
        .execute();

      await trx
        .insertInto('tenant_settings')
        .values({
          tenant_id: TEST_TENANT_ID,
          timezone: 'Europe/Istanbul',
        })
        .execute();

      await trx
        .insertInto('users')
        .values([
          {
            id: ADMIN_USER_ID,
            tenant_id: TEST_TENANT_ID,
            role: 'admin',
            username: 'e2e-admin',
            email: ADMIN_EMAIL,
            password_hash: adminHash,
          },
          {
            id: CASHIER_USER_ID,
            tenant_id: TEST_TENANT_ID,
            role: 'cashier',
            username: 'e2e-cashier',
            email: CASHIER_EMAIL,
            password_hash: cashierHash,
          },
        ])
        .execute();

      await trx
        .insertInto('areas')
        .values({
          id: AREA_INSIDE_ID,
          tenant_id: TEST_TENANT_ID,
          name: 'İç Salon',
          sort_order: 1,
        })
        .execute();

      await trx
        .insertInto('tables')
        .values({
          id: TABLE_1_ID,
          tenant_id: TEST_TENANT_ID,
          code: 'MASA 1',
          capacity: 4,
          area_id: AREA_INSIDE_ID,
        })
        .execute();

      await trx
        .insertInto('categories')
        .values([
          {
            id: CATEGORY_FOOD_ID,
            tenant_id: TEST_TENANT_ID,
            name: 'Yemek',
            sort_order: 1,
          },
          {
            id: CATEGORY_DRINK_ID,
            tenant_id: TEST_TENANT_ID,
            name: 'İçecek',
            sort_order: 2,
          },
        ])
        .execute();

      await trx
        .insertInto('products')
        .values([
          {
            id: PRODUCT_PIDE_ID,
            tenant_id: TEST_TENANT_ID,
            category_id: CATEGORY_FOOD_ID,
            name: 'Karışık Pide',
            price_cents: 15000,
          },
          {
            id: PRODUCT_AYRAN_ID,
            tenant_id: TEST_TENANT_ID,
            category_id: CATEGORY_DRINK_ID,
            name: 'Ayran',
            price_cents: 3500,
          },
        ])
        .execute();
    });
  } finally {
    await db.destroy();
  }
}
