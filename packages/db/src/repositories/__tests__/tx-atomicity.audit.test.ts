import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createKysely,
  createPool,
  createOrdersRepository,
  createPaymentsRepository,
  createUsersRepository,
  type OrdersRepository,
  type PaymentsRepository,
} from '../../index.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated.js';

/**
 * Deep audit — Blok 3 / Hat C (packages/db). Multi-step repository writes
 * (orders.create + items, addItems recalc, payments void+reopen, order
 * merge, cancelOrder) must be atomic: either the whole set of statements
 * lands, or none of it does. All tests here are GREEN (they document
 * correct behavior); BLOCKER/HIGH gaps found during this audit live in
 * sibling `*.findings.test.ts` files (intentionally red).
 *
 * Runs ONLY against pos_test (DATABASE_URL env). Never touches pos_dev.
 */
const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Tx atomicity audit (Hat C)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let ordersRepo: OrdersRepository;
  let paymentsRepo: PaymentsRepository;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    pool = createPool({ connectionString: DB_URL as string });
    db = createKysely(pool);
    ordersRepo = createOrdersRepository(db);
    paymentsRepo = createPaymentsRepository(db);

    tenantId = randomUUID();
    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        name: 'QA3C Tx Atomicity',
        slug: `qa-3c-tx-atomicity-${tenantId.slice(0, 8)}`,
      })
      .execute();
    await db
      .insertInto('tenant_settings')
      .values({ tenant_id: tenantId })
      .execute();

    const usersRepo = createUsersRepository(db);
    userId = randomUUID();
    await usersRepo.create({
      id: userId,
      tenantId,
      email: `qa3c-tx-${userId}@example.com`,
      username: `qa3c-tx-${userId}`,
      passwordHash: '$2b$12$dummyhashfortestpurpose0000000000000000000000',
      role: 'cashier',
    });
  });

  afterAll(async () => {
    // FK-safe cleanup: children before parents (no CASCADE on most FKs here —
    // see feedback_cross_fk_test_cleanup_chain lesson).
    await db.deleteFrom('payment_items').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('payments').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('order_item_attributes').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('order_items').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('orders').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('order_no_counters').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tables').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('users').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenant_settings').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
    await db.destroy(); // PostgresDialect.destroy() closes the pool internally
  });

  async function makeTable(): Promise<string> {
    const id = randomUUID();
    await db
      .insertInto('tables')
      .values({ id, tenant_id: tenantId, code: `T-${id.slice(0, 6)}`, capacity: 4 })
      .execute();
    return id;
  }

  it('create() inserts order + items in one transaction; total_cents = SUM(items)', async () => {
    const tableId = await makeTable();
    const orderId = randomUUID();

    const order = await ordersRepo.create(
      tenantId,
      { id: orderId, tableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Karışık Pide',
          categoryNameSnapshot: 'Pideler',
          unitPriceCents: 15000,
          quantity: 1,
          totalCents: 15000,
          createdByUserId: null,
          createdByName: null,
        },
        {
          id: randomUUID(),
          productId: null,
          productName: 'Ayran',
          categoryNameSnapshot: 'İçecekler',
          unitPriceCents: 2000,
          quantity: 2,
          totalCents: 4000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );

    expect(order.total_cents).toBe(19000);
    const items = await db
      .selectFrom('order_items')
      .selectAll()
      .where('order_id', '=', orderId)
      .execute();
    expect(items).toHaveLength(2);
  });

  it('create() rolls back the order header when a nested item insert fails (duplicate item id)', async () => {
    const tableId = await makeTable();
    const orderId = randomUUID();
    const dupItemId = randomUUID();

    await expect(
      ordersRepo.create(
        tenantId,
        { id: orderId, tableId, orderType: 'dine_in', storeDate: new Date() },
        [
          {
            id: dupItemId,
            productId: null,
            productName: 'Lahmacun',
            categoryNameSnapshot: 'Pideler',
            unitPriceCents: 6000,
            quantity: 1,
            totalCents: 6000,
            createdByUserId: null,
            createdByName: null,
          },
          {
            // Same id as above — order_items PK violation mid-batch-insert.
            id: dupItemId,
            productId: null,
            productName: 'Künefe',
            categoryNameSnapshot: 'Tatlılar',
            unitPriceCents: 9000,
            quantity: 1,
            totalCents: 9000,
            createdByUserId: null,
            createdByName: null,
          },
        ],
      ),
    ).rejects.toBeTruthy();

    // Whole transaction must have rolled back — order header must NOT exist.
    const orderRow = await db
      .selectFrom('orders')
      .select('id')
      .where('id', '=', orderId)
      .executeTakeFirst();
    expect(orderRow).toBeUndefined();

    // Table must be free again (no orphaned occupied slot).
    const occupied = await db
      .selectFrom('orders')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('table_id', '=', tableId)
      .where('status', 'not in', ['paid', 'cancelled', 'void', 'merged'])
      .executeTakeFirst();
    expect(occupied).toBeUndefined();
  });

  it('addItems() recalculates total_cents atomically, including pre-existing items', async () => {
    const tableId = await makeTable();
    const orderId = randomUUID();
    await ordersRepo.create(
      tenantId,
      { id: orderId, tableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Adana Kebap',
          categoryNameSnapshot: 'Kebaplar',
          unitPriceCents: 10000,
          quantity: 1,
          totalCents: 10000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );

    await ordersRepo.addItems(tenantId, orderId, [
      {
        id: randomUUID(),
        productId: null,
        productName: 'Coca-Cola',
        categoryNameSnapshot: 'İçecekler',
        unitPriceCents: 2500,
        quantity: 2,
        totalCents: 5000,
        createdByUserId: null,
        createdByName: null,
      },
    ]);

    const refreshed = await ordersRepo.findByIdWithItems(tenantId, orderId);
    expect(refreshed?.order.total_cents).toBe(15000);
    expect(refreshed?.items).toHaveLength(2);
  });

  it('cancelOrder() atomically cancels every item and zeroes total_cents', async () => {
    const tableId = await makeTable();
    const orderId = randomUUID();
    await ordersRepo.create(
      tenantId,
      { id: orderId, tableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Mercimek Çorbası',
          categoryNameSnapshot: 'Çorbalar',
          unitPriceCents: 4000,
          quantity: 1,
          totalCents: 4000,
          createdByUserId: null,
          createdByName: null,
        },
        {
          id: randomUUID(),
          productId: null,
          productName: 'Ekmek',
          categoryNameSnapshot: 'Ekstra',
          unitPriceCents: 2000,
          quantity: 1,
          totalCents: 2000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );

    const result = await ordersRepo.cancelOrder(tenantId, orderId);
    expect(result.order.status).toBe('cancelled');
    expect(result.order.total_cents).toBe(0);
    expect(result.items.every((i) => i.status === 'cancelled')).toBe(true);
  });

  it('voidPayment() reopen conflict (23505) rolls back BOTH the void and the reopen — no partial state', async () => {
    const tableId = await makeTable();

    // Order A: single item, paid in full (closeOrder=true → status='paid').
    const orderAId = randomUUID();
    await ordersRepo.create(
      tenantId,
      { id: orderAId, tableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Izgara Köfte',
          categoryNameSnapshot: 'Ana Yemek',
          unitPriceCents: 8000,
          quantity: 1,
          totalCents: 8000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );
    const paymentId = randomUUID();
    await paymentsRepo.create(tenantId, {
      id: paymentId,
      orderId: orderAId,
      paymentType: 'cash',
      paymentScope: 'full',
      amountCents: 8000,
      idempotencyKey: randomUUID(),
      createdByUserId: userId,
      closeOrder: true,
    });
    const orderAAfterPay = await db
      .selectFrom('orders')
      .select('status')
      .where('id', '=', orderAId)
      .executeTakeFirstOrThrow();
    expect(orderAAfterPay.status).toBe('paid');

    // Table frees up (paid is excluded from the active whitelist, Migration
    // 042) — open a brand new order C on the SAME table.
    const orderCId = randomUUID();
    await ordersRepo.create(tenantId, {
      id: orderCId,
      tableId,
      orderType: 'dine_in',
      storeDate: new Date(),
    });

    // Void the payment on order A → the conditional auto-reopen (K3 step 6)
    // tries to flip order A back to 'open', which collides with order C on
    // the same table (orders_tenant_table_open_uq, 23505) → the ENTIRE
    // transaction (void + reopen) must roll back.
    await expect(
      db
        .transaction()
        .execute((trx) =>
          paymentsRepo.voidPayment(trx, tenantId, paymentId, {
            reasonCode: 'other',
            actorUserId: userId,
          }),
        ),
    ).rejects.toMatchObject({ cause: 'unique' });

    // Nothing should have changed: payment still active, order A still paid.
    const paymentAfter = await db
      .selectFrom('payments')
      .select('voided_at')
      .where('id', '=', paymentId)
      .executeTakeFirstOrThrow();
    expect(paymentAfter.voided_at).toBeNull();
    const orderAFinal = await db
      .selectFrom('orders')
      .select('status')
      .where('id', '=', orderAId)
      .executeTakeFirstOrThrow();
    expect(orderAFinal.status).toBe('paid');
  });

  it('mergeInto() preserves item + total sums — no loss, no double count', async () => {
    const sourceTableId = await makeTable();
    const targetTableId = await makeTable();
    const sourceOrderId = randomUUID();
    const targetOrderId = randomUUID();

    await ordersRepo.create(
      tenantId,
      { id: sourceOrderId, tableId: sourceTableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Tavuk Şiş',
          categoryNameSnapshot: 'Izgara',
          unitPriceCents: 5000,
          quantity: 1,
          totalCents: 5000,
          createdByUserId: null,
          createdByName: null,
        },
        {
          id: randomUUID(),
          productId: null,
          productName: 'Pilav',
          categoryNameSnapshot: 'Ekstra',
          unitPriceCents: 3000,
          quantity: 1,
          totalCents: 3000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );
    await ordersRepo.create(
      tenantId,
      { id: targetOrderId, tableId: targetTableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Mantı',
          categoryNameSnapshot: 'Ana Yemek',
          unitPriceCents: 4000,
          quantity: 1,
          totalCents: 4000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );

    const beforeCount = await db
      .selectFrom('order_items')
      .select(({ fn }) => fn.countAll<string>().as('n'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    const result = await db
      .transaction()
      .execute((trx) => ordersRepo.mergeInto(trx, tenantId, sourceOrderId, targetTableId));

    expect(result.movedItemCount).toBe(2);
    expect(result.oldTargetTotalCents).toBe(4000);
    expect(result.newTargetTotalCents).toBe(12000);

    const afterCount = await db
      .selectFrom('order_items')
      .select(({ fn }) => fn.countAll<string>().as('n'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();
    // Items are re-parented, never duplicated or dropped.
    expect(afterCount.n).toBe(beforeCount.n);

    const sourceFinal = await db
      .selectFrom('orders')
      .select(['status', 'total_cents', 'merged_into_order_id'])
      .where('id', '=', sourceOrderId)
      .executeTakeFirstOrThrow();
    expect(sourceFinal.status).toBe('merged');
    expect(sourceFinal.total_cents).toBe(0);
    expect(sourceFinal.merged_into_order_id).toBe(targetOrderId);

    const targetFinal = await db
      .selectFrom('orders')
      .select('total_cents')
      .where('id', '=', targetOrderId)
      .executeTakeFirstOrThrow();
    expect(targetFinal.total_cents).toBe(12000);
  });
});
