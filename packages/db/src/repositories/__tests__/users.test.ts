import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  createKysely,
  createPool,
  createUsersRepository,
  type UsersRepository,
} from '../../index.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated.js';

const DB_URL = process.env['DATABASE_URL'];
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe.skipIf(!DB_URL)('UsersRepository (integration)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let repo: UsersRepository;
  const createdIds: string[] = [];

  beforeAll(() => {
    pool = createPool({ connectionString: DB_URL as string });
    db = createKysely(pool);
    repo = createUsersRepository(db);
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await db
        .deleteFrom('users')
        .where('id', 'in', createdIds)
        .where('tenant_id', '=', TENANT_ID)
        .execute();
    }
    await db.destroy();
    await pool.end();
  });

  it('create() inserts a user and returns row', async () => {
    const id = randomUUID();
    createdIds.push(id);
    const email = `test-${id}@example.com`;

    const user = await repo.create({
      id,
      tenantId: TENANT_ID,
      email,
      username: `user-${id}`,
      passwordHash: '$2b$12$dummyhashfortestpurpose0000000000000000000000',
      role: 'cashier',
    });

    expect(user.id).toBe(id);
    expect(user.email).toBe(email);
    expect(user.role).toBe('cashier');
  });

  it('findByEmail() returns the created user', async () => {
    const id = randomUUID();
    createdIds.push(id);
    const email = `find-${id}@example.com`;

    await repo.create({
      id,
      tenantId: TENANT_ID,
      email,
      username: `user-${id}`,
      passwordHash: '$2b$12$dummyhashfortestpurpose0000000000000000000000',
      role: 'waiter',
    });

    const found = await repo.findByEmail(TENANT_ID, email);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(id);
  });

  it('findByEmail() returns null for missing email', async () => {
    const found = await repo.findByEmail(
      TENANT_ID,
      `nonexistent-${randomUUID()}@example.com`,
    );
    expect(found).toBeNull();
  });

  it('create() throws ConflictError on duplicate email', async () => {
    const email = `dup-${randomUUID()}@example.com`;
    const id1 = randomUUID();
    const id2 = randomUUID();
    createdIds.push(id1, id2);

    await repo.create({
      id: id1,
      tenantId: TENANT_ID,
      email,
      username: `u1-${id1}`,
      passwordHash: '$2b$12$dummyhashfortestpurpose0000000000000000000000',
      role: 'cashier',
    });

    await expect(
      repo.create({
        id: id2,
        tenantId: TENANT_ID,
        email,
        username: `u2-${id2}`,
        passwordHash: '$2b$12$dummyhashfortestpurpose0000000000000000000000',
        role: 'cashier',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
