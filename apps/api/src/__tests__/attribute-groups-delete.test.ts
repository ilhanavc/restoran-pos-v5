import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { createAppTenantPool } from './helpers/appTenantPool';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-${randomUUID().slice(0, 8)}`;
const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-${randomUUID()}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-${randomUUID().slice(0, 8)}`;

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  appPool: Pool;
  appDb: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
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

/** Yeni bir attribute group yaratır ve id'sini döner (gerçek uç üzerinden). */
async function createGroup(app: Express, token: string): Promise<string> {
  const res = await request(app)
    .post('/attribute-groups')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Grup-${randomUUID().slice(0, 8)}`, selectionType: 'single' });
  if (res.status !== 201) {
    throw new Error(`group create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.group.id as string;
}

/** Gruba seçenek ekler ve id'sini döner. */
async function createOption(
  app: Express,
  token: string,
  groupId: string,
): Promise<string> {
  const res = await request(app)
    .post(`/attribute-groups/${groupId}/options`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Secenek-${randomUUID().slice(0, 8)}` });
  if (res.status !== 201) {
    throw new Error(`option create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.option.id as string;
}

/**
 * `attribute-groups` DELETE uçlarının DAVRANIŞSAL testleri (S141).
 *
 * NEDEN: S138 silme denetimi bu router ailesinde **sıfır test** buldu
 * (emsal: users 13, tables 9, menu 8, products 7, areas 6 · attribute-groups 0).
 * S139'da #703 yalnız **bozuk path parametresi** doğrulamasını kapattı
 * (`attribute-groups-params.test.ts`) — o testler 400 döndüğünü gösteriyor,
 * silmenin GERÇEKTEN olup olmadığını hiç ölçmüyor. Dört DELETE ucu yıkıcıdır
 * ve davranışları kayıtsızdı.
 *
 * ⚠️ DURUM KODU YETMEZ: `204` dönen bir uç hiçbir şey silmemiş de olabilir.
 * Bu yüzden her silme testi DB'de satırın durumunu **superuser `db` ile**
 * doğrular (`deleted_at` / link satırı) — uygulamanın kendi okuma yoluna
 * güvenmek döngüsel olurdu.
 *
 * Soft vs hard: `attribute_groups` ve `attribute_options` **soft delete**
 * kullanır (`deleted_at`), `tables`'ın tersine (ADR-009 Karar 5 amendment'inde
 * hard delete'e geçti). Link tabloları ise gerçek satır silmesidir.
 *
 * Harness: uygulama `app_tenant` (RLS-subject) altında koşar, fixture/doğrulama
 * superuser `db` ile ayrı kalır (ADR-041 F3 deseni).
 */
describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'attribute-groups DELETE davranışı (ADR-012)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      const appPool = createAppTenantPool(DB_URL ?? '');
      const appDb = createKysely(appPool);
      ctx.appPool = appPool;
      ctx.appDb = appDb;
      ctx.app = buildApp({
        pool: appPool,
        db: appDb,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Test Tenant AttrDelete',
          slug: `test-attrdel-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('users')
        .values({
          id: ADMIN_ID,
          tenant_id: TENANT_ID,
          email: ADMIN_EMAIL,
          username: ADMIN_USERNAME,
          password_hash: await hashPassword(ADMIN_PASSWORD),
          role: 'admin',
        })
        .execute();

      // 403 testleri için: bu uçların hepsi `authorize(['admin'])`.
      await db
        .insertInto('users')
        .values({
          id: CASHIER_ID,
          tenant_id: TENANT_ID,
          email: CASHIER_EMAIL,
          username: CASHIER_USERNAME,
          password_hash: await hashPassword(CASHIER_PASSWORD),
          role: 'cashier',
        })
        .execute();

      // Link uçları için gerçek kategori + ürün.
      await db
        .insertInto('categories')
        .values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Yemekler' })
        .execute();
      await db
        .insertInto('products')
        .values({
          id: PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: CATEGORY_ID,
          name: 'Test Ürün',
          price_cents: 5000,
          is_active: true,
        })
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
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        // Temizlik sırası FK zincirini izler: link tabloları → seçenekler →
        // gruplar → ürün → kategori → oturum/denetim → kullanıcılar → tenant.
        await ctx.db
          .deleteFrom('product_attribute_groups')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('category_attribute_groups')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('attribute_options')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('attribute_groups')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('products')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('categories')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('refresh_tokens')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('audit_logs')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('users')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
      if (ctx.appDb !== undefined) await ctx.appDb.destroy();
    });

    // ── DELETE /attribute-groups/:id ──────────────────────────────────────
    describe('DELETE /attribute-groups/:id', () => {
      it('204 döner ve satır GERÇEKTEN soft-delete olur (deleted_at dolar)', async () => {
        const groupId = await createGroup(ctx.app!, ctx.adminToken!);

        const before = await ctx
          .db!.selectFrom('attribute_groups')
          .select('deleted_at')
          .where('id', '=', groupId)
          .executeTakeFirstOrThrow();
        expect(before.deleted_at).toBeNull();

        const res = await request(ctx.app!)
          .delete(`/attribute-groups/${groupId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(204);

        // ⚠️ Asıl iddia: 204 tek başına silmeyi kanıtlamaz.
        const after = await ctx
          .db!.selectFrom('attribute_groups')
          .select('deleted_at')
          .where('id', '=', groupId)
          .executeTakeFirstOrThrow();
        expect(after.deleted_at).not.toBeNull();
      });

      it('silinen grup artık listede görünmez', async () => {
        const groupId = await createGroup(ctx.app!, ctx.adminToken!);

        const listBefore = await request(ctx.app!)
          .get('/attribute-groups')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(listBefore.status).toBe(200);
        const idsBefore = (listBefore.body.data.groups as Array<{ id: string }>).map(
          (g) => g.id,
        );
        expect(idsBefore).toContain(groupId);

        await request(ctx.app!)
          .delete(`/attribute-groups/${groupId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .expect(204);

        const listAfter = await request(ctx.app!)
          .get('/attribute-groups')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const idsAfter = (listAfter.body.data.groups as Array<{ id: string }>).map(
          (g) => g.id,
        );
        expect(idsAfter).not.toContain(groupId);
      });

      it('İKİNCİ silme 404 döner — uç idempotent DEĞİL (davranış kaydı)', async () => {
        const groupId = await createGroup(ctx.app!, ctx.adminToken!);
        await request(ctx.app!)
          .delete(`/attribute-groups/${groupId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .expect(204);

        // `softDeleteGroup` önce `findById` yapar; soft-delete'li satır
        // bulunmaz → ATTRIBUTE_GROUP_NOT_FOUND. Müşteri adresi silmenin
        // koşulsuz 204'ünün (ADR-016 uç tablosu) TERSİ davranış — ikisi de
        // bilinçli, bu test farkı kayda geçirir.
        const second = await request(ctx.app!)
          .delete(`/attribute-groups/${groupId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(second.status).toBe(404);
        expect(second.body.error.code).toBe('ATTRIBUTE_GROUP_NOT_FOUND');
      });

      it('var olmayan grup → 404 (RLS altında cross-tenant de buraya düşer)', async () => {
        const res = await request(ctx.app!)
          .delete(`/attribute-groups/${randomUUID()}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(404);
      });

      it('kasiyer silemez → 403 (uç admin-only)', async () => {
        const groupId = await createGroup(ctx.app!, ctx.adminToken!);
        const res = await request(ctx.app!)
          .delete(`/attribute-groups/${groupId}`)
          .set('Authorization', `Bearer ${ctx.cashierToken!}`);
        expect(res.status).toBe(403);

        // Reddedilen istek hiçbir şey silmemiş olmalı.
        const row = await ctx
          .db!.selectFrom('attribute_groups')
          .select('deleted_at')
          .where('id', '=', groupId)
          .executeTakeFirstOrThrow();
        expect(row.deleted_at).toBeNull();
      });
    });

    // ── DELETE /attribute-groups/:id/options/:optId ───────────────────────
    describe('DELETE /attribute-groups/:id/options/:optId', () => {
      it('204 döner ve seçenek GERÇEKTEN soft-delete olur', async () => {
        const groupId = await createGroup(ctx.app!, ctx.adminToken!);
        const optionId = await createOption(ctx.app!, ctx.adminToken!, groupId);

        const res = await request(ctx.app!)
          .delete(`/attribute-groups/${groupId}/options/${optionId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(204);

        const after = await ctx
          .db!.selectFrom('attribute_options')
          .select('deleted_at')
          .where('id', '=', optionId)
          .executeTakeFirstOrThrow();
        expect(after.deleted_at).not.toBeNull();
      });

      it('silinen seçenek grubun seçenek listesinde görünmez, GRUP hayatta kalır', async () => {
        const groupId = await createGroup(ctx.app!, ctx.adminToken!);
        const optionId = await createOption(ctx.app!, ctx.adminToken!, groupId);

        await request(ctx.app!)
          .delete(`/attribute-groups/${groupId}/options/${optionId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .expect(204);

        const list = await request(ctx.app!)
          .get(`/attribute-groups/${groupId}/options`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(list.status).toBe(200);
        const ids = (list.body.data.options as Array<{ id: string }>).map((o) => o.id);
        expect(ids).not.toContain(optionId);

        // Seçenek silmek grubu silmez.
        const group = await ctx
          .db!.selectFrom('attribute_groups')
          .select('deleted_at')
          .where('id', '=', groupId)
          .executeTakeFirstOrThrow();
        expect(group.deleted_at).toBeNull();
      });

      it('kasiyer silemez → 403', async () => {
        const groupId = await createGroup(ctx.app!, ctx.adminToken!);
        const optionId = await createOption(ctx.app!, ctx.adminToken!, groupId);
        const res = await request(ctx.app!)
          .delete(`/attribute-groups/${groupId}/options/${optionId}`)
          .set('Authorization', `Bearer ${ctx.cashierToken!}`);
        expect(res.status).toBe(403);

        const row = await ctx
          .db!.selectFrom('attribute_options')
          .select('deleted_at')
          .where('id', '=', optionId)
          .executeTakeFirstOrThrow();
        expect(row.deleted_at).toBeNull();
      });
    });

    // ── Bağ koparma uçları: SİLME DEĞİL ───────────────────────────────────
    // ⚠️ Bu iki uç grubu SİLMEZ, yalnız bağı koparır. Test asıl riski ölçer:
    // bağ koparma kazara grubu da silerse menüdeki diğer kategoriler/ürünler
    // o grubu kaybeder.
    describe('DELETE /menu/categories/:id/attribute-groups/:groupId', () => {
      it('bağ silinir ama GRUP hayatta kalır', async () => {
        const groupId = await createGroup(ctx.app!, ctx.adminToken!);

        await request(ctx.app!)
          .post(`/menu/categories/${CATEGORY_ID}/attribute-groups/${groupId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .expect((r) => expect([200, 201, 204]).toContain(r.status));

        const linkBefore = await ctx
          .db!.selectFrom('category_attribute_groups')
          .select('id')
          .where('category_id', '=', CATEGORY_ID)
          .where('group_id', '=', groupId)
          .executeTakeFirst();
        expect(linkBefore).toBeDefined();

        const res = await request(ctx.app!)
          .delete(`/menu/categories/${CATEGORY_ID}/attribute-groups/${groupId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(204);

        const linkAfter = await ctx
          .db!.selectFrom('category_attribute_groups')
          .select('id')
          .where('category_id', '=', CATEGORY_ID)
          .where('group_id', '=', groupId)
          .executeTakeFirst();
        expect(linkAfter).toBeUndefined();

        // Asıl iddia: bağ koparma grubu SİLMEZ.
        const group = await ctx
          .db!.selectFrom('attribute_groups')
          .select('deleted_at')
          .where('id', '=', groupId)
          .executeTakeFirstOrThrow();
        expect(group.deleted_at).toBeNull();
      });
    });

    describe('DELETE /products/:id/attribute-groups/:groupId', () => {
      it('bağ silinir ama GRUP hayatta kalır', async () => {
        const groupId = await createGroup(ctx.app!, ctx.adminToken!);

        await request(ctx.app!)
          .post(`/products/${PRODUCT_ID}/attribute-groups/${groupId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .expect((r) => expect([200, 201, 204]).toContain(r.status));

        const linkBefore = await ctx
          .db!.selectFrom('product_attribute_groups')
          .select('id')
          .where('product_id', '=', PRODUCT_ID)
          .where('group_id', '=', groupId)
          .executeTakeFirst();
        expect(linkBefore).toBeDefined();

        const res = await request(ctx.app!)
          .delete(`/products/${PRODUCT_ID}/attribute-groups/${groupId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(204);

        const linkAfter = await ctx
          .db!.selectFrom('product_attribute_groups')
          .select('id')
          .where('product_id', '=', PRODUCT_ID)
          .where('group_id', '=', groupId)
          .executeTakeFirst();
        expect(linkAfter).toBeUndefined();

        const group = await ctx
          .db!.selectFrom('attribute_groups')
          .select('deleted_at')
          .where('id', '=', groupId)
          .executeTakeFirstOrThrow();
        expect(group.deleted_at).toBeNull();
      });
    });
  },
);
