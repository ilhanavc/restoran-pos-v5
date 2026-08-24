import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { sql, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import { hashPassword } from '../auth/password';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  RefreshTokenError,
} from '../auth/refresh';

/**
 * ADR-002 §11 (Amendment 5) — RTR reuse-detection grace window.
 * Canlı vaka: iyi-niyetli çift-refresh garsonu servis ortasında oturumdan attı.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const USER_ID = randomUUID();

let pool: Pool | undefined;
let db: Kysely<DB> | undefined;
let prevGrace: string | undefined;

function hashOf(plain: string): Buffer {
  return createHash('sha256').update(plain).digest();
}

/** Ailedeki (revoked_at IS NULL + expires_at > now) satırlar. */
async function activeRows(
  kysely: Kysely<DB>,
  familyId: string,
): Promise<{ id: string; parent_id: string | null }[]> {
  return kysely
    .selectFrom('refresh_tokens')
    .select(['id', 'parent_id'])
    .where('family_id', '=', familyId)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', new Date())
    .execute();
}

async function reasonsOf(
  kysely: Kysely<DB>,
  familyId: string,
): Promise<(string | null)[]> {
  const rows = await kysely
    .selectFrom('refresh_tokens')
    .select('revoked_reason')
    .where('family_id', '=', familyId)
    .execute();
  return rows.map((r) => r.revoked_reason);
}

async function familyIdOf(
  kysely: Kysely<DB>,
  plain: string,
): Promise<string> {
  const row = await kysely
    .selectFrom('refresh_tokens')
    .select('family_id')
    .where('token_hash', '=', hashOf(plain))
    .executeTakeFirstOrThrow();
  return row.family_id;
}

/** Bir token'ın revoked_at değerini geriye çeker (grace penceresi dışına). */
async function backdateRevokedAt(
  kysely: Kysely<DB>,
  plain: string,
  msAgo: number,
): Promise<void> {
  await kysely
    .updateTable('refresh_tokens')
    .set({ revoked_at: new Date(Date.now() - msAgo) })
    .where('token_hash', '=', hashOf(plain))
    .execute();
}

/**
 * Bir oturumun satır kilidinde GERÇEKTEN beklediğini doğrular (zamanlamaya
 * değil DB durumuna bakar) — eşzamanlılık testini deterministik yapar.
 */
async function waitForLockWaiter(kysely: Kysely<DB>): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const res = await sql<{ cnt: string }>`
      SELECT count(*) AS cnt FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND wait_event_type = 'Lock'
    `.execute(kysely);
    if (Number(res.rows[0]?.cnt ?? '0') > 0) return;
    await sleep(25);
  }
  throw new Error('Beklenen satır kilidi bekleyicisi olusmadi');
}

async function issue(kysely: Kysely<DB>): Promise<string> {
  return issueRefreshToken({
    db: kysely,
    userId: USER_ID,
    tenantId: TENANT_ID,
  });
}

async function rotate(
  kysely: Kysely<DB>,
  plainToken: string,
): Promise<string> {
  const res = await rotateRefreshToken({
    db: kysely,
    plainToken,
    accessSecret: ACCESS_SECRET,
  });
  return res.newPlainToken;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'auth refresh grace window (ADR-002 §11)',
  () => {
    beforeAll(async () => {
      prevGrace = process.env['AUTH_REFRESH_GRACE_MS'];
      pool = createPool({ connectionString: DB_URL ?? '' });
      db = createKysely(pool);

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Grace Test Tenant',
          slug: `grace-${TENANT_ID.slice(0, 8)}`,
        })
        .execute();

      await db
        .insertInto('users')
        .values({
          id: USER_ID,
          tenant_id: TENANT_ID,
          email: `grace-${USER_ID}@example.com`,
          username: `grace-${USER_ID.slice(0, 8)}`,
          password_hash: await hashPassword('testpass1234'),
          role: 'waiter',
        })
        .execute();
    });

    afterEach(async () => {
      if (prevGrace === undefined) delete process.env['AUTH_REFRESH_GRACE_MS'];
      else process.env['AUTH_REFRESH_GRACE_MS'] = prevGrace;
      await db
        ?.deleteFrom('refresh_tokens')
        .where('user_id', '=', USER_ID)
        .execute();
    });

    afterAll(async () => {
      if (db !== undefined) {
        await db
          .deleteFrom('refresh_tokens')
          .where('user_id', '=', USER_ID)
          .execute();
        await db.deleteFrom('users').where('id', '=', USER_ID).execute();
        await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await db.destroy();
      }
    });

    // (a) Grace içi
    it('grace içinde tekrar sunulan rotate edilmiş token → kurtarılır, aile İPTAL EDİLMEZ', async () => {
      const kysely = db!;
      const t0 = await issue(kysely);
      const familyId = await familyIdOf(kysely, t0);
      const t1 = await rotate(kysely, t0);

      // İyi-niyetli çift-refresh: istemci t1'i yazamadan t0 ile tekrar geldi.
      const t2 = await rotate(kysely, t0);
      expect(t2).not.toBe(t1);

      const reasons = await reasonsOf(kysely, familyId);
      expect(reasons).not.toContain('reuse_detected');
      expect(reasons).toContain('rotated_grace');

      // Zincir doğrusal: ailede tek aktif token ve o da t2.
      const active = await activeRows(kysely, familyId);
      expect(active).toHaveLength(1);
      expect(active[0]!.id).toBe(
        (
          await kysely
            .selectFrom('refresh_tokens')
            .select('id')
            .where('token_hash', '=', hashOf(t2))
            .executeTakeFirstOrThrow()
        ).id,
      );

      // t2 head'e (t1) çapalanmış olmalı — t0'dan ikinci çocuk ÜRETİLMEZ.
      const t1Row = await kysely
        .selectFrom('refresh_tokens')
        .select(['id', 'revoked_reason'])
        .where('token_hash', '=', hashOf(t1))
        .executeTakeFirstOrThrow();
      expect(t1Row.revoked_reason).toBe('rotated_grace');
      expect(active[0]!.parent_id).toBe(t1Row.id);

      // t2 hâlâ kullanılabilir (kesintisiz devam).
      await expect(rotate(kysely, t2)).resolves.toBeTypeOf('string');
    });

    // (b) Grace dışı — mevcut davranış birebir
    it('grace penceresi dışında rotate edilmiş token → REUSE + aile iptali', async () => {
      const kysely = db!;
      const t0 = await issue(kysely);
      const familyId = await familyIdOf(kysely, t0);
      await rotate(kysely, t0);

      await backdateRevokedAt(kysely, t0, 10 * 60 * 1000);

      const warn = vi.spyOn(logger, 'warn');
      try {
        await expect(rotate(kysely, t0)).rejects.toMatchObject({
          code: 'AUTH_REFRESH_REUSE',
        });

        // Güvenlik izi: aile iptali sessiz kalmaz (§11.6, prod sayacı buna dayanır).
        const call = warn.mock.calls.find(
          (c) =>
            typeof c[0] === 'object' &&
            c[0] !== null &&
            (c[0] as { event?: string }).event === 'auth.refresh.reuse_detected',
        );
        expect(call).toBeDefined();
        const payload = call![0] as Record<string, unknown>;
        expect(payload['trigger']).toBe('out_of_window');
        expect(payload['family_id']).toBe(familyId);
        expect(payload['user_id']).toBe(USER_ID);
        // KVKK: plain token / hash / IP loglanmaz.
        expect(Object.keys(payload).sort()).toEqual([
          'event',
          'family_id',
          'tenant_id',
          'trigger',
          'user_id',
        ]);
      } finally {
        warn.mockRestore();
      }

      expect(await activeRows(kysely, familyId)).toHaveLength(0);
      expect(await reasonsOf(kysely, familyId)).toContain('reuse_detected');
    });

    // (c) Eşzamanlı iki "eski token" isteği
    it('eşzamanlı iki eski-token isteği → ikisi de başarılı, çatallanma yok', async () => {
      const kysely = db!;
      const t0 = await issue(kysely);
      const familyId = await familyIdOf(kysely, t0);
      await rotate(kysely, t0);

      const [a, b] = await Promise.all([rotate(kysely, t0), rotate(kysely, t0)]);
      expect(a).not.toBe(b);

      const active = await activeRows(kysely, familyId);
      expect(active).toHaveLength(1);
      expect(await reasonsOf(kysely, familyId)).not.toContain('reuse_detected');

      // Zincir doğrusal: hiçbir ebeveynin iki çocuğu yok.
      const rows = await kysely
        .selectFrom('refresh_tokens')
        .select('parent_id')
        .where('family_id', '=', familyId)
        .where('parent_id', 'is not', null)
        .execute();
      const parents = rows.map((r) => r.parent_id);
      expect(new Set(parents).size).toBe(parents.length);
    });

    // (c) Deterministik yarış — stale-snapshot regresyon kilidi
    it('kilit BEKLERKEN commit olan rakip rotasyonu görür (stale-snapshot regresyonu)', async () => {
      const kysely = db!;
      const t0 = await issue(kysely);
      const familyId = await familyIdOf(kysely, t0);
      const t1 = await rotate(kysely, t0);
      const t1Row = await kysely
        .selectFrom('refresh_tokens')
        .select(['id', 'tenant_id', 'user_id'])
        .where('token_hash', '=', hashOf(t1))
        .executeTakeFirstOrThrow();

      let settled: Promise<{ ok: boolean }> | undefined;

      await kysely.transaction().execute(async (trx) => {
        // 1) Rakip transaction aile satırlarını kilitler.
        await trx
          .selectFrom('refresh_tokens')
          .select('id')
          .where('family_id', '=', familyId)
          .forUpdate()
          .execute();

        // 2) Kurtarma isteği başlar ve bu kilitte BLOKE olur (DB'den doğrulanır).
        settled = rotate(kysely, t0).then(
          () => ({ ok: true }),
          () => ({ ok: false }),
        );
        await waitForLockWaiter(kysely);

        // 3) Rakip rotasyon tamamlanır: YENİ head insert + eski head revoke.
        //    Bu satır, bekleyen isteğin kilit sorgusunun snapshot'ında YOKTUR.
        await trx
          .insertInto('refresh_tokens')
          .values({
            id: randomUUID(),
            tenant_id: t1Row.tenant_id,
            user_id: t1Row.user_id,
            token_hash: randomBytes(32),
            family_id: familyId,
            parent_id: t1Row.id,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          })
          .execute();
        await trx
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date(), revoked_reason: 'rotated_grace' })
          .where('id', '=', t1Row.id)
          .execute();
        // 4) COMMIT (transaction sonu) → bekleyen istek unblock olur.
      });

      // Taze okuma yapılmazsa istek yeni head'i GÖREMEZ ve 401 atardı
      // (garson yine oturumdan düşerdi) — amendment'in çözdüğü tam senaryo.
      await expect(settled!).resolves.toEqual({ ok: true });

      const active = await activeRows(kysely, familyId);
      expect(active).toHaveLength(1);
      expect(await reasonsOf(kysely, familyId)).not.toContain('reuse_detected');
    });

    // (d) Regresyon — normal rotasyon
    it('normal rotasyon akışı etkilenmez (taze token → rotated)', async () => {
      const kysely = db!;
      const t0 = await issue(kysely);
      const familyId = await familyIdOf(kysely, t0);
      const t1 = await rotate(kysely, t0);
      expect(t1).not.toBe(t0);

      const t0Row = await kysely
        .selectFrom('refresh_tokens')
        .select('revoked_reason')
        .where('token_hash', '=', hashOf(t0))
        .executeTakeFirstOrThrow();
      expect(t0Row.revoked_reason).toBe('rotated');
      expect(await activeRows(kysely, familyId)).toHaveLength(1);
    });

    // (d) Regresyon — logout grace içinde bile dirilmez
    it('logout ile revoke edilmiş token grace içinde bile → REUSE + aile iptali', async () => {
      const kysely = db!;
      const t0 = await issue(kysely);
      const familyId = await familyIdOf(kysely, t0);
      const t1 = await rotate(kysely, t0);
      // t0 rotate ile 'rotated' oldu; kullanıcı niyeti = çıkış olduğunda reason
      // 'logout' olur → grace bu token'ı DİRİLTMEZ (§11.4).
      await kysely
        .updateTable('refresh_tokens')
        .set({ revoked_reason: 'logout' })
        .where('token_hash', '=', hashOf(t0))
        .execute();

      const err = await rotate(kysely, t0).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RefreshTokenError);
      expect((err as RefreshTokenError).code).toBe('AUTH_REFRESH_REUSE');
      // Aile iptali: aktif head (t1) dahil her şey revoke edilir.
      expect(await activeRows(kysely, familyId)).toHaveLength(0);
      expect(await reasonsOf(kysely, familyId)).toContain('reuse_detected');
      await expect(rotate(kysely, t1)).rejects.toBeInstanceOf(RefreshTokenError);
    });

    it('admin_force / all_sessions ile revoke edilmiş token grace içinde → REUSE', async () => {
      const kysely = db!;
      for (const reason of ['admin_force', 'all_sessions'] as const) {
        const t0 = await issue(kysely);
        const familyId = await familyIdOf(kysely, t0);
        await kysely
          .updateTable('refresh_tokens')
          .set({ revoked_at: new Date(), revoked_reason: reason })
          .where('token_hash', '=', hashOf(t0))
          .execute();

        await expect(rotate(kysely, t0)).rejects.toMatchObject({
          code: 'AUTH_REFRESH_REUSE',
        });
        expect(await activeRows(kysely, familyId)).toHaveLength(0);
      }
    });

    it('aile tamamen ölüyse grace kurtarmaz ama aileyi TEKRAR revoke etmez', async () => {
      const kysely = db!;
      const t0 = await issue(kysely);
      const familyId = await familyIdOf(kysely, t0);
      const t1 = await rotate(kysely, t0);
      // Head'i logout ile öldür → ailede aktif baş kalmaz.
      await revokeRefreshToken(kysely, t1);

      await expect(rotate(kysely, t0)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_INVALID',
      });
      expect(await reasonsOf(kysely, familyId)).not.toContain('reuse_detected');
    });

    // (e) Suistimal tavanı
    it('aynı ailede 10 dk içinde 6. grace denemesi → reuse_detected + 401', async () => {
      const kysely = db!;
      const t0 = await issue(kysely);
      const familyId = await familyIdOf(kysely, t0);
      await rotate(kysely, t0);

      // 5 kurtarma serbest.
      for (let i = 0; i < 5; i += 1) {
        await rotate(kysely, t0);
      }

      const warn = vi.spyOn(logger, 'warn');
      try {
        await expect(rotate(kysely, t0)).rejects.toMatchObject({
          code: 'AUTH_REFRESH_REUSE',
        });
        const call = warn.mock.calls.find(
          (c) =>
            typeof c[0] === 'object' &&
            c[0] !== null &&
            (c[0] as { event?: string }).event === 'auth.refresh.reuse_detected',
        );
        expect(call).toBeDefined();
        expect((call![0] as { trigger?: string }).trigger).toBe('grace_ceiling');
      } finally {
        warn.mockRestore();
      }
      expect(await activeRows(kysely, familyId)).toHaveLength(0);
      expect(await reasonsOf(kysely, familyId)).toContain('reuse_detected');
    });

    it('AUTH_REFRESH_GRACE_MS=0 ile grace tamamen kapanır (kill switch)', async () => {
      const kysely = db!;
      process.env['AUTH_REFRESH_GRACE_MS'] = '0';
      const t0 = await issue(kysely);
      const familyId = await familyIdOf(kysely, t0);
      await rotate(kysely, t0);

      await expect(rotate(kysely, t0)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSE',
      });
      expect(await activeRows(kysely, familyId)).toHaveLength(0);
    });
  },
);
