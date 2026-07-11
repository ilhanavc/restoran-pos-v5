import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Blok 6 Hat C — domain/attributes derin denetim (R6-ATTR-*).
 *
 * `attribute-groups.ts` (route) + `AttributeGroupService`/`AttributeOptionService`/
 * `AttributeAssignmentService` (domain) ÖNCEDEN HİÇ test dosyası yoktu (yalnız
 * `orders-attributes.test.ts` sipariş-alma sırasında READ path'i — effective
 * groups resolution — dolaylı egzersiz ediyordu). Bu dosya CRUD/assign
 * route'larını doğrudan hedefler.
 *
 * Avlanan sorular:
 *   - Cross-tenant groupId ile option oluşturma (IDOR) → 404 bekleniyor
 *     (AttributeOptionService.createOption `groups.findById(tenantId, groupId)`
 *     tenant-scoped).
 *   - is_default tekillik kuralı (ADR-012 Karar 7, application-level check,
 *     "superRefine" DEĞİL — zod'da yok, service'te if/count) — serial (race
 *     dışı) senaryoda doğru reddediyor mu.
 *   - Referans bütünlüğü: category_attribute_groups composite FK
 *     `(category_id, tenant_id) REFERENCES categories(id, tenant_id)` —
 *     cross-tenant categoryId + same-tenant groupId birleşimi INSERT
 *     denemesi 500 çökme/sessiz-başarı yerine düzgün 409'a mı düşüyor.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_A_ID = randomUUID();
const TENANT_B_ID = randomUUID();

const ADMIN_A_ID = randomUUID();
const ADMIN_A_EMAIL = `attr-admin-a-${randomUUID()}@example.com`;
const ADMIN_A_USERNAME = `attr-admin-a-${randomUUID().slice(0, 8)}`;
const ADMIN_A_PASSWORD = 'adminApass1234';

let GROUP_B_ID: string; // Tenant B'nin grubu (R6-ATTR-01 cross-tenant hedefi)
let CATEGORY_B_ID: string; // Tenant B'nin kategorisi (R6-ATTR-03 cross-tenant hedefi)

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  appA: Express;
  adminAToken: string;
}

const ctx: Partial<TestCtx> = {};

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 254) + 1}`;
}

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .set('X-Forwarded-For', nextIp())
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(
      `login failed: ${res.status} ${JSON.stringify(res.body)} [email=${email}]`,
    );
  }
  return res.body.accessToken as string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'domain/attributes derin denetim (Blok 6 Hat C, R6-ATTR-*)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.appA = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_A_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_A_ID,
            name: 'R6-ATTR Tenant A',
            slug: `r6-attr-a-${TENANT_A_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'R6-ATTR Tenant B',
            slug: `r6-attr-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: TENANT_A_ID }, { tenant_id: TENANT_B_ID }])
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminAHash = await hashPassword(ADMIN_A_PASSWORD);
      await db
        .insertInto('users')
        .values({
          id: ADMIN_A_ID,
          tenant_id: TENANT_A_ID,
          email: ADMIN_A_EMAIL,
          username: ADMIN_A_USERNAME,
          password_hash: adminAHash,
          role: 'admin',
        })
        .execute();

      GROUP_B_ID = randomUUID();
      await db
        .insertInto('attribute_groups')
        .values({
          id: GROUP_B_ID,
          tenant_id: TENANT_B_ID,
          name: 'R6-ATTR Tenant B Grup',
          selection_type: 'single',
          is_required: false,
        })
        .execute();

      CATEGORY_B_ID = randomUUID();
      await db
        .insertInto('categories')
        .values({
          id: CATEGORY_B_ID,
          tenant_id: TENANT_B_ID,
          name: 'R6-ATTR Tenant B Kategori',
          sort_order: 1,
        })
        .execute();

      ctx.adminAToken = await loginAndGetToken(ctx.appA, ADMIN_A_EMAIL, ADMIN_A_PASSWORD);
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        for (const tid of [TENANT_A_ID, TENANT_B_ID]) {
          await ctx.db
            .deleteFrom('category_attribute_groups')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('product_attribute_groups')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('attribute_options')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('attribute_groups')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db.deleteFrom('categories').where('tenant_id', '=', tid).execute();
          await ctx.db
            .deleteFrom('refresh_tokens')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db.deleteFrom('users').where('tenant_id', '=', tid).execute();
          await ctx.db
            .deleteFrom('tenant_settings')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db.deleteFrom('tenants').where('id', '=', tid).execute();
        }
        await ctx.db.destroy();
      }
    });

    // ── R6-ATTR-01 — SEC: cross-tenant groupId ile option oluşturma (IDOR) ──
    it('R6-ATTR-01: Tenant A admin, Tenant B grubuna POST /attribute-groups/:id/options → 404 ATTRIBUTE_GROUP_NOT_FOUND, satır oluşmaz', async () => {
      const res = await request(ctx.appA!)
        .post(`/attribute-groups/${GROUP_B_ID}/options`)
        .set('Authorization', `Bearer ${ctx.adminAToken!}`)
        .send({ name: 'IDOR Test Opsiyon', extraPriceCents: 100 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ATTRIBUTE_GROUP_NOT_FOUND');

      const rows = await ctx.db!
        .selectFrom('attribute_options')
        .selectAll()
        .where('group_id', '=', GROUP_B_ID)
        .execute();
      expect(rows).toHaveLength(0);
    });

    // ── R6-ATTR-02 — BUG: is_default tekillik (single grup, serial) ─────────
    it('R6-ATTR-02: single-selection grupta ikinci is_default=true → 422 ATTRIBUTE_OPTION_DEFAULT_INVALID, tek default kalır', async () => {
      const groupRes = await request(ctx.appA!)
        .post('/attribute-groups')
        .set('Authorization', `Bearer ${ctx.adminAToken!}`)
        .send({ name: 'R6-ATTR-02 Boyut', selectionType: 'single' });
      expect(groupRes.status).toBe(201);
      const groupId = groupRes.body.data.group.id as string;

      const opt1 = await request(ctx.appA!)
        .post(`/attribute-groups/${groupId}/options`)
        .set('Authorization', `Bearer ${ctx.adminAToken!}`)
        .send({ name: 'Küçük', extraPriceCents: 0, isDefault: true });
      expect(opt1.status).toBe(201);
      expect(opt1.body.data.option.is_default).toBe(true);

      const opt2 = await request(ctx.appA!)
        .post(`/attribute-groups/${groupId}/options`)
        .set('Authorization', `Bearer ${ctx.adminAToken!}`)
        .send({ name: 'Büyük', extraPriceCents: 500, isDefault: true });
      expect(opt2.status).toBe(422);
      expect(opt2.body.error.code).toBe('ATTRIBUTE_OPTION_DEFAULT_INVALID');

      const defaults = await ctx.db!
        .selectFrom('attribute_options')
        .selectAll()
        .where('group_id', '=', groupId)
        .where('is_default', '=', true)
        .execute();
      expect(defaults).toHaveLength(1);
      expect(defaults[0]!.name).toBe('Küçük');
    });

    // ── R6-ATTR-03 — BUG: referans bütünlüğü — cross-tenant category assign ─
    it('R6-ATTR-03: Tenant A grubu Tenant B kategorisine assign denemesi → composite FK reddi (409), satır oluşmaz (500 çökme yok)', async () => {
      const groupRes = await request(ctx.appA!)
        .post('/attribute-groups')
        .set('Authorization', `Bearer ${ctx.adminAToken!}`)
        .send({ name: 'R6-ATTR-03 Grup', selectionType: 'multiple' });
      expect(groupRes.status).toBe(201);
      const groupAId = groupRes.body.data.group.id as string;

      const res = await request(ctx.appA!)
        .post(`/menu/categories/${CATEGORY_B_ID}/attribute-groups/${groupAId}`)
        .set('Authorization', `Bearer ${ctx.adminAToken!}`);

      // Composite FK (category_id, tenant_id) → categories(id, tenant_id)
      // eşleşmez (kategori Tenant B'ye ait) → 23503 → RepositoryError
      // 'foreign_key' → toHttpError generic mapping (409 RESOURCE_CONFLICT).
      // 500 (unmapped crash) veya 200/201 (sessiz cross-tenant başarı) İKİSİ
      // DE ciddi bulgu olurdu; ikisi de gerçekleşmiyor.
      expect([404, 409]).toContain(res.status);
      expect(res.status).not.toBe(500);
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(201);

      const rows = await ctx.db!
        .selectFrom('category_attribute_groups')
        .selectAll()
        .where('group_id', '=', groupAId)
        .execute();
      expect(rows).toHaveLength(0);
    });
  },
);
