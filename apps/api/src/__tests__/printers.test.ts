import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { signAccessToken } from '../auth/jwt';

/**
 * ADR-032 Amendment 2 — Yazıcı yönetim ekranı (Dilim A + B) entegrasyon testi.
 *
 * Kapsam: GET /printers (durum eşikleri · kuyruk derinliği · yetim kuyruk ·
 * filtresiz çipi · cross-tenant izolasyon · RBAC) · PATCH /printers/:id
 * (display_name + audit) · PUT /printers/:id/categories (istasyon atama diff +
 * audit + kitchen_print/UUID guard'ları) · claim-side declared_kinds gözlem
 * yazımı (K2).
 *
 * Fixture dersleri: user token'ları signAccessToken ile DOĞRUDAN imzalanır
 * (loginLimiter'a hiç dokunmadan); tenant izole; agent JWT doğrudan imzalanır
 * (kind-filter test emsali); cleanup FK sırasına dikkat (audit_logs → print_jobs
 * → categories → agents; users/tenant afterAll'da); pool.end() tek kez.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const CASHIER_ID = randomUUID();
const WAITER_ID = randomUUID();
const KITCHEN_ID = randomUUID();

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
  waiterToken: string;
  kitchenToken: string;
}

const ctx: Partial<TestCtx> = {};

function userToken(userId: string, role: string): string {
  return signAccessToken(
    { sub: userId, tenant_id: TENANT_ID, role },
    ACCESS_SECRET,
  );
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-032 Amd2 — /printers (yazıcı yönetim ekranı)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.app = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: AGENT_SECRET,
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Test Tenant Printers',
          slug: `test-printers-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const hash = await hashPassword('irrelevant-pass-1234');
      await db
        .insertInto('users')
        .values(
          (
            [
              [ADMIN_ID, 'admin'],
              [CASHIER_ID, 'cashier'],
              [WAITER_ID, 'waiter'],
              [KITCHEN_ID, 'kitchen'],
            ] as const
          ).map(([id, role]) => ({
            id,
            tenant_id: TENANT_ID,
            email: `${role}-${id.slice(0, 8)}@example.com`,
            username: `${role}-${id.slice(0, 8)}`,
            password_hash: hash,
            role,
          })),
        )
        .execute();

      ctx.adminToken = userToken(ADMIN_ID, 'admin');
      ctx.cashierToken = userToken(CASHIER_ID, 'cashier');
      ctx.waiterToken = userToken(WAITER_ID, 'waiter');
      ctx.kitchenToken = userToken(KITCHEN_ID, 'kitchen');
    });

    beforeEach(async () => {
      const db = ctx.db!;
      // GET agregatı tüm tenant satırlarını kapsar → her test kendi fixture'ını
      // kurar; ortak durum sıfırlanır (users/tenant korunur).
      await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('agents').where('tenant_id', '=', TENANT_ID).execute();
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('agents').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await db.destroy();
    });

    // ─── fixtures ────────────────────────────────────────────────────────────

    async function insertAgent(opts: {
      declaredKinds?: string[] | null;
      lastSeenAt?: Date | null;
      revokedAt?: Date | null;
      displayName?: string | null;
      tenantId?: string;
    }): Promise<string> {
      const id = randomUUID();
      const tid = opts.tenantId ?? TENANT_ID;
      await ctx.db!
        .insertInto('agents')
        .values({
          id,
          tenant_id: tid,
          device_fingerprint: `fp-${id.slice(0, 8)}`,
          api_key_hash: await bcrypt.hash(`pk_test_${id.slice(0, 6)}`, 4),
          declared_kinds: opts.declaredKinds ?? null,
          last_seen_at: opts.lastSeenAt ?? null,
          revoked_at: opts.revokedAt ?? null,
          display_name: opts.displayName ?? null,
        })
        .execute();
      return id;
    }

    async function insertCategory(opts: {
      kitchenPrint?: boolean;
      printStation?: string | null;
    }): Promise<string> {
      const id = randomUUID();
      await ctx.db!
        .insertInto('categories')
        .values({
          id,
          tenant_id: TENANT_ID,
          name: `Cat-${id.slice(0, 8)}`,
          kitchen_print: opts.kitchenPrint ?? true,
          print_station: opts.printStation ?? null,
        })
        .execute();
      return id;
    }

    /** `print_jobs.status` DB enum'u — Kysely union'ı ile birebir. */
    type JobStatus =
      | 'queued'
      | 'printing'
      | 'success'
      | 'failed'
      | 'cancelled'
      | 'retry';

    async function insertJob(
      kind: string,
      status: JobStatus = 'queued',
    ): Promise<void> {
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          status,
          payload: { kind },
        })
        .execute();
    }

    function getPrinters(token: string): request.Test {
      return request(ctx.app!)
        .get('/printers')
        .set('Authorization', `Bearer ${token}`);
    }

    function agentJwt(agentId: string): string {
      return jwt.sign({ type: 'agent', tid: TENANT_ID }, AGENT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '1h',
        subject: agentId,
        jwtid: randomUUID(),
      });
    }

    // ─── GET /printers — RBAC ────────────────────────────────────────────────

    it('GET admin → 200, { printers, orphanKinds } şekli', async () => {
      const res = await getPrinters(ctx.adminToken!);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.printers)).toBe(true);
      expect(Array.isArray(res.body.data.orphanKinds)).toBe(true);
    });

    it('GET cashier → 403 AUTH_FORBIDDEN', async () => {
      const res = await getPrinters(ctx.cashierToken!);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('GET waiter → 403 AUTH_FORBIDDEN', async () => {
      const res = await getPrinters(ctx.waiterToken!);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('GET kitchen → 403 AUTH_FORBIDDEN', async () => {
      const res = await getPrinters(ctx.kitchenToken!);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('GET no auth → 401 AUTH_TOKEN_INVALID', async () => {
      const res = await request(ctx.app!).get('/printers');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    // ─── GET /printers — durum eşikleri (K10) ────────────────────────────────

    it('durum eşikleri: online/delayed/offline/pending/disabled', async () => {
      const now = Date.now();
      const onlineId = await insertAgent({ lastSeenAt: new Date(now - 10_000) });
      const delayedId = await insertAgent({ lastSeenAt: new Date(now - 2 * 60_000) });
      const offlineId = await insertAgent({ lastSeenAt: new Date(now - 10 * 60_000) });
      const pendingId = await insertAgent({ lastSeenAt: null });
      const disabledId = await insertAgent({
        lastSeenAt: new Date(now - 10_000),
        revokedAt: new Date(now),
      });

      const res = await getPrinters(ctx.adminToken!);
      expect(res.status).toBe(200);
      const byId = new Map<string, string>(
        res.body.data.printers.map((p: { id: string; status: string }) => [
          p.id,
          p.status,
        ]),
      );
      expect(byId.get(onlineId)).toBe('online');
      expect(byId.get(delayedId)).toBe('delayed');
      expect(byId.get(offlineId)).toBe('offline');
      expect(byId.get(pendingId)).toBe('pending');
      expect(byId.get(disabledId)).toBe('disabled');
    });

    it('filterless: declared_kinds NULL + görülmüş → true; pending → false', async () => {
      const seenId = await insertAgent({
        declaredKinds: null,
        lastSeenAt: new Date(),
      });
      const pendingId = await insertAgent({
        declaredKinds: null,
        lastSeenAt: null,
      });
      const res = await getPrinters(ctx.adminToken!);
      const byId = new Map<string, boolean>(
        res.body.data.printers.map((p: { id: string; filterless: boolean }) => [
          p.id,
          p.filterless,
        ]),
      );
      expect(byId.get(seenId)).toBe(true);
      expect(byId.get(pendingId)).toBe(false);
    });

    // ─── GET /printers — kuyruk derinliği + atanmış kategori ──────────────────

    it('queueDepths + assignedCategoryCount: grill yazıcısı', async () => {
      const grillId = await insertAgent({
        declaredKinds: ['grill'],
        lastSeenAt: new Date(),
      });
      await insertJob('grill', 'queued');
      await insertJob('grill', 'failed');
      await insertCategory({ kitchenPrint: true, printStation: 'grill' });
      await insertCategory({ kitchenPrint: true, printStation: 'grill' });

      const res = await getPrinters(ctx.adminToken!);
      const printer = res.body.data.printers.find(
        (p: { id: string }) => p.id === grillId,
      );
      expect(printer.assignedCategoryCount).toBe(2);
      expect(printer.queueDepths).toEqual([
        { kind: 'grill', queued: 1, failed: 1 },
      ]);
    });

    // ─── GET /printers — yetim kuyruk (K10, en yüksek değer) ──────────────────

    it('yetim kuyruk: grill işi var + çevrimiçi grill yazıcı YOK → orphan', async () => {
      // grill agent OFFLINE (10 dk) → grill'i kapsamıyor.
      await insertAgent({
        declaredKinds: ['grill'],
        lastSeenAt: new Date(Date.now() - 10 * 60_000),
      });
      await insertJob('grill', 'queued');

      const res = await getPrinters(ctx.adminToken!);
      expect(res.body.data.orphanKinds).toContain('grill');
    });

    it('yetim kuyruk YOK: grill işi var + çevrimiçi grill yazıcı VAR', async () => {
      await insertAgent({
        declaredKinds: ['grill'],
        lastSeenAt: new Date(),
      });
      await insertJob('grill', 'queued');

      const res = await getPrinters(ctx.adminToken!);
      expect(res.body.data.orphanKinds).not.toContain('grill');
    });

    it('yetim kuyruk YOK: çevrimiçi filtresiz yazıcı tüm türleri kapsar', async () => {
      await insertAgent({ declaredKinds: null, lastSeenAt: new Date() });
      await insertJob('grill', 'queued');
      await insertJob('kitchen', 'failed');

      const res = await getPrinters(ctx.adminToken!);
      expect(res.body.data.orphanKinds).toEqual([]);
    });

    // ─── GET /printers — cross-tenant izolasyon ──────────────────────────────

    it('cross-tenant: başka tenant yazıcısı listede GÖRÜNMEZ', async () => {
      const otherTenantId = randomUUID();
      await ctx.db!
        .insertInto('tenants')
        .values({
          id: otherTenantId,
          name: 'Other Printers Tenant',
          slug: `other-pr-${otherTenantId.slice(0, 8)}`,
        })
        .execute();
      const otherAgentId = await insertAgent({
        lastSeenAt: new Date(),
        tenantId: otherTenantId,
      });
      const ownAgentId = await insertAgent({ lastSeenAt: new Date() });

      const res = await getPrinters(ctx.adminToken!);
      const ids = res.body.data.printers.map((p: { id: string }) => p.id);
      expect(ids).toContain(ownAgentId);
      expect(ids).not.toContain(otherAgentId);

      await ctx.db!.deleteFrom('agents').where('id', '=', otherAgentId).execute();
      await ctx.db!
        .deleteFrom('tenants')
        .where('id', '=', otherTenantId)
        .execute();
    });

    // ─── claim-side declared_kinds gözlem yazımı (K2) ────────────────────────

    it('declared_kinds poll sonrası dolar (?kind=grill → ["grill"])', async () => {
      const agentId = await insertAgent({
        declaredKinds: null,
        lastSeenAt: new Date(),
      });
      const token = agentJwt(agentId);

      // wait=0 → job yok → 204; ama declared_kinds fire-and-forget yazılır.
      const claim = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=0&kind=grill')
        .set('Authorization', `Bearer ${token}`);
      expect(claim.status).toBe(204);

      // fire-and-forget → kısa poll ile bekle.
      let declared: string[] | null = null;
      for (let i = 0; i < 20; i++) {
        const row = await ctx.db!
          .selectFrom('agents')
          .select('declared_kinds')
          .where('id', '=', agentId)
          .executeTakeFirst();
        declared = row?.declared_kinds ?? null;
        if (declared !== null) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(declared).toEqual(['grill']);
    });

    // ─── PATCH /printers/:id — display_name (Dilim A) ────────────────────────

    it('PATCH admin → 200, display_name güncellenir + audit', async () => {
      const id = await insertAgent({ lastSeenAt: new Date() });
      const res = await request(ctx.app!)
        .patch(`/printers/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ displayName: 'Fırın' });
      expect(res.status).toBe(200);
      expect(res.body.data.printer.displayName).toBe('Fırın');

      const row = await ctx.db!
        .selectFrom('agents')
        .select('display_name')
        .where('id', '=', id)
        .executeTakeFirst();
      expect(row!.display_name).toBe('Fırın');

      const audit = await ctx.db!
        .selectFrom('audit_logs')
        .select(['event_type', 'payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'printer.updated')
        .where('entity_id', '=', id)
        .executeTakeFirst();
      expect(audit).toBeDefined();
      const payload = audit!.payload as Record<string, unknown>;
      expect(payload['display_name_after']).toBe('Fırın');
      expect(payload['changed_fields']).toEqual(['display_name']);
    });

    it('PATCH bilinmeyen id → 404 PRINTER_NOT_FOUND', async () => {
      const res = await request(ctx.app!)
        .patch(`/printers/${randomUUID()}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ displayName: 'X' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRINTER_NOT_FOUND');
    });

    it('PATCH boş displayName → 400 VALIDATION_ERROR', async () => {
      const id = await insertAgent({ lastSeenAt: new Date() });
      const res = await request(ctx.app!)
        .patch(`/printers/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ displayName: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH cashier → 403 AUTH_FORBIDDEN', async () => {
      const id = await insertAgent({ lastSeenAt: new Date() });
      const res = await request(ctx.app!)
        .patch(`/printers/${id}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ displayName: 'X' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    // ─── PUT /printers/:id/categories — istasyon atama (Dilim B, K3) ──────────

    it('PUT admin → 200, iki kategori IZGARA istasyonuna atanır + audit', async () => {
      const printerId = await insertAgent({
        declaredKinds: ['grill'],
        lastSeenAt: new Date(),
      });
      const catA = await insertCategory({ kitchenPrint: true });
      const catB = await insertCategory({ kitchenPrint: true });

      const res = await request(ctx.app!)
        .put(`/printers/${printerId}/categories`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ stationKind: 'grill', categoryIds: [catA, catB] });
      expect(res.status).toBe(200);
      expect(res.body.data.assignment.addedCount).toBe(2);
      expect(res.body.data.assignment.removedCount).toBe(0);

      const rows = await ctx.db!
        .selectFrom('categories')
        .select(['id', 'print_station'])
        .where('id', 'in', [catA, catB])
        .execute();
      expect(rows.every((r) => r.print_station === 'grill')).toBe(true);

      const audit = await ctx.db!
        .selectFrom('audit_logs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'printer.categories_assigned')
        .where('entity_id', '=', printerId)
        .executeTakeFirst();
      expect(audit).toBeDefined();
      const payload = audit!.payload as Record<string, unknown>;
      expect(payload['station_kind']).toBe('grill');
      expect(payload['added_count']).toBe(2);
      expect((payload['added_category_ids'] as string[]).sort()).toEqual(
        [catA, catB].sort(),
      );
    });

    it('PUT istasyon-kapsamlı diff: listeden çıkan kategori → NULL (taban)', async () => {
      const printerId = await insertAgent({
        declaredKinds: ['grill'],
        lastSeenAt: new Date(),
      });
      const catA = await insertCategory({ kitchenPrint: true, printStation: 'grill' });
      const catB = await insertCategory({ kitchenPrint: true, printStation: 'grill' });

      // Yalnız catA gönder → catB istasyondan düşer (NULL).
      const res = await request(ctx.app!)
        .put(`/printers/${printerId}/categories`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ stationKind: 'grill', categoryIds: [catA] });
      expect(res.status).toBe(200);
      expect(res.body.data.assignment.removedCount).toBe(1);

      const rowB = await ctx.db!
        .selectFrom('categories')
        .select('print_station')
        .where('id', '=', catB)
        .executeTakeFirst();
      expect(rowB!.print_station).toBeNull();
    });

    it('PUT boş liste → istasyon temizlenir (tümü NULL)', async () => {
      const printerId = await insertAgent({ lastSeenAt: new Date() });
      const catA = await insertCategory({ kitchenPrint: true, printStation: 'grill' });

      const res = await request(ctx.app!)
        .put(`/printers/${printerId}/categories`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ stationKind: 'grill', categoryIds: [] });
      expect(res.status).toBe(200);
      expect(res.body.data.assignment.removedCount).toBe(1);

      const rowA = await ctx.db!
        .selectFrom('categories')
        .select('print_station')
        .where('id', '=', catA)
        .executeTakeFirst();
      expect(rowA!.print_station).toBeNull();
    });

    it('PUT geçersiz stationKind (bill) → 400 VALIDATION_ERROR', async () => {
      const printerId = await insertAgent({ lastSeenAt: new Date() });
      const catA = await insertCategory({ kitchenPrint: true });
      const res = await request(ctx.app!)
        .put(`/printers/${printerId}/categories`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ stationKind: 'bill', categoryIds: [catA] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PUT kitchen_print=false kategori → 409 PRINTER_CATEGORY_NOT_KITCHEN', async () => {
      const printerId = await insertAgent({ lastSeenAt: new Date() });
      const catNoKitchen = await insertCategory({ kitchenPrint: false });
      const res = await request(ctx.app!)
        .put(`/printers/${printerId}/categories`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ stationKind: 'grill', categoryIds: [catNoKitchen] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PRINTER_CATEGORY_NOT_KITCHEN');
    });

    it('PUT bilinmeyen kategori → 404 MENU_CATEGORY_NOT_FOUND', async () => {
      const printerId = await insertAgent({ lastSeenAt: new Date() });
      const res = await request(ctx.app!)
        .put(`/printers/${printerId}/categories`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ stationKind: 'grill', categoryIds: [randomUUID()] });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MENU_CATEGORY_NOT_FOUND');
    });

    it('PUT bilinmeyen yazıcı → 404 PRINTER_NOT_FOUND', async () => {
      const catA = await insertCategory({ kitchenPrint: true });
      const res = await request(ctx.app!)
        .put(`/printers/${randomUUID()}/categories`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ stationKind: 'grill', categoryIds: [catA] });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRINTER_NOT_FOUND');
    });

    it('PUT cashier → 403 AUTH_FORBIDDEN', async () => {
      const printerId = await insertAgent({ lastSeenAt: new Date() });
      const res = await request(ctx.app!)
        .put(`/printers/${printerId}/categories`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ stationKind: 'grill', categoryIds: [] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });
  },
);
