import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import type { Server as IoServer } from 'socket.io';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Tables/Areas admin-CRUD realtime emit tests (ADR-010 §11.6 Amendment 2026-07-01).
 *
 * Admin masa/bölge CRUD artık `tables.changed` / `areas.changed` (invalidate-only)
 * yayar → diğer terminallerin masa tahtası canlı tazelenir. Bu test her CRUD
 * endpoint'inin doğru event + payload + `tenant:${TENANT_ID}` room'una yaydığını
 * pinler (kds.test.ts harness: buildApp opts.io = spy). io=undefined guard'ı
 * mevcut io'suz tables/areas testlerini kırmaz (ayrı dosyada doğrulanır).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `ta-admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `ta-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

interface MockIo {
  io: IoServer;
  emitSpy: ReturnType<typeof vi.fn>;
  toMock: ReturnType<typeof vi.fn>;
  ofMock: ReturnType<typeof vi.fn>;
}

function createMockIo(): MockIo {
  const emitSpy = vi.fn();
  const toMock = vi.fn().mockReturnValue({ emit: emitSpy });
  const ofMock = vi.fn().mockReturnValue({ to: toMock });
  return { io: { of: ofMock } as unknown as IoServer, emitSpy, toMock, ofMock };
}

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  mockIo: MockIo;
  adminToken: string;
}

const ctx: Partial<TestCtx> = {};

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

/** Create an area via the API; returns its id (POST /areas emits — cleared by caller). */
async function createArea(): Promise<string> {
  const res = await request(ctx.app!)
    .post('/areas')
    .set('Authorization', `Bearer ${ctx.adminToken!}`)
    .send({ name: `Bölge ${randomUUID().slice(0, 8)}` });
  if (res.status !== 201) {
    throw new Error(`area POST failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.area.id as string;
}

/** Create a table via the API; returns its id. */
async function createTable(): Promise<string> {
  const res = await request(ctx.app!)
    .post('/tables')
    .set('Authorization', `Bearer ${ctx.adminToken!}`)
    .send({ code: `T-${randomUUID().slice(0, 6)}` });
  if (res.status !== 201) {
    throw new Error(`table POST failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.table.id as string;
}

function findEmit(mockIo: MockIo, event: string): [string, unknown] | undefined {
  return mockIo.emitSpy.mock.calls.find((c) => c[0] === event) as
    | [string, unknown]
    | undefined;
}

function routedTo(mockIo: MockIo, room: string): boolean {
  return mockIo.toMock.mock.calls.some((c) => c[0] === room);
}

function clearEmits(mockIo: MockIo): void {
  mockIo.emitSpy.mockClear();
  mockIo.toMock.mockClear();
  mockIo.ofMock.mockClear();
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'tables/areas admin-CRUD realtime emits (ADR-010 §11.6 Amendment)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      const mockIo = createMockIo();
      ctx.pool = pool;
      ctx.db = db;
      ctx.mockIo = mockIo;
      ctx.app = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
        io: mockIo.io,
      });

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Tables/Areas Emit Tenant',
          slug: `ta-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      await db
        .insertInto('users')
        .values({
          id: ADMIN_ID,
          tenant_id: TENANT_ID,
          email: ADMIN_EMAIL,
          username: ADMIN_USERNAME,
          password_hash: adminHash,
          role: 'admin',
        })
        .execute();

      ctx.adminToken = await loginAndGetToken(
        ctx.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('areas').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
    });

    // ── tables.changed ────────────────────────────────────────────────────────
    it('POST /tables → tables.changed (created, tenant room)', async () => {
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code: `T-${randomUUID().slice(0, 6)}` });
      expect(res.status).toBe(201);
      const tableId = res.body.data.table.id as string;

      const emit = findEmit(ctx.mockIo!, 'tables.changed');
      expect(emit).toBeDefined();
      expect(emit![1]).toMatchObject({ action: 'created', tableId });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('PATCH /tables/:id → tables.changed (updated)', async () => {
      const tableId = await createTable();
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .patch(`/tables/${tableId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ capacity: 6 });
      expect(res.status).toBe(200);
      expect(findEmit(ctx.mockIo!, 'tables.changed')![1]).toMatchObject({
        action: 'updated',
        tableId,
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('PATCH /tables/:id/area → tables.changed (area_assigned)', async () => {
      const areaId = await createArea();
      const tableId = await createTable();
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .patch(`/tables/${tableId}/area`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ area_id: areaId });
      expect(res.status).toBe(200);
      expect(findEmit(ctx.mockIo!, 'tables.changed')![1]).toMatchObject({
        action: 'area_assigned',
        tableId,
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('DELETE /tables/:id → tables.changed (deleted)', async () => {
      const tableId = await createTable();
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .delete(`/tables/${tableId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(204);
      expect(findEmit(ctx.mockIo!, 'tables.changed')![1]).toMatchObject({
        action: 'deleted',
        tableId,
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    // ── areas.changed ─────────────────────────────────────────────────────────
    it('POST /areas → areas.changed (created, tenant room)', async () => {
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .post('/areas')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: `Bölge ${randomUUID().slice(0, 8)}` });
      expect(res.status).toBe(201);
      const areaId = res.body.data.area.id as string;
      expect(findEmit(ctx.mockIo!, 'areas.changed')![1]).toMatchObject({
        action: 'created',
        areaId,
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('PATCH /areas/:id → areas.changed (updated)', async () => {
      const areaId = await createArea();
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .patch(`/areas/${areaId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: `Bölge ${randomUUID().slice(0, 8)}` });
      expect(res.status).toBe(200);
      expect(findEmit(ctx.mockIo!, 'areas.changed')![1]).toMatchObject({
        action: 'updated',
        areaId,
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('DELETE /areas/:id → areas.changed (deleted)', async () => {
      const areaId = await createArea();
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .delete(`/areas/${areaId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(204);
      expect(findEmit(ctx.mockIo!, 'areas.changed')![1]).toMatchObject({
        action: 'deleted',
        areaId,
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('POST /areas/:id/sync-tables → areas.changed (synced) on change; no emit on no-op', async () => {
      const areaId = await createArea();

      // Sync 0 → 2 tables: created > 0 → emit synced.
      clearEmits(ctx.mockIo!);
      const grow = await request(ctx.app!)
        .post(`/areas/${areaId}/sync-tables`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ count: 2 });
      expect(grow.status).toBe(200);
      expect(findEmit(ctx.mockIo!, 'areas.changed')![1]).toMatchObject({
        action: 'synced',
        areaId,
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);

      // Sync 2 → 2 (no-op): no change → NO emit.
      clearEmits(ctx.mockIo!);
      const noop = await request(ctx.app!)
        .post(`/areas/${areaId}/sync-tables`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ count: 2 });
      expect(noop.status).toBe(200);
      expect(findEmit(ctx.mockIo!, 'areas.changed')).toBeUndefined();
    });
  },
);
