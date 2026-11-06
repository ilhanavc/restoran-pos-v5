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

/**
 * ADR-044 K4 — ajan sürüm görünürlüğünün YAZIM tarafı.
 *
 * Kilitlenen davranış:
 *   1. `?agentVersion=1.2.3` → `agents.agent_version` yazılır.
 *   2. 🔴 **Geçersiz sürüm → NULL, ama istek 400 DEĞİL.** Gözlem alanı
 *      yüzünden baskı poll'u düşmez (`parseKindFilter`'ın 400'lü davranışı
 *      bilinçli olarak taklit edilmedi). Bu testin varlık sebebi tam olarak
 *      bu: "sunucu 400 veriyor" regresyonu üretimde TÜM BASKIYI durdurur.
 *   3. Parametre yoksa → NULL (bayat gözlem bırakmaz; `declared_kinds`
 *      semantiğinin aynısı).
 *   4. `POST /agent/register` gövdesindeki opsiyonel `agentVersion` de yazılır;
 *      alanı göndermeyen eski exe 200 alır ve değer NULL kalır.
 *
 * ⚠️ Yazım **fire-and-forget**'tir (claim'i düşürmemek için `await` YOK) →
 * iddialar kısa poll ile beklenir (printers.test.ts `declared_kinds` emsali).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

const TENANT_ID = randomUUID();
/** register akışı apiKey önekini SUNUCU tenant'ının öneki ile karşılaştırır. */
const API_KEY = `pk_${TENANT_ID.replace(/-/g, '').slice(0, 8)}_agent-version-fixture`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
}

const ctx: Partial<TestCtx> = {};

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-044 K4 — agents.agent_version yazımı',
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
          name: 'Test Tenant Agent Version',
          slug: `test-ver-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    });

    beforeEach(async () => {
      await ctx.db!.deleteFrom('agents')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('agents').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await db.destroy();
    });

    async function insertAgent(fingerprint: string): Promise<string> {
      const id = randomUUID();
      await ctx.db!.insertInto('agents')
        .values({
          id,
          tenant_id: TENANT_ID,
          device_fingerprint: fingerprint,
          api_key_hash: await bcrypt.hash(API_KEY, 4),
        })
        .execute();
      return id;
    }

    function agentJwt(agentId: string): string {
      return jwt.sign({ type: 'agent', tid: TENANT_ID }, AGENT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '1h',
        subject: agentId,
        jwtid: randomUUID(),
      });
    }

    async function readVersion(agentId: string): Promise<string | null> {
      const row = await ctx.db!.selectFrom('agents')
        .select('agent_version')
        .where('id', '=', agentId)
        .executeTakeFirst();
      return row?.agent_version ?? null;
    }

    /** fire-and-forget yazımı bekler: değer `expected` olunca döner. */
    async function waitForVersion(
      agentId: string,
      expected: string | null,
    ): Promise<string | null> {
      let value: string | null = null;
      for (let i = 0; i < 20; i++) {
        value = await readVersion(agentId);
        if (value === expected) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      return value;
    }

    it('geçerli ?agentVersion=1.2.3 → agent_version yazılır', async () => {
      const agentId = await insertAgent(`fp-ver-ok-${randomUUID().slice(0, 8)}`);

      const res = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=0&agentVersion=1.2.3')
        .set('Authorization', `Bearer ${agentJwt(agentId)}`);
      expect(res.status).toBe(204);

      expect(await waitForVersion(agentId, '1.2.3')).toBe('1.2.3');
    });

    it('🔴 geçersiz ?agentVersion=abc → NULL yazılır ve yanıt 400 DEĞİL', async () => {
      const agentId = await insertAgent(`fp-ver-bad-${randomUUID().slice(0, 8)}`);
      // Önce geçerli bir sürüm yazdır: NULL iddiasının "hiç yazılmadı" ile
      // karışmaması için başlangıç değeri dolu olmalı.
      await ctx.db!.updateTable('agents')
        .set({ agent_version: '9.9.9' })
        .where('id', '=', agentId)
        .execute();

      const res = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=0&agentVersion=abc')
        .set('Authorization', `Bearer ${agentJwt(agentId)}`);
      // Poll ÇALIŞMAYA DEVAM EDER — gözlem alanı baskıyı düşürmez.
      expect(res.status).toBe(204);
      expect(res.status).not.toBe(400);

      expect(await waitForVersion(agentId, null)).toBeNull();
    });

    it('`v` önekli / fazla bileşenli sürüm de NULL (biçim dar, 400 yok)', async () => {
      const agentId = await insertAgent(`fp-ver-pre-${randomUUID().slice(0, 8)}`);

      const res = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=0&agentVersion=v0.0.5')
        .set('Authorization', `Bearer ${agentJwt(agentId)}`);
      expect(res.status).toBe(204);
      expect(await waitForVersion(agentId, null)).toBeNull();
    });

    it('parametre hiç yok → NULL', async () => {
      const agentId = await insertAgent(`fp-ver-non-${randomUUID().slice(0, 8)}`);
      await ctx.db!.updateTable('agents')
        .set({ agent_version: '9.9.9' })
        .where('id', '=', agentId)
        .execute();

      const res = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=0')
        .set('Authorization', `Bearer ${agentJwt(agentId)}`);
      expect(res.status).toBe(204);

      expect(await waitForVersion(agentId, null)).toBeNull();
    });

    it('register gövdesindeki agentVersion yazılır (ilk poll beklenmez)', async () => {
      // Mevcut bir satır gerekiyor: register apiKey hash'ini KENDİ tenant'ının
      // aktif agent'larından eşleştirir (yeni cihaz o hash'i kopyalar).
      await insertAgent(`fp-ver-seed-${randomUUID().slice(0, 8)}`);
      const fingerprint = `fp-ver-reg-${randomUUID().slice(0, 8)}`;

      const res = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({
          apiKey: API_KEY,
          deviceFingerprint: fingerprint,
          agentVersion: '0.0.5',
        });
      expect(res.status).toBe(200);

      const row = await ctx.db!.selectFrom('agents')
        .select(['id', 'agent_version'])
        .where('tenant_id', '=', TENANT_ID)
        .where('device_fingerprint', '=', fingerprint)
        .executeTakeFirst();
      expect(row?.agent_version).toBe('0.0.5');
    });

    it('register gövdesinde agentVersion yoksa 200 + NULL (eski exe kırılmaz)', async () => {
      await insertAgent(`fp-ver-seed2-${randomUUID().slice(0, 8)}`);
      const fingerprint = `fp-ver-reg2-${randomUUID().slice(0, 8)}`;

      const res = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({ apiKey: API_KEY, deviceFingerprint: fingerprint });
      expect(res.status).toBe(200);

      const row = await ctx.db!.selectFrom('agents')
        .select(['id', 'agent_version'])
        .where('tenant_id', '=', TENANT_ID)
        .where('device_fingerprint', '=', fingerprint)
        .executeTakeFirst();
      expect(row?.agent_version).toBeNull();
    });

    it('🔴 geçersiz biçimli agentVersion gövdesi → register YİNE 200, sürüm NULL', async () => {
      // Önceki hâl 400 bekliyordu (gövde şeması `AgentVersionSchema` ile dardı).
      // ADR-044 K4'ün kendi gerekçesi bunu çürütüyor: bir **gözlem alanı**,
      // register'ı — yani fail-closed'ın en sivri ucunu — kapatamaz. Biçimsiz
      // sürüm gönderen bir exe, sürümü görünmese de **kaydolmaya ve fiş
      // basmaya devam etmeli**; aksi hâlde sürüm görünürlüğü için eklenen alan,
      // yazıcıyı susturan arıza sebebine dönüşür. Normalizasyon tek noktada
      // (`parseAgentVersionParam`) ve sorgu parametresiyle AYNI.
      await insertAgent(`fp-ver-seed3-${randomUUID().slice(0, 8)}`);

      const fingerprint = `fp-ver-reg3-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({
          apiKey: API_KEY,
          deviceFingerprint: fingerprint,
          agentVersion: 'abc',
        });
      expect(res.status).toBe(200);

      const row = await ctx
        .db!.selectFrom('agents')
        .select(['agent_version'])
        .where('tenant_id', '=', TENANT_ID)
        .where('device_fingerprint', '=', fingerprint)
        .executeTakeFirstOrThrow();
      expect(row.agent_version).toBeNull();
    });
  },
);
