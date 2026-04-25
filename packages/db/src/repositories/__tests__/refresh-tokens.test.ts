import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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

/** ADR-002 §4.2: SHA-256(plain), 32-byte Buffer */
function makeTokenHash(): { plain: string; hash: Buffer } {
  const plain = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(plain).digest();
  return { plain, hash };
}

describe.skipIf(!DB_URL)('RefreshTokensRepository (integration)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let repo: RefreshTokensRepository;
  let userId: string;
  const createdHashes: Buffer[] = [];

  beforeAll(async () => {
    pool = createPool({ connectionString: DB_URL as string });
    db = createKysely(pool);
    repo = createRefreshTokensRepository(db);

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

  it('create() persists a refresh token row with Buffer hash', async () => {
    const id = randomUUID();
    const familyId = randomUUID();
    const { hash } = makeTokenHash();
    createdHashes.push(hash);

    const row = await repo.create({
      id,
      tenantId: TENANT_ID,
      userId,
      tokenHash: hash,
      familyId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(row.id).toBe(id);
    expect(Buffer.isBuffer(row.token_hash)).toBe(true);
    expect((row.token_hash as Buffer).equals(hash)).toBe(true);
  });

  it('findByTokenHash() retrieves the token (including soft-revoked — caller checks revoked_at)', async () => {
    const familyId = randomUUID();
    const { hash } = makeTokenHash();
    createdHashes.push(hash);
    await repo.create({
      id: randomUUID(),
      tenantId: TENANT_ID,
      userId,
      tokenHash: hash,
      familyId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const found = await repo.findByTokenHash(hash);
    expect(found).not.toBeNull();
    expect(found?.revoked_at).toBeNull();
  });

  it('revokeByTokenHash() soft-revokes: row persists with revoked_at set (RTR reuse detection)', async () => {
    const familyId = randomUUID();
    const { hash } = makeTokenHash();
    createdHashes.push(hash);
    await repo.create({
      id: randomUUID(),
      tenantId: TENANT_ID,
      userId,
      tokenHash: hash,
      familyId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await repo.revokeByTokenHash(hash, 'rotated');

    const found = await repo.findByTokenHash(hash);
    expect(found).not.toBeNull();         // satır hâlâ var (audit trail)
    expect(found?.revoked_at).not.toBeNull();  // ama revoked
    expect(found?.revoked_reason).toBe('rotated');
  });

  it('deleteAllForUser() hard-deletes every token of the user', async () => {
    const familyId = randomUUID();
    const { hash: h1 } = makeTokenHash();
    const { hash: h2 } = makeTokenHash();
    await repo.create({
      id: randomUUID(), tenantId: TENANT_ID, userId,
      tokenHash: h1, familyId, expiresAt: new Date(Date.now() + 60_000),
    });
    await repo.create({
      id: randomUUID(), tenantId: TENANT_ID, userId,
      tokenHash: h2, familyId, expiresAt: new Date(Date.now() + 60_000),
    });

    await repo.deleteAllForUser(TENANT_ID, userId);

    expect(await repo.findByTokenHash(h1)).toBeNull();
    expect(await repo.findByTokenHash(h2)).toBeNull();
  });
});
