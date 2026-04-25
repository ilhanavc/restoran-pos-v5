import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createKysely,
  createPool,
  createRefreshTokensRepository,
  createUsersRepository,
  type RefreshTokensRepository,
} from '../../index.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated.js';

const DB_URL = process.env['DATABASE_URL'];
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe.skipIf(!DB_URL)('RefreshTokensRepository (integration)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let repo: RefreshTokensRepository;
  let userId: string;
  const createdHashes: string[] = [];

  beforeAll(async () => {
    pool = createPool({ connectionString: DB_URL as string });
    db = createKysely(pool);
    repo = createRefreshTokensRepository(db);

    // bir test user'ı yarat (RT tablosu users'a FK)
    const usersRepo = createUsersRepository(db);
    userId = randomUUID();
    await usersRepo.create({
      id: userId,
      tenantId: TENANT_ID,
      email: `rt-user-${userId}@example.com`,
      username: `rt-user-${userId}`,
      passwordHash: '$2b$12$dummyhashfortestpurpose0000000000000000000000',
      role: 'cashier',
    });
  });

  afterAll(async () => {
    if (createdHashes.length > 0) {
      await db
        .deleteFrom('refresh_tokens')
        .where('token_hash', 'in', createdHashes)
        .execute();
    }
    await db
      .deleteFrom('refresh_tokens')
      .where('user_id', '=', userId)
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await db
      .deleteFrom('users')
      .where('id', '=', userId)
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await db.destroy();
    await pool.end();
  });

  it('create() persists a refresh token row', async () => {
    const id = randomUUID();
    const tokenHash = `hash-${randomUUID()}`;
    createdHashes.push(tokenHash);

    const row = await repo.create({
      id,
      tenantId: TENANT_ID,
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(row.id).toBe(id);
    expect(row.token_hash).toBe(tokenHash);
  });

  it('findByTokenHash() retrieves the token', async () => {
    const tokenHash = `find-${randomUUID()}`;
    createdHashes.push(tokenHash);
    await repo.create({
      id: randomUUID(),
      tenantId: TENANT_ID,
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const found = await repo.findByTokenHash(tokenHash);
    expect(found).not.toBeNull();
    expect(found?.token_hash).toBe(tokenHash);
  });

  it('deleteByTokenHash() removes the token', async () => {
    const tokenHash = `del-${randomUUID()}`;
    await repo.create({
      id: randomUUID(),
      tenantId: TENANT_ID,
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await repo.deleteByTokenHash(tokenHash);
    const found = await repo.findByTokenHash(tokenHash);
    expect(found).toBeNull();
  });

  it('deleteAllForUser() removes every token of the user', async () => {
    const h1 = `all-${randomUUID()}`;
    const h2 = `all-${randomUUID()}`;
    await repo.create({
      id: randomUUID(),
      tenantId: TENANT_ID,
      userId,
      tokenHash: h1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repo.create({
      id: randomUUID(),
      tenantId: TENANT_ID,
      userId,
      tokenHash: h2,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await repo.deleteAllForUser(TENANT_ID, userId);

    expect(await repo.findByTokenHash(h1)).toBeNull();
    expect(await repo.findByTokenHash(h2)).toBeNull();
  });
});
