import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createKysely,
  createPool,
  createOrdersRepository,
  createPaymentsRepository,
  createTablesRepository,
  createCustomersRepository,
  createUsersRepository,
  RepositoryError,
  type OrdersRepository,
  type PaymentsRepository,
  type TablesRepository,
  type CustomersRepository,
} from '../../index.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated.js';

/**
 * Deep audit — Blok 3 / Hat C (packages/db). Cross-tenant isolation checks
 * for orders/payments/tables/customers repositories. All tests here are
 * expected GREEN — they prove tenant_id scoping holds; a red result here
 * would itself be a BLOCKER (data leak across tenants).
 *
 * Runs ONLY against pos_test (DATABASE_URL env). Never touches pos_dev.
 */
const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Cross-tenant isolation audit (Hat C)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let ordersRepo: OrdersRepository;
  let paymentsRepo: PaymentsRepository;
  let tablesRepo: TablesRepository;
  let customersRepo: CustomersRepository;

  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let tableA: string;
  let tableB: string;
  let orderAId: string;
  let paymentAId: string;
  let customerAId: string;
  const phoneANormalized = '905551112233';

  beforeAll(async () => {
    pool = createPool({ connectionString: DB_URL as string });
    db = createKysely(pool);
    ordersRepo = createOrdersRepository(db);
    paymentsRepo = createPaymentsRepository(db);
    tablesRepo = createTablesRepository(db);
    customersRepo = createCustomersRepository(db);

    tenantA = randomUUID();
    tenantB = randomUUID();
    for (const [id, label] of [
      [tenantA, 'a'],
      [tenantB, 'b'],
    ] as const) {
      await db
        .insertInto('tenants')
        .values({ id, name: `QA3C CrossTenant ${label}`, slug: `qa-3c-xt-${label}-${id.slice(0, 8)}` })
        .execute();
      await db.insertInto('tenant_settings').values({ tenant_id: id }).execute();
    }

    const usersRepo = createUsersRepository(db);
    userA = randomUUID();
    await usersRepo.create({
      id: userA,
      tenantId: tenantA,
      email: `qa3c-xt-${userA}@example.com`,
      username: `qa3c-xt-${userA}`,
      passwordHash: '$2b$12$dummyhashfortestpurpose0000000000000000000000',
      role: 'cashier',
    });

    tableA = randomUUID();
    await db.insertInto('tables').values({ id: tableA, tenant_id: tenantA, code: 'A1', capacity: 4 }).execute();
    tableB = randomUUID();
    await db.insertInto('tables').values({ id: tableB, tenant_id: tenantB, code: 'B1', capacity: 4 }).execute();

    orderAId = randomUUID();
    await ordersRepo.create(
      tenantA,
      { id: orderAId, tableId: tableA, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Pide',
          categoryNameSnapshot: 'Pideler',
          unitPriceCents: 7000,
          quantity: 1,
          totalCents: 7000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );

    paymentAId = randomUUID();
    await paymentsRepo.create(tenantA, {
      id: paymentAId,
      orderId: orderAId,
      paymentType: 'cash',
      paymentScope: 'full',
      amountCents: 7000,
      idempotencyKey: randomUUID(),
      createdByUserId: userA,
    });

    customerAId = randomUUID();
    await customersRepo.createCustomer(tenantA, {
      id: customerAId,
      fullName: 'Ahmet Yılmaz',
      phones: [{ id: randomUUID(), rawPhone: '0555 111 22 33', isPrimary: true }],
    });
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await db.deleteFrom('payment_items').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('payments').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('order_item_attributes').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('order_items').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('orders').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('order_no_counters').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('customer_phones').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('customer_addresses').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('customers').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('users').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
    }
    await db.destroy();
  });

  it('orders.findByIdWithItems(): tenant B cannot read tenant A order', async () => {
    const result = await ordersRepo.findByIdWithItems(tenantB, orderAId);
    expect(result).toBeNull();
  });

  it('orders.addItems(): tenant B mutating tenant A order throws ORDER_NOT_FOUND', async () => {
    await expect(
      ordersRepo.addItems(tenantB, orderAId, [
        {
          id: randomUUID(),
          productId: null,
          productName: 'X',
          categoryNameSnapshot: 'Y',
          unitPriceCents: 100,
          quantity: 1,
          totalCents: 100,
          createdByUserId: null,
          createdByName: null,
        },
      ]),
    ).rejects.toMatchObject({ cause: 'not_found' });
  });

  it('orders.mergeInto(): tenant B cannot merge a tenant A source order', async () => {
    await expect(
      db.transaction().execute((trx) => ordersRepo.mergeInto(trx, tenantB, orderAId, tableB)),
    ).rejects.toMatchObject({ cause: 'not_found' });
  });

  it('orders.moveToTable(): tenant A cannot move into a tenant B table (cross-tenant target 404s)', async () => {
    await expect(
      db.transaction().execute((trx) => ordersRepo.moveToTable(trx, tenantA, orderAId, tableB)),
    ).rejects.toMatchObject({ cause: 'not_found' });
  });

  it('orders.assignCustomer(): tenant B acting on tenant A order throws ORDER_NOT_FOUND', async () => {
    await expect(
      db.transaction().execute((trx) => ordersRepo.assignCustomer(trx, tenantB, orderAId, null)),
    ).rejects.toMatchObject({ cause: 'not_found' });
  });

  it('payments.voidPayment(): tenant B cannot void a tenant A payment', async () => {
    await expect(
      db
        .transaction()
        .execute((trx) =>
          paymentsRepo.voidPayment(trx, tenantB, paymentAId, {
            reasonCode: 'other',
            actorUserId: userA,
          }),
        ),
    ).rejects.toMatchObject({ cause: 'not_found' });
  });

  it('payments.findByOrderId(): tenant B sees zero rows for a tenant A order', async () => {
    const rows = await paymentsRepo.findByOrderId(tenantB, orderAId);
    expect(rows).toHaveLength(0);
  });

  it('tables.findById(): tenant B cannot see a tenant A table', async () => {
    const row = await tablesRepo.findById(tenantB, tableA);
    expect(row).toBeNull();
  });

  it('customers.getCustomerById(): tenant B cannot read a tenant A customer', async () => {
    const row = await customersRepo.getCustomerById(tenantB, customerAId);
    expect(row).toBeNull();
  });

  it('customers.addPhone(): tenant B acting on tenant A customer id throws CUSTOMER_NOT_FOUND', async () => {
    await expect(
      customersRepo.addPhone(tenantB, customerAId, randomUUID(), '0555 999 88 77', false),
    ).rejects.toMatchObject({ cause: 'not_found' });
  });

  it('customers.findCustomerByPhone(): tenant B cannot resolve tenant A phone number', async () => {
    const row = await customersRepo.findCustomerByPhone(tenantB, phoneANormalized);
    expect(row).toBeNull();
  });

  it('errors thrown across the boundary are RepositoryError instances (not raw pg leaks)', async () => {
    const err: unknown = await ordersRepo
      .addItems(tenantB, orderAId, [])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryError);
  });
});
