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
  KITCHEN_USER_ID,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  CASHIER_EMAIL,
  CASHIER_PASSWORD,
  KITCHEN_EMAIL,
  KITCHEN_PASSWORD,
  CATEGORY_FOOD_ID,
  CATEGORY_DRINK_ID,
  PRODUCT_PIDE_ID,
  PRODUCT_AYRAN_ID,
  AREA_INSIDE_ID,
  TABLE_1_ID,
  TABLE_2_ID,
  TABLE_3_ID,
  TABLE_4_ID,
  ORDER_FULLY_PAID_ID,
  ORDER_PARTIALLY_PAID_ID,
  ORDER_UNPAID_ID,
  PAYMENT_FULL_ID,
  PAYMENT_PARTIAL_ID,
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
    const kitchenHash = await bcrypt.hash(KITCHEN_PASSWORD, 12);

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
          {
            // Sprint 12 PR-3d: KDS S6 smoke için kitchen rolü.
            id: KITCHEN_USER_ID,
            tenant_id: TEST_TENANT_ID,
            role: 'kitchen',
            username: 'e2e-kitchen',
            email: KITCHEN_EMAIL,
            password_hash: kitchenHash,
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
        // ADR-009 Amendment 2026-06-30 Karar A: display_no kalıcı per-bölge etiket
        // kaynağı. Fixture'da explicit verilir (migration backfill seed-sonrası
        // satırları atlar) → board/KDS/snapshot "Masa N" kanonik yolunu test eder.
        .values([
          {
            id: TABLE_1_ID,
            tenant_id: TEST_TENANT_ID,
            code: 'MASA 1',
            capacity: 4,
            area_id: AREA_INSIDE_ID,
            display_no: 1,
          },
          // Sprint 13 PR-3 (S7 Mod B) — 3 bağımsız masa, her senaryo için ayrı.
          {
            id: TABLE_2_ID,
            tenant_id: TEST_TENANT_ID,
            code: 'MASA 2',
            capacity: 4,
            area_id: AREA_INSIDE_ID,
            display_no: 2,
          },
          {
            id: TABLE_3_ID,
            tenant_id: TEST_TENANT_ID,
            code: 'MASA 3',
            capacity: 4,
            area_id: AREA_INSIDE_ID,
            display_no: 3,
          },
          {
            id: TABLE_4_ID,
            tenant_id: TEST_TENANT_ID,
            code: 'MASA 4',
            capacity: 4,
            area_id: AREA_INSIDE_ID,
            display_no: 4,
          },
        ])
        .execute();

      await trx
        .insertInto('categories')
        .values([
          {
            id: CATEGORY_FOOD_ID,
            tenant_id: TEST_TENANT_ID,
            name: 'Yemek',
            sort_order: 1,
            // Migration 034 default TRUE; explicit yazılır → semantik açık.
            kitchen_print: true,
          },
          {
            id: CATEGORY_DRINK_ID,
            tenant_id: TEST_TENANT_ID,
            name: 'İçecek',
            sort_order: 2,
            // İçecek bar/kasa hattı — KDS'e düşmez (ADR-020 K2).
            kitchen_print: false,
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

      // Sprint 13 PR-3 (S7 Mod B) — 3 bağımsız sipariş fixture'ı.
      //   ORDER_FULLY_PAID_ID  (TABLE_2): total=10000, payment=10000 ('full')
      //   ORDER_PARTIALLY_PAID (TABLE_3): total=10000, payment=5000 ('partial')
      //   ORDER_UNPAID         (TABLE_4): total=10000, payment yok
      // useSplitState backend'den sum çekip remaining hesaplar; isFullyPaid
      // sadece ilk order'da true olur.
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      const orderFixtures: Array<{ id: string; tableId: string; orderNo: number }> = [
        { id: ORDER_FULLY_PAID_ID, tableId: TABLE_2_ID, orderNo: 1001 },
        { id: ORDER_PARTIALLY_PAID_ID, tableId: TABLE_3_ID, orderNo: 1002 },
        { id: ORDER_UNPAID_ID, tableId: TABLE_4_ID, orderNo: 1003 },
      ];

      await trx
        .insertInto('orders')
        .values(
          orderFixtures.map((o) => ({
            id: o.id,
            tenant_id: TEST_TENANT_ID,
            table_id: o.tableId,
            order_type: 'dine_in' as const,
            status: 'open' as const,
            order_no: o.orderNo,
            total_cents: 10000,
            store_date: todayUtc,
          })),
        )
        .execute();

      // Her order'a 1 item: 1 × 10000 kuruş. Snapshot fields zorunlu (ADR-003 §7).
      await trx
        .insertInto('order_items')
        .values(
          orderFixtures.map((o, i) => ({
            id: `00000000-0000-7000-8000-000000000e0${i + 1}`,
            tenant_id: TEST_TENANT_ID,
            order_id: o.id,
            product_id: PRODUCT_PIDE_ID,
            product_name: 'Karışık Pide',
            category_name_snapshot: 'Yemek',
            unit_price_cents: 10000,
            quantity: 1,
            total_cents: 10000,
            status: 'new' as const,
          })),
        )
        .execute();

      // Senaryo 1 + 2 için payment satırları. Senaryo 3 (UNPAID) payment yok.
      // idempotency_key UUID kolonu (TS'de string ama PG'da uuid) — stabil UUID
      // verilir (run-to-run aynı, idempotent seed).
      await trx
        .insertInto('payments')
        .values([
          {
            id: PAYMENT_FULL_ID,
            tenant_id: TEST_TENANT_ID,
            order_id: ORDER_FULLY_PAID_ID,
            amount_cents: 10000,
            payment_type: 'cash',
            payment_scope: 'full',
            idempotency_key: '00000000-0000-7000-8000-000000000f01',
          },
          {
            id: PAYMENT_PARTIAL_ID,
            tenant_id: TEST_TENANT_ID,
            order_id: ORDER_PARTIALLY_PAID_ID,
            amount_cents: 5000,
            payment_type: 'cash',
            payment_scope: 'partial',
            idempotency_key: '00000000-0000-7000-8000-000000000f02',
          },
        ])
        .execute();
    });
  } finally {
    await db.destroy();
  }
}
