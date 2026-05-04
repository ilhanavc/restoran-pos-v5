import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  createPool,
  createKysely,
  type DB,
} from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TENANT_B_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-${randomUUID()}@example.com`;
const CASHIER_USERNAME = `cashier-${randomUUID().slice(0, 8)}`;
const CASHIER_PASSWORD = 'cashierpass1234';

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-${randomUUID()}@example.com`;
const WAITER_USERNAME = `waiter-${randomUUID().slice(0, 8)}`;
const WAITER_PASSWORD = 'waiterpass1234';

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
  waiterToken: string;
}

const ctx: Partial<TestCtx> = {};

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)} [email=${email}]`);
  }
  return res.body.accessToken as string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  '/customers integration',
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
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_ID,
            name: 'Test Tenant Customers',
            slug: `test-customers-${TENANT_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'Test Tenant B',
            slug: `test-customers-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('tenant_settings')
        .values([
          { tenant_id: TENANT_ID },
          { tenant_id: TENANT_B_ID },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      const cashierHash = await hashPassword(CASHIER_PASSWORD);
      const waiterHash = await hashPassword(WAITER_PASSWORD);

      await db
        .insertInto('users')
        .values([
          {
            id: ADMIN_ID,
            tenant_id: TENANT_ID,
            email: ADMIN_EMAIL,
            username: ADMIN_USERNAME,
            password_hash: adminHash,
            role: 'admin',
          },
          {
            id: CASHIER_ID,
            tenant_id: TENANT_ID,
            email: CASHIER_EMAIL,
            username: CASHIER_USERNAME,
            password_hash: cashierHash,
            role: 'cashier',
          },
          {
            id: WAITER_ID,
            tenant_id: TENANT_ID,
            email: WAITER_EMAIL,
            username: WAITER_USERNAME,
            password_hash: waiterHash,
            role: 'waiter',
          },
        ])
        .execute();

      ctx.adminToken = await loginAndGetToken(
        ctx.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      );
      ctx.cashierToken = await loginAndGetToken(
        ctx.app,
        CASHIER_EMAIL,
        CASHIER_PASSWORD,
      );
      ctx.waiterToken = await loginAndGetToken(
        ctx.app,
        WAITER_EMAIL,
        WAITER_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        for (const tid of [TENANT_ID, TENANT_B_ID]) {
          await ctx.db
            .deleteFrom('refresh_tokens')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('call_logs')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('customer_phones')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('customer_addresses')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('customers')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('audit_logs')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('users')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('tenant_settings')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('tenants')
            .where('id', '=', tid)
            .execute();
        }
        await ctx.db.destroy();
      }
    });

    // Yardımcı: unique telefon üretir (test başına kollizyon olmasın)
    function uniquePhone(): string {
      // 05[3-9]XXXXXXXX format. randomUUID hex'in son 8 karakteri 0-9 dışı
      // olabilir → sadece digit havuzu kullan.
      const digits = '0123456789';
      let suffix = '';
      for (let i = 0; i < 8; i++) {
        suffix += digits[Math.floor(Math.random() * 10)];
      }
      return `0539${suffix}`;
    }

    it('POST /customers happy → 201 + body shape', async () => {
      const phone = uniquePhone();
      const res = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Ahmet Yilmaz',
          phones: [{ rawPhone: phone, isPrimary: true }],
          addresses: [],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeTruthy();
      expect(res.body.data.fullName).toBe('Ahmet Yilmaz');
      expect(res.body.data.tenantId).toBe(TENANT_ID);
      expect(Array.isArray(res.body.data.phones)).toBe(true);
      expect(res.body.data.phones[0].normalizedPhone).toBe(phone);
      expect(res.body.data.isBlacklisted).toBe(false);
    });

    it('POST /customers UNIQUE phone → 409 PHONE_ALREADY_EXISTS', async () => {
      const phone = uniquePhone();
      const first = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Mehmet One',
          phones: [{ rawPhone: phone, isPrimary: true }],
        });
      expect(first.status).toBe(201);

      const dup = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Mehmet Two',
          phones: [{ rawPhone: phone, isPrimary: true }],
        });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('PHONE_ALREADY_EXISTS');
    });

    it('GET /customers/:id → detail (phones, addresses)', async () => {
      const phone = uniquePhone();
      const created = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Detay Musteri',
          phones: [{ rawPhone: phone, isPrimary: true }],
          addresses: [
            {
              title: 'Ev',
              addressLine: 'Atatürk Cad. No:5',
              isDefault: true,
            },
          ],
        });
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;

      const res = await request(ctx.app!)
        .get(`/customers/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(id);
      expect(res.body.data.phones.length).toBeGreaterThan(0);
      expect(res.body.data.addresses.length).toBeGreaterThan(0);
    });

    it('GET /customers/:id başka tenant müşterisi → 404', async () => {
      // tenant B'de müşteri oluştur
      const phone = uniquePhone();
      const otherCustomerId = randomUUID();
      await ctx.db!
        .insertInto('customers')
        .values({
          id: otherCustomerId,
          tenant_id: TENANT_B_ID,
          full_name: 'Other Tenant Müşteri',
          note: null,
        })
        .execute();
      await ctx.db!
        .insertInto('customer_phones')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_B_ID,
          customer_id: otherCustomerId,
          raw_phone: phone,
          normalized_phone: phone,
          is_primary: true,
          is_mobile: true,
        })
        .execute();

      const res = await request(ctx.app!)
        .get(`/customers/${otherCustomerId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('PATCH /customers/:id/blacklist admin reason ile → 200', async () => {
      const phone = uniquePhone();
      const created = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Blacklist Test',
          phones: [{ rawPhone: phone, isPrimary: true }],
        });
      expect(created.status).toBe(201);

      const res = await request(ctx.app!)
        .patch(`/customers/${created.body.data.id}/blacklist`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ isBlacklisted: true, blacklistReason: 'tekrarlayan iptal' });
      expect(res.status).toBe(200);
      expect(res.body.data.isBlacklisted).toBe(true);
      expect(res.body.data.blacklistReason).toBe('tekrarlayan iptal');
    });

    it('PATCH /customers/:id/blacklist admin reason yok → 400', async () => {
      const phone = uniquePhone();
      const created = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Blacklist NoReason',
          phones: [{ rawPhone: phone, isPrimary: true }],
        });
      expect(created.status).toBe(201);

      const res = await request(ctx.app!)
        .patch(`/customers/${created.body.data.id}/blacklist`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ isBlacklisted: true });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH /customers/:id/blacklist waiter rolü → 403', async () => {
      const phone = uniquePhone();
      const created = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Forbidden Test',
          phones: [{ rawPhone: phone, isPrimary: true }],
        });
      expect(created.status).toBe(201);

      const res = await request(ctx.app!)
        .patch(`/customers/${created.body.data.id}/blacklist`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ isBlacklisted: true, blacklistReason: 'sebep' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('POST /customers/:id/addresses → 201', async () => {
      const phone = uniquePhone();
      const created = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Address Add',
          phones: [{ rawPhone: phone, isPrimary: true }],
        });
      expect(created.status).toBe(201);

      const res = await request(ctx.app!)
        .post(`/customers/${created.body.data.id}/addresses`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          title: 'İş',
          addressLine: 'Cumhuriyet Mh. No:7',
          isDefault: false,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.address.title).toBe('İş');
      expect(res.body.data.address.addressLine).toBe('Cumhuriyet Mh. No:7');
    });

    it('DELETE /customers/:id/addresses/:addressId → soft delete', async () => {
      const phone = uniquePhone();
      const created = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Address Soft Delete',
          phones: [{ rawPhone: phone, isPrimary: true }],
          addresses: [
            { title: 'Ev', addressLine: 'Test sokak No:1', isDefault: true },
          ],
        });
      expect(created.status).toBe(201);
      const customerId = created.body.data.id as string;
      const addressId = created.body.data.addresses[0].id as string;

      const res = await request(ctx.app!)
        .delete(`/customers/${customerId}/addresses/${addressId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(204);

      // DB'de is_deleted=true (veya deleted_at NOT NULL); şema flag farkı olabilir.
      const row = await ctx.db!
        .selectFrom('customer_addresses')
        .selectAll()
        .where('id', '=', addressId)
        .executeTakeFirst();
      expect(row).toBeDefined();
      // is_deleted bool kullanan şemada o; deleted_at varyantı için fallback.
      const r = row as Record<string, unknown>;
      const softDeleted =
        r['is_deleted'] === true ||
        (r['deleted_at'] !== null && r['deleted_at'] !== undefined);
      expect(softDeleted).toBe(true);
    });

    it('GET /customers/search ?search=isim → match', async () => {
      const phone = uniquePhone();
      const uniqueName = `Aragondo${randomUUID().slice(0, 6)}`;
      const created = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: uniqueName,
          phones: [{ rawPhone: phone, isPrimary: true }],
        });
      expect(created.status).toBe(201);

      const res = await request(ctx.app!)
        .get(`/customers/search?search=${encodeURIComponent(uniqueName.slice(0, 5))}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.customers as Array<{ id: string }>).map(
        (c) => c.id,
      );
      expect(ids).toContain(created.body.data.id);
    });

    it('GET /customers/search ?search=05551234567 telefon → match', async () => {
      const phone = uniquePhone();
      const created = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Telefon Match',
          phones: [{ rawPhone: phone, isPrimary: true }],
        });
      expect(created.status).toBe(201);

      const res = await request(ctx.app!)
        .get(`/customers/search?search=${phone}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.customers as Array<{ id: string }>).map(
        (c) => c.id,
      );
      expect(ids).toContain(created.body.data.id);
    });

    it('DELETE /customers/bulk admin → 200, manuel CASCADE doğrula', async () => {
      const phone1 = uniquePhone();
      const phone2 = uniquePhone();
      const c1 = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Bulk One',
          phones: [{ rawPhone: phone1, isPrimary: true }],
        });
      const c2 = await request(ctx.app!)
        .post('/customers')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          fullName: 'Bulk Two',
          phones: [{ rawPhone: phone2, isPrimary: true }],
        });
      expect(c1.status).toBe(201);
      expect(c2.status).toBe(201);

      const res = await request(ctx.app!)
        .delete('/customers/bulk')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerIds: [c1.body.data.id, c2.body.data.id] });
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBeGreaterThanOrEqual(2);

      // Telefon FK manuel CASCADE → silinmiş olmalı
      const orphanPhones = await ctx.db!
        .selectFrom('customer_phones')
        .selectAll()
        .where('customer_id', 'in', [c1.body.data.id, c2.body.data.id])
        .execute();
      expect(orphanPhones.length).toBe(0);
    });

    it('Multi-tenant: tenant B müşterisi tenant A GET listesinde/detayında yok', async () => {
      // Tenant B'ye doğrudan DB ile müşteri seed et — login pattern multi-tenant
      // değil (buildApp tenantId hardcoded), bu yüzden adminB token üretilemiyor.
      // İzolasyon için tenant A admin'in B verisini görmediğini doğrulamak yeter.
      const phone = uniquePhone();
      const otherCustomerId = randomUUID();
      await ctx.db!
        .insertInto('customers')
        .values({
          id: otherCustomerId,
          tenant_id: TENANT_B_ID,
          full_name: 'Tenant B Isolation',
          note: null,
        })
        .execute();
      await ctx.db!
        .insertInto('customer_phones')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_B_ID,
          customer_id: otherCustomerId,
          raw_phone: phone,
          normalized_phone: phone,
          is_primary: true,
          is_mobile: true,
        })
        .execute();

      // GET liste — A admin B müşterisini görmemeli
      const list = await request(ctx.app!)
        .get('/customers?page=1&limit=200')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(list.status).toBe(200);
      const ids = (list.body.data.customers as Array<{ id: string }>).map(
        (c) => c.id,
      );
      expect(ids).not.toContain(otherCustomerId);

      // GET detay — A admin B müşterisi id ile çağırınca 404
      const detail = await request(ctx.app!)
        .get(`/customers/${otherCustomerId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(detail.status).toBe(404);
    });
  },
);
