import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { signAccessToken } from '../auth/jwt';

/**
 * ADR-037 — GET /audit-logs entegrasyon testi (DoD 12 + 12a).
 *
 * Kapsam: RBAC (yalnız admin) · keyset sayfalama (kayıp/tekrar yok, araya
 * yeni kayıt girse bile) · varsayılan 7-gün penceresi ve `entityId` istisnası ·
 * doğrulama hataları (`ENTITY_TYPE_REQUIRED` / `INVALID_DATE_RANGE` /
 * `INVALID_CURSOR` / enum dışı `eventType`) · cross-tenant izolasyon ·
 * `tenant_id IS NULL` yetim satır · silinmiş kullanıcı aktör fallback'i ·
 * CSV yolu (BOM/`;`/filename · filtre pariteliği · cursor yok sayma ·
 * `format=xlsx` reddi · `reports.csv_export` audit kaydı · kaçış).
 *
 * Fixture dersleri (S-notları): token'lar `signAccessToken` ile DOĞRUDAN
 * imzalanır (loginLimiter'a dokunulmaz); tenant izole (`randomUUID`);
 * cleanup FK sırası audit_logs → users → tenant_settings → tenants;
 * `db.destroy()` tek kez afterAll'da.
 *
 * `audit_logs` INSERT'i test dosyalarında serbesttir (CI grep guard `.test.ts`
 * dosyalarını dışlar) — fixture kurulumu için writeAudit'in kapalı enum'una
 * bağlı kalmadan tarih/aktör kontrolü gerekir.
 */

// Rate-limit (60/dk/IP) bu suite'in istek sayısını kırmasın — davranışın
// kendisi `reports-rate-limit.test.ts` emsalinde ayrı sınanır.
process.env['E2E_BYPASS_AUDIT_LIMIT'] = '1';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

const TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const CASHIER_ID = randomUUID();
const WAITER_ID = randomUUID();
const KITCHEN_ID = randomUUID();
const OTHER_ADMIN_ID = randomUUID();

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

function userToken(userId: string, role: string, tenantId = TENANT_ID): string {
  return signAccessToken(
    { sub: userId, tenant_id: tenantId, role },
    ACCESS_SECRET,
  );
}

interface SeedRow {
  id?: string;
  eventType?: string;
  entityType?: string | null;
  entityId?: string | null;
  actorUserId?: string | null;
  createdAt?: Date;
  payload?: Record<string, unknown>;
  tenantId?: string | null;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-037 — GET /audit-logs (denetim günlüğü okuma)',
  () => {
    async function seed(row: SeedRow): Promise<string> {
      const id = row.id ?? randomUUID();
      await ctx
        .db!.insertInto('audit_logs')
        .values({
          id,
          tenant_id: row.tenantId === undefined ? TENANT_ID : row.tenantId,
          event_type: row.eventType ?? 'order.created',
          entity_type: row.entityType ?? null,
          entity_id: row.entityId ?? null,
          actor_user_id: row.actorUserId === undefined ? ADMIN_ID : row.actorUserId,
          payload: JSON.stringify(row.payload ?? { order_id: randomUUID() }),
          actor: JSON.stringify({}),
          ...(row.createdAt !== undefined ? { created_at: row.createdAt } : {}),
        })
        .execute();
      return id;
    }

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

      for (const [id, name] of [
        [TENANT_ID, 'Test Tenant Audit'],
        [OTHER_TENANT_ID, 'Other Tenant Audit'],
      ] as const) {
        await db
          .insertInto('tenants')
          .values({ id, name, slug: `test-audit-${id.slice(0, 8)}` })
          .onConflict((oc) => oc.doNothing())
          .execute();
        await db
          .insertInto('tenant_settings')
          .values({ tenant_id: id })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }

      const hash = await hashPassword('irrelevant-pass-1234');
      await db
        .insertInto('users')
        .values(
          (
            [
              [ADMIN_ID, 'admin', TENANT_ID],
              [CASHIER_ID, 'cashier', TENANT_ID],
              [WAITER_ID, 'waiter', TENANT_ID],
              [KITCHEN_ID, 'kitchen', TENANT_ID],
              [OTHER_ADMIN_ID, 'admin', OTHER_TENANT_ID],
            ] as const
          ).map(([id, role, tid]) => ({
            id,
            tenant_id: tid,
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
      await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
      await db
        .deleteFrom('audit_logs')
        .where('tenant_id', '=', OTHER_TENANT_ID)
        .execute();
      await db.deleteFrom('audit_logs').where('tenant_id', 'is', null).execute();
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
      await db
        .deleteFrom('audit_logs')
        .where('tenant_id', '=', OTHER_TENANT_ID)
        .execute();
      await db.deleteFrom('audit_logs').where('tenant_id', 'is', null).execute();
      for (const tid of [TENANT_ID, OTHER_TENANT_ID]) {
        await db.deleteFrom('refresh_tokens').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('users').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('tenant_settings').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('tenants').where('id', '=', tid).execute();
      }
      await db.destroy();
    });

    // ─────────────────────────── RBAC (DoD 12a) ────────────────────────────

    describe('RBAC — yalnız admin (K5)', () => {
      it('anonim istek → 401', async () => {
        const res = await request(ctx.app!).get('/audit-logs');
        expect(res.status).toBe(401);
      });

      it.each([
        ['cashier', () => ctx.cashierToken!],
        ['waiter', () => ctx.waiterToken!],
        ['kitchen', () => ctx.kitchenToken!],
      ])('%s rolü → 403', async (_role, token) => {
        const res = await request(ctx.app!)
          .get('/audit-logs')
          .set('Authorization', `Bearer ${token()}`);
        expect(res.status).toBe(403);
      });

      it('admin → 200 ve zarf { data: { logs, nextCursor, hasMore } }', async () => {
        await seed({});
        const res = await request(ctx.app!)
          .get('/audit-logs')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.logs)).toBe(true);
        expect(res.body.data).toHaveProperty('nextCursor');
        expect(res.body.data).toHaveProperty('hasMore');
        // COUNT(*) bilinçli olarak dönmez (K2).
        expect(res.body.data).not.toHaveProperty('total');
      });
    });

    // ──────────────────── Keyset sayfalama (DoD 12b) ────────────────────

    describe('keyset sayfalama (K2)', () => {
      it('3 sayfa gezildiğinde kayıp/tekrar YOK — araya yeni kayıt girse bile', async () => {
        const base = Date.now() - 60 * 60 * 1000;
        const seeded: string[] = [];
        for (let i = 0; i < 9; i += 1) {
          seeded.push(
            await seed({ createdAt: new Date(base + i * 1000) }),
          );
        }

        const seen: string[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 3; page += 1) {
          const url: string =
            cursor === null
              ? '/audit-logs?limit=3'
              : `/audit-logs?limit=3&cursor=${encodeURIComponent(cursor)}`;
          const res = await request(ctx.app!)
            .get(url)
            .set('Authorization', `Bearer ${ctx.adminToken!}`);
          expect(res.status).toBe(200);
          for (const log of res.body.data.logs as { id: string }[]) {
            seen.push(log.id);
          }
          cursor = res.body.data.nextCursor as string | null;

          // Sayfalar arasında YENİ kayıt eklenir (append-only tablo gerçeği):
          // offset sayfalamada kayma yaratırdı, keyset'te yaratmamalı.
          await seed({ createdAt: new Date() });
        }

        expect(seen).toHaveLength(9);
        expect(new Set(seen).size).toBe(9);
        // Sıra created_at DESC → en yeniden en eskiye; seeded ters sırada.
        expect(seen).toEqual([...seeded].reverse());
      });

      it('son sayfada hasMore=false ve nextCursor=null', async () => {
        await seed({});
        const res = await request(ctx.app!)
          .get('/audit-logs?limit=50')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.body.data.hasMore).toBe(false);
        expect(res.body.data.nextCursor).toBeNull();
      });

      it('bozuk cursor → 400 INVALID_CURSOR', async () => {
        const res = await request(ctx.app!)
          .get('/audit-logs?cursor=not-a-valid-cursor')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_CURSOR');
      });
    });

    // ─────────── Varsayılan pencere + entity filtresi (DoD 12c/12d) ───────────

    describe('tarih penceresi ve entity filtresi (K3/K4)', () => {
      it('varsayılan 7-gün penceresi: daha eski kayıt DÖNMEZ', async () => {
        const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const oldId = await seed({ createdAt: old });
        const freshId = await seed({});

        const res = await request(ctx.app!)
          .get('/audit-logs')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const ids = (res.body.data.logs as { id: string }[]).map((l) => l.id);
        expect(ids).toContain(freshId);
        expect(ids).not.toContain(oldId);
      });

      it('entityType+entityId verilince varsayılan pencere UYGULANMAZ (en değerli senaryo)', async () => {
        const orderId = randomUUID();
        const oldId = await seed({
          entityType: 'order',
          entityId: orderId,
          createdAt: new Date(Date.now() - 300 * 24 * 60 * 60 * 1000),
        });

        const res = await request(ctx.app!)
          .get(`/audit-logs?entityType=order&entityId=${orderId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(200);
        const ids = (res.body.data.logs as { id: string }[]).map((l) => l.id);
        expect(ids).toEqual([oldId]);
      });

      it('entityId tek başına → 400 ENTITY_TYPE_REQUIRED', async () => {
        const res = await request(ctx.app!)
          .get(`/audit-logs?entityId=${randomUUID()}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('ENTITY_TYPE_REQUIRED');
      });

      it('from > to → 400 INVALID_DATE_RANGE', async () => {
        const res = await request(ctx.app!)
          .get('/audit-logs?from=2026-08-02T00:00:00.000Z&to=2026-08-01T00:00:00.000Z')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_DATE_RANGE');
      });

      it('enum dışı eventType → 400 (sessizce yok sayma YOK)', async () => {
        const res = await request(ctx.app!)
          .get('/audit-logs?eventType=order.definitely_not_a_real_event')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(400);
      });

      it('çoklu eventType (tekrarlı parametre) OR ile birleşir', async () => {
        const a = await seed({ eventType: 'order.created' });
        const b = await seed({ eventType: 'payment.created' });
        await seed({ eventType: 'user.created' });

        const res = await request(ctx.app!)
          .get('/audit-logs?eventType=order.created&eventType=payment.created')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const ids = (res.body.data.logs as { id: string }[]).map((l) => l.id);
        expect(new Set(ids)).toEqual(new Set([a, b]));
      });

      it('actorUserId filtresi yalnız o aktörün kayıtlarını döner', async () => {
        const mine = await seed({ actorUserId: ADMIN_ID });
        await seed({ actorUserId: CASHIER_ID });

        const res = await request(ctx.app!)
          .get(`/audit-logs?actorUserId=${ADMIN_ID}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const ids = (res.body.data.logs as { id: string }[]).map((l) => l.id);
        expect(ids).toEqual([mine]);
      });
    });

    // ───────────── İzolasyon + aktör (DoD 12f / 12g / 12h) ─────────────

    describe('izolasyon ve aktör çözümü (K6)', () => {
      it('başka tenant kaydı DÖNMEZ (cross-tenant)', async () => {
        const foreign = await seed({ tenantId: OTHER_TENANT_ID });
        const own = await seed({});

        const res = await request(ctx.app!)
          .get('/audit-logs')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const ids = (res.body.data.logs as { id: string }[]).map((l) => l.id);
        expect(ids).toContain(own);
        expect(ids).not.toContain(foreign);
      });

      it('tenant_id IS NULL yetim satır hiçbir zaman DÖNMEZ', async () => {
        const orphan = await seed({ tenantId: null, actorUserId: null });
        await seed({});

        const res = await request(ctx.app!)
          .get('/audit-logs')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const ids = (res.body.data.logs as { id: string }[]).map((l) => l.id);
        expect(ids).not.toContain(orphan);
      });

      it('mevcut kullanıcıda actor.displayName + role dolu gelir', async () => {
        await seed({ actorUserId: CASHIER_ID });
        const res = await request(ctx.app!)
          .get('/audit-logs')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const log = res.body.data.logs[0] as {
          actor: { userId: string; displayName: string; role: string };
        };
        expect(log.actor.userId).toBe(CASHIER_ID);
        expect(log.actor.displayName).toContain('cashier-');
        expect(log.actor.role).toBe('cashier');
      });

      it('silinmiş kullanıcının olayında displayName null (UI fallback basar)', async () => {
        // actor_user_id FK ON DELETE SET NULL: kullanıcı silinince kolon NULL'a
        // düşer. `audit_logs.actor` JSONB'si ad taşımaz (writeAudit yalnız
        // user_agent yazar) → displayName null, UI `audit.actor.unknown` basar.
        await seed({ actorUserId: null });
        const res = await request(ctx.app!)
          .get('/audit-logs')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const log = res.body.data.logs[0] as {
          actor: { userId: null; displayName: null; role: null };
        };
        expect(log.actor.userId).toBeNull();
        expect(log.actor.displayName).toBeNull();
        expect(log.actor.role).toBeNull();
      });

      it('payload TAM taşınır (ayrı detay endpoint yok — K1)', async () => {
        const payload = { order_id: randomUUID(), before_cents: 1250, after_cents: 900 };
        await seed({ payload });
        const res = await request(ctx.app!)
          .get('/audit-logs')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.body.data.logs[0].payload).toEqual(payload);
      });
    });

    // ─────────────────────────── CSV (DoD 12a) ───────────────────────────

    describe('CSV dışa aktarma (K11)', () => {
      it('?format=csv → 200 text/csv + BOM + ";" + Content-Disposition', async () => {
        await seed({ entityType: 'order', entityId: randomUUID() });
        const res = await request(ctx.app!)
          .get('/audit-logs?format=csv')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('audit-logs');
        expect(res.headers['content-disposition']).toContain('.csv');
        const body = res.text;
        expect(body.charCodeAt(0)).toBe(0xfeff);
        const headerLine = body.slice(1).split('\r\n')[0];
        expect(headerLine).toBe(
          'Zaman;Olay Kodu;Kim;Rol;Nesne Tipi;Nesne ID;Detay',
        );
      });

      it('filtre pariteliği — JSON satır kümesi = CSV satır kümesi', async () => {
        const wanted = await seed({ eventType: 'payment.voided' });
        await seed({ eventType: 'order.created' });

        const jsonRes = await request(ctx.app!)
          .get('/audit-logs?eventType=payment.voided')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const csvRes = await request(ctx.app!)
          .get('/audit-logs?eventType=payment.voided&format=csv')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);

        const jsonIds = (jsonRes.body.data.logs as { id: string }[]).map((l) => l.id);
        expect(jsonIds).toEqual([wanted]);

        const dataLines = csvRes.text
          .slice(1)
          .split('\r\n')
          .filter((l) => l.length > 0)
          .slice(1);
        expect(dataLines).toHaveLength(1);
        expect(dataLines[0]).toContain('payment.voided');
        expect(dataLines[0]).not.toContain('order.created');
      });

      it('cursor/limit verilse bile CSV TAM seti döner (400 DEĞİL — K11.3)', async () => {
        for (let i = 0; i < 5; i += 1) await seed({});
        const first = await request(ctx.app!)
          .get('/audit-logs?limit=2')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const cursor = first.body.data.nextCursor as string;

        const res = await request(ctx.app!)
          .get(`/audit-logs?limit=2&cursor=${encodeURIComponent(cursor)}&format=csv`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);

        expect(res.status).toBe(200);
        const dataLines = res.text
          .slice(1)
          .split('\r\n')
          .filter((l) => l.length > 0)
          .slice(1);
        expect(dataLines).toHaveLength(5);
      });

      it('format=xlsx → 400 (ALLOWED_FORMATS yalnız csv)', async () => {
        const res = await request(ctx.app!)
          .get('/audit-logs?format=xlsx')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('cashier ?format=csv → 403', async () => {
        const res = await request(ctx.app!)
          .get('/audit-logs?format=csv')
          .set('Authorization', `Bearer ${ctx.cashierToken!}`);
        expect(res.status).toBe(403);
      });

      it('şema-DIŞI query parametresi audit query_string\'e SIZMAZ (PII regresyonu)', async () => {
        await seed({});

        // `audit_logs_payload_no_pii` CHECK'i yalnız ANAHTAR ADI bazlıdır:
        // serbest metne gömülü ad/telefon CHECK'i atlar ve KALICI yazılırdı.
        // `CsvSpec.auditQueryKeys` allow-list'i bu yolu kapatır.
        const res = await request(ctx.app!)
          .get(
            '/audit-logs?format=csv&eventType=order.created' +
              '&not=Ali%20Veli%2005551234567&utm_source=leak',
          )
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(200);

        const row = await ctx
          .db!.selectFrom('audit_logs')
          .selectAll()
          .where('tenant_id', '=', TENANT_ID)
          .where('event_type', '=', 'reports.csv_export')
          .executeTakeFirstOrThrow();

        const queryString = String(
          (row.payload as Record<string, unknown>)['query_string'],
        );
        // Bilinen filtreler KORUNUR (forensic değeri kaybolmaz)…
        expect(queryString).toContain('eventType=order.created');
        expect(queryString).toContain('format=csv');
        // …şema-dışı olan her şey ATILIR.
        expect(queryString).not.toContain('Ali');
        expect(queryString).not.toContain('05551234567');
        expect(queryString).not.toContain('not=');
        expect(queryString).not.toContain('utm_source');
      });

      it('reports.csv_export audit kaydı yazılır ve payload BOŞ DEĞİL (üçlü kontrat)', async () => {
        await seed({});
        await seed({});

        const res = await request(ctx.app!)
          .get('/audit-logs?format=csv')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(200);

        const row = await ctx
          .db!.selectFrom('audit_logs')
          .selectAll()
          .where('tenant_id', '=', TENANT_ID)
          .where('event_type', '=', 'reports.csv_export')
          .executeTakeFirstOrThrow();

        const payload = row.payload as Record<string, unknown>;
        // ADR-024 üçlü kontrat: enum + ALLOWED_KEYS + writeAudit hizalı değilse
        // payload sessizce boşalır — bu assert o sessiz kırılmayı yakalar.
        expect(Object.keys(payload).length).toBeGreaterThan(0);
        expect(payload['report_name']).toBe('audit-logs');
        expect(payload['row_count']).toBe(2);
        expect(String(payload['filename'])).toContain('audit-logs');
      });

      it('";" ve "\\"" içeren payload JSON\'u hücreyi BÖLMEZ (RFC 4180 kaçış)', async () => {
        await seed({
          payload: { order_id: randomUUID(), note_key: 'a;b"c' },
        });
        const res = await request(ctx.app!)
          .get('/audit-logs?format=csv')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);

        const lines = res.text
          .slice(1)
          .split('\r\n')
          .filter((l) => l.length > 0);
        expect(lines).toHaveLength(2);
        const dataLine = lines[1]!;
        // Detay hücresi tırnaklanmış ve içindeki `"` ikilenmiş olmalı.
        expect(dataLine).toContain('""');
        // Satır sayısı 2 kaldıysa `;` hücreyi bölmemiş demektir; ek olarak
        // ham JSON'un tırnak içinde taşındığını doğrula.
        expect(dataLine).toMatch(/;"\{.*\}"$/);
      });
    });
  },
);
