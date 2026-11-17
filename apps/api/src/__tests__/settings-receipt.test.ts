/**
 * ADR-045 PR-2 — `/settings/receipt` uçları (GET/PUT/test-print).
 *
 * Gerçek DB; uygulama `app_tenant` (NOBYPASSRLS) altında koşar, fixture ve
 * temizlik superuser havuzuyla ([[feedback_rls_test_harness_app_tenant_role]]).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { createAppTenantPool } from './helpers/appTenantPool';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { ReceiptCanvas } from '../print/raster/canvas-render.js';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();
const ADMIN = { id: randomUUID(), email: `admin-${randomUUID()}@example.com`, password: 'adminpass1234' };
const CASHIER = { id: randomUUID(), email: `cashier-${randomUUID()}@example.com`, password: 'cashierpass1234' };
const WAITER = { id: randomUUID(), email: `waiter-${randomUUID()}@example.com`, password: 'waiterpass1234' };
const KITCHEN = { id: randomUUID(), email: `kitchen-${randomUUID()}@example.com`, password: 'kitchenpass1234' };

interface Ctx {
  pool: Pool;
  db: Kysely<DB>;
  appDb: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
  waiterToken: string;
  kitchenToken: string;
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
          {
            id: WAITER.id,
            tenant_id: TENANT_ID,
            email: WAITER.email,
            username: `wtr-${WAITER.id.slice(0, 8)}`,
            password_hash: await hashPassword(WAITER.password),
            role: 'waiter',
          },
          {
            id: KITCHEN.id,
            tenant_id: TENANT_ID,
            email: KITCHEN.email,
            username: `ktc-${KITCHEN.id.slice(0, 8)}`,
            password_hash: await hashPassword(KITCHEN.password),
            role: 'kitchen',
          },
        ])
        .execute();

      ctx.printerId = await insertAgent(db, TENANT_ID);
      ctx.revokedPrinterId = await insertAgent(db, TENANT_ID, new Date());
      ctx.otherTenantPrinterId = await insertAgent(db, OTHER_TENANT_ID);

      ctx.adminToken = await login(ctx.app, ADMIN.email, ADMIN.password);
      ctx.cashierToken = await login(ctx.app, CASHIER.email, CASHIER.password);
      ctx.waiterToken = await login(ctx.app, WAITER.email, WAITER.password);
      ctx.kitchenToken = await login(ctx.app, KITCHEN.email, KITCHEN.password);
    });

    afterEach(() => {
      vi.restoreAllMocks();
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
    const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

    /** Bu işletmenin üç fiş kolonu + audit satır sayısı (değişmezlik iddiaları için). */
    async function snapshot(): Promise<{
      header: string[] | null;
      footer: string[] | null;
      packing: boolean;
      audits: number;
    }> {
      const row = await ctx.db!
        .selectFrom('tenant_settings')
        .select(['receipt_header_lines', 'receipt_footer_lines', 'packing_auto_print_enabled'])
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();
      const audits = await ctx.db!
        .selectFrom('audit_logs')
        .select('id')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      return {
        header: row.receipt_header_lines,
        footer: row.receipt_footer_lines,
        packing: row.packing_auto_print_enabled,
        audits: audits.length,
      };
    }
    const UNTOUCHED = { header: null, footer: null, packing: true, audits: 0 };

    /** İstek süresince `centered` ile çizilen metinler (fiş raster; bayt okunamaz). */
    function recordCentered(): string[] {
      const out: string[] = [];
      const original = ReceiptCanvas.prototype.centered;
      vi.spyOn(ReceiptCanvas.prototype, 'centered').mockImplementation(function (
        this: ReceiptCanvas,
        text: string,
        opts: { size: number; bold?: boolean },
      ) {
        out.push(text);
        return original.call(this, text, opts);
      });
      return out;
    }

    // ── Yetki (K2) ────────────────────────────────────────────────────
    it('kasiyerin GET /settings yanıtında fiş alanları YOK', async () => {
      const res = await request(ctx.app!).get('/settings').set(cashier());
      expect(res.status).toBe(200);
      expect(res.body.data.settings).not.toHaveProperty('receiptHeaderLines');
      expect(res.body.data.settings).not.toHaveProperty('receiptFooterLines');
      expect(res.body.data.settings).not.toHaveProperty('packingAutoPrintEnabled');
    });

    describe.each([
      ['kasiyer', () => ctx.cashierToken!],
      ['garson', () => ctx.waiterToken!],
      ['mutfak', () => ctx.kitchenToken!],
    ])('%s → 403, hiçbir şey değişmez', (_role, token) => {
      it('GET /settings/receipt', async () => {
        await request(ctx.app!).get('/settings/receipt').set(bearer(token())).expect(403);
      });
      it('PUT /settings/receipt', async () => {
        await request(ctx.app!).put('/settings/receipt').set(bearer(token())).send(VALID_BODY).expect(403);
        expect(await snapshot()).toEqual(UNTOUCHED);
      });
      it('POST /settings/receipt/test-print', async () => {
        await request(ctx.app!).post('/settings/receipt/test-print').set(bearer(token())).send({}).expect(403);
        const jobs = await ctx.db!.selectFrom('print_jobs').select('id').where('tenant_id', '=', TENANT_ID).execute();
        expect(jobs).toHaveLength(0);
      });
    });

    it('jetonsuz → üç uçta da 401', async () => {
      await request(ctx.app!).get('/settings/receipt').expect(401);
      await request(ctx.app!).put('/settings/receipt').send(VALID_BODY).expect(401);
      await request(ctx.app!).post('/settings/receipt/test-print').send({}).expect(401);
      expect(await snapshot()).toEqual(UNTOUCHED);
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
    // 🔴 K6.4 — POZİTİF izin listesi: yalnız ESC değil, her kontrol/dışı karakter
    // sınıfı reddedilmeli (yalnız ESC'yi yakalayan negatif bir desen bu tabloyu geçemez).
    it.each([
      ['satır çok uzun (41 karakter)', { receiptHeaderLines: ['a'.repeat(41)] }],
      ['çok fazla üst satır (5)', { receiptHeaderLines: ['a', 'b', 'c', 'd', 'e'] }],
      ['çok fazla alt satır (5)', { receiptFooterLines: ['a', 'b', 'c', 'd', 'e'] }],
      ['ESC baytı', { receiptHeaderLines: ['abc\u001b@'] }],
      ['GS baytı', { receiptHeaderLines: ['abc\u001dV'] }],
      ['NUL', { receiptHeaderLines: ['abc\u0000'] }],
      ['DEL', { receiptHeaderLines: ['abc\u007f'] }],
      ['satır sonu (LF)', { receiptHeaderLines: ['iki\nsatır'] }],
      ['satır başı (CR)', { receiptHeaderLines: ['iki\rsatır'] }],
      ['sekme', { receiptHeaderLines: ['a\tb'] }],
      ['NEL (U+0085)', { receiptHeaderLines: ['a\u0085b'] }],
      ['emoji', { receiptFooterLines: ['Afiyet \u{1F355}'] }],
      ['Kiril', { receiptFooterLines: ['Пиде'] }],
      ['sıfır genişlikli boşluk', { receiptHeaderLines: ['a​b'] }],
      ['boş satır', { receiptHeaderLines: [''] }],
      ['yalnız boşluk', { receiptHeaderLines: ['   '] }],
      ['bilinmeyen alan', { extra: true }],
      ['alan eksik (TAM değiştirme)', { packingAutoPrintEnabled: undefined }],
    ])('400: %s — sessiz kırpma yok, hiçbir şey değişmez, audit yok', async (_label, patch) => {
      const res = await request(ctx.app!)
        .put('/settings/receipt')
        .set(admin())
        .send({ ...VALID_BODY, ...patch });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await snapshot()).toEqual(UNTOUCHED);
    });

    it('sınırdaki geçerli girdi kabul: tam 40 karakter, 4+4 satır, tüm Türkçe harfler, ₺', async () => {
      const body = {
        receiptHeaderLines: ['a'.repeat(40), 'ğüşıöçĞÜŞİÖÇ', 'Tel: (0212) 555-44-33', 'www.ornek.com.tr'],
        receiptFooterLines: ['Toplam 100,00 ₺', 'Bize yazin: info@ornek.com', '%10 indirim!', '#1 pide'],
        packingAutoPrintEnabled: true,
      };
      const res = await request(ctx.app!).put('/settings/receipt').set(admin()).send(body);
      expect(res.status).toBe(200);
      expect(res.body.data.receipt).toEqual(body);
    });

    it('ayrışık "ğ" (g + birleşen breve) kabul edilir ve NFC kaydedilir', async () => {
      const decomposed = 'Doğan Pide';
      const res = await request(ctx.app!)
        .put('/settings/receipt')
        .set(admin())
        .send({ ...VALID_BODY, receiptHeaderLines: [decomposed] });
      expect(res.status).toBe(200);
      // Beklenen değer kaçış diziyle yazıldı: editör kaynağı NFC'ye çevirse de anlamı kalır.
      expect(res.body.data.receipt.receiptHeaderLines).toEqual(['Doğan Pide']);
    });

    it('PUT başka işletmenin satırına dokunmaz', async () => {
      await request(ctx.app!).put('/settings/receipt').set(admin()).send(VALID_BODY).expect(200);
      const other = await ctx.db!
        .selectFrom('tenant_settings')
        .select(['receipt_header_lines', 'receipt_footer_lines', 'packing_auto_print_enabled'])
        .where('tenant_id', '=', OTHER_TENANT_ID)
        .executeTakeFirstOrThrow();
      expect(other).toEqual({
        receipt_header_lines: null,
        receipt_footer_lines: null,
        packing_auto_print_enabled: true,
      });
    });

    it('değişiklik yapmayan PUT → 200 ve audit yine yazılır, changed_fields boş', async () => {
      await request(ctx.app!)
        .put('/settings/receipt')
        .set(admin())
        .send({ receiptHeaderLines: null, receiptFooterLines: null, packingAutoPrintEnabled: true })
        .expect(200);
      const audits = await ctx.db!
        .selectFrom('audit_logs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      expect(audits).toHaveLength(1);
      expect((audits[0]!.payload as { changed_fields: unknown }).changed_fields).toEqual([]);
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
      expect(Number(ordersAfter.n)).toBe(Number(ordersBefore.n));
    });

    it('test-print KAYITLI metni basar: işaret + kayıtlı üst/alt satırlar, gömülü kapanış yok', async () => {
      await request(ctx.app!).put('/settings/receipt').set(admin()).send(VALID_BODY).expect(200);
      const drawn = recordCentered();
      await request(ctx.app!)
        .post('/settings/receipt/test-print')
        .set(admin())
        .send({ targetPrinterId: ctx.printerId })
        .expect(202);
      expect(drawn[0]).toBe('*** DENEME FİŞİ ***');
      expect(drawn).toEqual(expect.arrayContaining([...VALID_BODY.receiptHeaderLines, ...VALID_BODY.receiptFooterLines]));
      expect(drawn).not.toContain('Afiyet olsun');
    });

    it('test-print ayar NULL iken varsayılan metni basar', async () => {
      const drawn = recordCentered();
      await request(ctx.app!).post('/settings/receipt/test-print').set(admin()).send({}).expect(202);
      expect(drawn[0]).toBe('*** DENEME FİŞİ ***');
      expect(drawn.slice(-2)).toEqual(['Afiyet olsun', 'Teşekkür ederiz']);
    });

    it('test-print hedefsiz → iş target_agent_id NULL ile kuyrukta', async () => {
      await request(ctx.app!).post('/settings/receipt/test-print').set(admin()).send({}).expect(202);
      const jobs = await ctx.db!
        .selectFrom('print_jobs')
        .select(['target_agent_id'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      expect(jobs).toEqual([{ target_agent_id: null }]);
    });

    it('test-print bozuk yazıcı kimliği → 400', async () => {
      await request(ctx.app!)
        .post('/settings/receipt/test-print')
        .set(admin())
        .send({ targetPrinterId: 'yazici-1' })
        .expect(400);
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

    // ⚠️ SON test olarak kalmalı: sınırlayıcı süreç içi ve dakikalık; kendisinden
    // sonra koşan bir test-print testi 429 alırdı.
    it('test-print işletme başına dakikada 10 → sonrası 429, iş yazılmaz', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        const res = await request(ctx.app!).post('/settings/receipt/test-print').set(admin()).send({});
        statuses.push(res.status);
        if (res.status === 429) {
          expect(res.body.error.code).toBe('RECEIPT_TEST_PRINT_RATE_LIMITED');
          break;
        }
      }
      expect(statuses.at(-1)).toBe(429);
      const jobsBefore = (
        await ctx.db!.selectFrom('print_jobs').select('id').where('tenant_id', '=', TENANT_ID).execute()
      ).length;
      await request(ctx.app!).post('/settings/receipt/test-print').set(admin()).send({}).expect(429);
      const jobsAfter = (
        await ctx.db!.selectFrom('print_jobs').select('id').where('tenant_id', '=', TENANT_ID).execute()
      ).length;
      expect(jobsAfter).toBe(jobsBefore);
    });
  },
);
