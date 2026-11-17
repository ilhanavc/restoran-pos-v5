/**
 * ADR-045 PR-2 — `/settings/receipt` uçları (GET/PUT/test-print).
 *
 * Gerçek DB; uygulama `app_tenant` (NOBYPASSRLS) altında koşar, fixture ve
 * temizlik superuser havuzuyla ([[feedback_rls_test_harness_app_tenant_role]]).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { createAppTenantPool } from './helpers/appTenantPool';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();
const ADMIN = { id: randomUUID(), email: `admin-${randomUUID()}@example.com`, password: 'adminpass1234' };
const CASHIER = { id: randomUUID(), email: `cashier-${randomUUID()}@example.com`, password: 'cashierpass1234' };

interface Ctx {
  pool: Pool;
  db: Kysely<DB>;
  appDb: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
  printerId: string;
  revokedPrinterId: string;
  otherTenantPrinterId: string;
}
const ctx: Partial<Ctx> = {};

async function login(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return res.body.accessToken as string;
}

async function insertAgent(
  db: Kysely<DB>,
  tenantId: string,
  revokedAt: Date | null = null,
): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('agents')
    .values({
      id,
      tenant_id: tenantId,
      device_fingerprint: `fp-rcpt-${id.slice(0, 8)}`,
      api_key_hash: `hash-${id.slice(0, 8)}`,
      revoked_at: revokedAt,
    })
    .execute();
  return id;
}

const VALID_BODY = {
  receiptHeaderLines: ['Atatürk Cad. No: 12', 'Tel: 0212 000 00 00'],
  receiptFooterLines: ['Yine bekleriz!'],
  packingAutoPrintEnabled: false,
};

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-045 PR-2 — /settings/receipt (gerçek DB, app_tenant)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      const appDb = createKysely(createAppTenantPool(DB_URL ?? ''));
      ctx.pool = pool;
      ctx.db = db;
      ctx.appDb = appDb;
      ctx.app = buildApp({
        pool: createAppTenantPool(DB_URL ?? ''),
        db: appDb,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          { id: TENANT_ID, name: 'Fiş Ayarı Test', slug: `rcpt-${TENANT_ID.slice(0, 8)}` },
          { id: OTHER_TENANT_ID, name: 'Başka İşletme', slug: `rcpt-o-${OTHER_TENANT_ID.slice(0, 8)}` },
        ])
        .execute();
      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: TENANT_ID }, { tenant_id: OTHER_TENANT_ID }])
        .execute();
      await db
        .insertInto('users')
        .values([
          {
            id: ADMIN.id,
            tenant_id: TENANT_ID,
            email: ADMIN.email,
            username: `adm-${ADMIN.id.slice(0, 8)}`,
            password_hash: await hashPassword(ADMIN.password),
            role: 'admin',
          },
          {
            id: CASHIER.id,
            tenant_id: TENANT_ID,
            email: CASHIER.email,
            username: `csh-${CASHIER.id.slice(0, 8)}`,
            password_hash: await hashPassword(CASHIER.password),
            role: 'cashier',
          },
        ])
        .execute();

      ctx.printerId = await insertAgent(db, TENANT_ID);
      ctx.revokedPrinterId = await insertAgent(db, TENANT_ID, new Date());
      ctx.otherTenantPrinterId = await insertAgent(db, OTHER_TENANT_ID);

      ctx.adminToken = await login(ctx.app, ADMIN.email, ADMIN.password);
      ctx.cashierToken = await login(ctx.app, CASHIER.email, CASHIER.password);
    });

    beforeEach(async () => {
      await ctx.db!
        .updateTable('tenant_settings')
        .set({
          receipt_header_lines: null,
          receipt_footer_lines: null,
          packing_auto_print_enabled: true,
        })
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db!.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
      await ctx.db!.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      const ids = [TENANT_ID, OTHER_TENANT_ID];
      await db.deleteFrom('print_jobs').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('orders').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('agents').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('refresh_tokens').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('audit_logs').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('users').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('tenants').where('id', 'in', ids).execute();
      await ctx.appDb?.destroy();
      await db.destroy();
    });

    const admin = () => ({ Authorization: `Bearer ${ctx.adminToken!}` });
    const cashier = () => ({ Authorization: `Bearer ${ctx.cashierToken!}` });

    // ── Yetki (K2) ────────────────────────────────────────────────────
    it('kasiyerin GET /settings yanıtında fiş alanları YOK', async () => {
      const res = await request(ctx.app!).get('/settings').set(cashier());
      expect(res.status).toBe(200);
      expect(res.body.data.settings).not.toHaveProperty('receiptHeaderLines');
      expect(res.body.data.settings).not.toHaveProperty('receiptFooterLines');
      expect(res.body.data.settings).not.toHaveProperty('packingAutoPrintEnabled');
    });

    it('kasiyer: GET/PUT/test-print → 403', async () => {
      const get = await request(ctx.app!).get('/settings/receipt').set(cashier());
      const put = await request(ctx.app!).put('/settings/receipt').set(cashier()).send(VALID_BODY);
      const post = await request(ctx.app!).post('/settings/receipt/test-print').set(cashier()).send({});
      expect([get.status, put.status, post.status]).toEqual([403, 403, 403]);
    });

    // ── Okuma / yazma ─────────────────────────────────────────────────
    it('GET admin → varsayılan: null/null/true', async () => {
      const res = await request(ctx.app!).get('/settings/receipt').set(admin());
      expect(res.status).toBe(200);
      expect(res.body.data.receipt).toEqual({
        receiptHeaderLines: null,
        receiptFooterLines: null,
        packingAutoPrintEnabled: true,
      });
    });

    it('PUT → kalıcı + audit satırı before/after ile', async () => {
      const put = await request(ctx.app!).put('/settings/receipt').set(admin()).send(VALID_BODY);
      expect(put.status).toBe(200);
      expect(put.body.data.receipt).toEqual(VALID_BODY);

      const get = await request(ctx.app!).get('/settings/receipt').set(admin());
      expect(get.body.data.receipt).toEqual(VALID_BODY);

      const audits = await ctx.db!
        .selectFrom('audit_logs')
        .select(['event_type', 'payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      expect(audits).toHaveLength(1);
      expect(audits[0]!.event_type).toBe('tenant_settings.receipt_updated');
      expect(audits[0]!.payload).toMatchObject({
        changed_fields: ['receiptHeaderLines', 'receiptFooterLines', 'packingAutoPrintEnabled'],
        receipt_header_lines_before: null,
        receipt_header_lines_after: VALID_BODY.receiptHeaderLines,
        receipt_footer_lines_after: VALID_BODY.receiptFooterLines,
        packing_auto_print_enabled_before: true,
        packing_auto_print_enabled_after: false,
      });
    });

    it('alt bilgi [] (hiç basma) ile null (varsayılan) ayrı saklanır', async () => {
      await request(ctx.app!)
        .put('/settings/receipt')
        .set(admin())
        .send({ receiptHeaderLines: null, receiptFooterLines: [], packingAutoPrintEnabled: true })
        .expect(200);
      const row = await ctx.db!
        .selectFrom('tenant_settings')
        .select(['receipt_header_lines', 'receipt_footer_lines'])
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();
      expect(row.receipt_header_lines).toBeNull();
      expect(row.receipt_footer_lines).toEqual([]);
    });

    it('varsayılana dön (null) satırı SİLMEZ ve sipariş girişi çalışır (K9, mig 028)', async () => {
      await request(ctx.app!).put('/settings/receipt').set(admin()).send(VALID_BODY).expect(200);
      await request(ctx.app!)
        .put('/settings/receipt')
        .set(admin())
        .send({ receiptHeaderLines: null, receiptFooterLines: null, packingAutoPrintEnabled: true })
        .expect(200);

      const count = await ctx.db!
        .selectFrom('tenant_settings')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();
      expect(Number(count.n)).toBe(1);

      // mig 028 tetikleyicisi tenant_settings satırı yoksa INSERT'i durdurur.
      await ctx.db!
        .insertInto('orders')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          order_no: 1,
          store_date: '2026-11-17',
          order_type: 'dine_in',
          status: 'open',
          total_cents: 0,
        })
        .execute();
    });

    // ── Doğrulama (K6) ────────────────────────────────────────────────
    it.each([
      ['satır çok uzun (41 karakter)', { receiptHeaderLines: ['a'.repeat(41)] }],
      ['çok fazla satır (5)', { receiptFooterLines: ['a', 'b', 'c', 'd', 'e'] }],
      ['ESC baytı', { receiptHeaderLines: ['abc\u001b@'] }],
      ['satır sonu satır içinde', { receiptHeaderLines: ['iki\nsatır'] }],
      ['boş satır', { receiptHeaderLines: ['   '] }],
      ['bilinmeyen alan', { extra: true }],
    ])('400: %s — sessiz kırpma yok, değer değişmez', async (_label, patch) => {
      const res = await request(ctx.app!)
        .put('/settings/receipt')
        .set(admin())
        .send({ ...VALID_BODY, ...patch });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const row = await ctx.db!
        .selectFrom('tenant_settings')
        .select(['receipt_header_lines'])
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();
      expect(row.receipt_header_lines).toBeNull();
    });

    it('ayrışık "ğ" (g + birleşen breve) kabul edilir ve NFC kaydedilir', async () => {
      const decomposed = 'Doğan Pide';
      const res = await request(ctx.app!)
        .put('/settings/receipt')
        .set(admin())
        .send({ ...VALID_BODY, receiptHeaderLines: [decomposed] });
      expect(res.status).toBe(200);
      expect(res.body.data.receipt.receiptHeaderLines).toEqual(['Doğan Pide']);
    });

    // ── Deneme fişi (K7) ──────────────────────────────────────────────
    it('test-print → 202, kind=bill, hedef yazıcıya, sipariş oluşmaz', async () => {
      const ordersBefore = await ctx.db!
        .selectFrom('orders')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();

      const res = await request(ctx.app!)
        .post('/settings/receipt/test-print')
        .set(admin())
        .send({ targetPrinterId: ctx.printerId });
      expect(res.status).toBe(202);

      const jobs = await ctx.db!
        .selectFrom('print_jobs')
        .select(['target_agent_id', 'payload', 'status'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.target_agent_id).toBe(ctx.printerId);
      expect(jobs[0]!.status).toBe('queued');
      const payload = jobs[0]!.payload as { kind: string; meta: Record<string, unknown> };
      expect(payload.kind).toBe('bill');
      expect(payload.meta['test']).toBe(true);
      expect(payload.meta).not.toHaveProperty('orderId');

      const ordersAfter = await ctx.db!
        .selectFrom('orders')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();
      expect(ordersAfter.n).toBe(ordersBefore.n);
    });

    it('test-print başka işletmenin yazıcısı → 404, iş yazılmaz', async () => {
      const res = await request(ctx.app!)
        .post('/settings/receipt/test-print')
        .set(admin())
        .send({ targetPrinterId: ctx.otherTenantPrinterId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRINTER_NOT_FOUND');
      const jobs = await ctx.db!
        .selectFrom('print_jobs')
        .select('id')
        .where('tenant_id', 'in', [TENANT_ID, OTHER_TENANT_ID])
        .execute();
      expect(jobs).toHaveLength(0);
    });

    it('test-print devre dışı yazıcı → 409', async () => {
      const res = await request(ctx.app!)
        .post('/settings/receipt/test-print')
        .set(admin())
        .send({ targetPrinterId: ctx.revokedPrinterId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PRINTER_REVOKED');
    });
  },
);
