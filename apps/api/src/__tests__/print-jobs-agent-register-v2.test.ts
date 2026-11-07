import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createPool, createKysely, withTenant, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { generateAgentRegistrationKey } from '../routes/print-jobs';
import { createAppTenantPool } from './helpers/appTenantPool';
import { rotateAgentKey, ActorUnresolvedError } from '../../scripts/rotate-agent-key';

/**
 * ADR-044 **K1 + K2** — ikinci şubenin ajanı kaydolabilir + kayıt anahtarı
 * rotasyonu.
 *
 * 🔴 Bu dosyanın asıl işi **MIM-7b'nin kapandığını** kanıtlamak: `register`
 * artık tenant'ı sunucu sabitiyle KARŞILAŞTIRMIYOR, `pk2_` anahtarının
 * kendisinden ÇÖZÜYOR. Kritik kurgu: uygulama `tenantId: LIVE_TENANT_ID` ile
 * kuruluyor (yani sunucu sabiti canlı tenant'ı gösteriyor) ama ikinci
 * tenant'ın `pk2_` anahtarı **yine de** kaydolabiliyor. Eski kodda bu 401'di.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

/** Sunucu sabitinin gösterdiği tenant (canlı restoranın eşleniği). */
const LIVE_TENANT_ID = randomUUID();
/** İkinci şube — sunucu sabiti BUNU göstermiyor. MIM-7b'nin konusu. */
const BRANCH_TENANT_ID = randomUUID();

/** Legacy dal: önek sunucu tenant'ının öneki ile karşılaştırılır. */
const LEGACY_API_KEY = `pk_${LIVE_TENANT_ID.replace(/-/g, '').slice(0, 8)}_legacy-fixture`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
}

const ctx: Partial<TestCtx> = {};

/** Test fixture'larında bcrypt cost 4 — üretim cost'u 12, burada hız önemli. */
const TEST_COST = 4;

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-044 K1+K2 — ajan tenant çözümü ve kayıt anahtarı rotasyonu',
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
        // 🔴 Sunucu sabiti CANLI tenant'ı gösteriyor — ikinci şube testleri
        // tam olarak bu sabitin ARKASINDAN geçmeyi kanıtlıyor.
        tenantId: LIVE_TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      for (const [id, name, slug] of [
        [LIVE_TENANT_ID, 'Canli Tenant V2', `test-v2-live-${LIVE_TENANT_ID.slice(0, 8)}`],
        [BRANCH_TENANT_ID, 'Ikinci Sube V2', `test-v2-sube-${BRANCH_TENANT_ID.slice(0, 8)}`],
      ] as const) {
        await db
          .insertInto('tenants')
          .values({ id, name, slug })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
    });

    beforeEach(async () => {
      const db = ctx.db!;
      for (const tenantId of [LIVE_TENANT_ID, BRANCH_TENANT_ID]) {
        await db.deleteFrom('agents').where('tenant_id', '=', tenantId).execute();
        await db
          .deleteFrom('agent_registration_keys')
          .where('tenant_id', '=', tenantId)
          .execute();
      }
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      for (const tenantId of [LIVE_TENANT_ID, BRANCH_TENANT_ID]) {
        await db.deleteFrom('audit_logs').where('tenant_id', '=', tenantId).execute();
        await db.deleteFrom('print_jobs').where('tenant_id', '=', tenantId).execute();
        await db.deleteFrom('agents').where('tenant_id', '=', tenantId).execute();
        await db
          .deleteFrom('agent_registration_keys')
          .where('tenant_id', '=', tenantId)
          .execute();
        await db.deleteFrom('users').where('tenant_id', '=', tenantId).execute();
        await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
      }
      await db.destroy();
    });

    /** Kayıt anahtarı satırı ekler, plaintext'i döner (yalnız test içinde). */
    async function insertRegistrationKey(
      tenantId: string,
      opts: { validUntil?: Date | null; revokedAt?: Date | null } = {},
    ): Promise<{ id: string; plaintext: string }> {
      const plaintext = generateAgentRegistrationKey(tenantId);
      const id = randomUUID();
      await ctx
        .db!.insertInto('agent_registration_keys')
        .values({
          id,
          tenant_id: tenantId,
          key_hash: await bcrypt.hash(plaintext, TEST_COST),
          valid_until: opts.validUntil ?? null,
          revoked_at: opts.revokedAt ?? null,
        })
        .execute();
      return { id, plaintext };
    }

    function registerWith(apiKey: string, fingerprint: string) {
      return request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({ apiKey, deviceFingerprint: fingerprint });
    }

    async function agentRow(tenantId: string, fingerprint: string) {
      return ctx
        .db!.selectFrom('agents')
        .select(['id', 'registration_key_id', 'api_key_hash'])
        .where('tenant_id', '=', tenantId)
        .where('device_fingerprint', '=', fingerprint)
        .executeTakeFirst();
    }

    // ── K1: ikinci şube kaydolabiliyor ──────────────────────────────────────

    it('🔴 MIM-7b KAPANDI: ikinci şubenin `pk2_` anahtarı kaydolur ve satır O tenant\'ta açılır', async () => {
      const key = await insertRegistrationKey(BRANCH_TENANT_ID);
      const fp = `fp-sube-${randomUUID().slice(0, 8)}`;

      const res = await registerWith(key.plaintext, fp);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');

      // Satır SUNUCU sabitinin tenant'ında DEĞİL, anahtarın tenant'ında açılır.
      const branchRow = await agentRow(BRANCH_TENANT_ID, fp);
      expect(branchRow).toBeDefined();
      expect(branchRow!.registration_key_id).toBe(key.id);
      expect(await agentRow(LIVE_TENANT_ID, fp)).toBeUndefined();
    });

    it('çapraz negatif: B tenant\'ının öneki + A tenant\'ının sırrı → 401', async () => {
      const liveKey = await insertRegistrationKey(LIVE_TENANT_ID);
      await insertRegistrationKey(BRANCH_TENANT_ID);

      // Önek B'yi gösteriyor (kapsam seçicisi), sır A'nın → bcrypt B'nin
      // anahtarlarına karşı koşar ve eşleşmez. Önek bir İDDİA değildir.
      const secret = liveKey.plaintext.split('_').slice(2).join('_');
      const forged = `pk2_${BRANCH_TENANT_ID.replace(/-/g, '')}_${secret}`;

      const res = await registerWith(forged, `fp-forged-${randomUUID().slice(0, 8)}`);
      expect(res.status).toBe(401);
      expect(res.body.error?.code ?? res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('çözülemeyen tenant önekine sahip `pk2_` → 401 (ve başka hata kodu DEĞİL)', async () => {
      const ghost = randomUUID().replace(/-/g, '');
      const res = await registerWith(
        `pk2_${ghost}_secret-does-not-matter`,
        `fp-ghost-${randomUUID().slice(0, 8)}`,
      );
      expect(res.status).toBe(401);
      expect(res.body.error?.code ?? res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('iptal edilmiş kayıt anahtarı → 401', async () => {
      const key = await insertRegistrationKey(BRANCH_TENANT_ID, {
        revokedAt: new Date(),
      });
      const res = await registerWith(key.plaintext, `fp-rev-${randomUUID().slice(0, 8)}`);
      expect(res.status).toBe(401);
    });

    it('`valid_until` GEÇMİŞ anahtar → 401; GELECEK anahtar → 200 (grace penceresi)', async () => {
      const expired = await insertRegistrationKey(BRANCH_TENANT_ID, {
        validUntil: new Date(Date.now() - 60_000),
      });
      expect(
        (await registerWith(expired.plaintext, `fp-exp-${randomUUID().slice(0, 8)}`))
          .status,
      ).toBe(401);

      const live = await insertRegistrationKey(BRANCH_TENANT_ID, {
        validUntil: new Date(Date.now() + 60 * 60_000),
      });
      expect(
        (await registerWith(live.plaintext, `fp-grace-${randomUUID().slice(0, 8)}`))
          .status,
      ).toBe(200);
    });

    it('legacy `pk_` dalı HÂLÂ çalışır ve `registration_key_id` NULL kalır', async () => {
      // Legacy dal `agents.api_key_hash` adaylarına bakar → tohum satır şart.
      await ctx
        .db!.insertInto('agents')
        .values({
          id: randomUUID(),
          tenant_id: LIVE_TENANT_ID,
          device_fingerprint: `fp-seed-${randomUUID().slice(0, 8)}`,
          api_key_hash: await bcrypt.hash(LEGACY_API_KEY, TEST_COST),
        })
        .execute();

      const fp = `fp-legacy-${randomUUID().slice(0, 8)}`;
      expect((await registerWith(LEGACY_API_KEY, fp)).status).toBe(200);

      const row = await agentRow(LIVE_TENANT_ID, fp);
      expect(row).toBeDefined();
      // K1.10 — legacy dalın davranışı bit-bit aynı: kolona DOKUNMAZ.
      expect(row!.registration_key_id).toBeNull();
    });

    // ── K2: rotasyonun kabul kanıtı ─────────────────────────────────────────

    it('🔴 idempotent re-register `registration_key_id`\'yi GÜNCELLER (rotasyonun kabul kanıtı)', async () => {
      const first = await insertRegistrationKey(BRANCH_TENANT_ID);
      const fp = `fp-rot-${randomUUID().slice(0, 8)}`;
      expect((await registerWith(first.plaintext, fp)).status).toBe(200);
      expect((await agentRow(BRANCH_TENANT_ID, fp))!.registration_key_id).toBe(first.id);

      // Rotasyon: ikinci anahtar üretildi, ajan AYNI parmak iziyle yeniden
      // kaydoluyor. Kolon güncellenmezse Dalga D'nin ölçütü ("üç satırın
      // üçünde YENİ id") imkânsızlaşır.
      const second = await insertRegistrationKey(BRANCH_TENANT_ID);
      expect((await registerWith(second.plaintext, fp)).status).toBe(200);

      const row = await agentRow(BRANCH_TENANT_ID, fp);
      expect(row!.registration_key_id).toBe(second.id);
      // 🔴 `api_key_hash` EZİLMEZ (security-reviewer BLOCKER B1, 2026-11-07):
      // legacy dal adaylarını bu kolondan kurar ve Dalga D'nin geri-alma
      // reçetesi ("env'e eski anahtarı geri yaz") buna bağlıdır. Ezilseydi
      // geri dönüş 401 verir, üç yazıcı birden susardı.
      expect(await bcrypt.compare(first.plaintext, row!.api_key_hash)).toBe(true);
      expect(await bcrypt.compare(second.plaintext, row!.api_key_hash)).toBe(false);
    });

    it('🔴 ŞEMA tenant-ötesi işareti REDDEDER: A\'nın ajanı B\'nin anahtarını gösteremez', async () => {
      // db-migration-guard gate'i (2026-11-07) bu güvencenin yalnız uygulama
      // kodunun doğru davranmasına dayandığını söyledi — tek-kolonlu FK,
      // tenant-ötesi işareti ENGELLEMİYORDU (FK doğrulaması RLS'e tabi değil).
      // Bileşik FK `(tenant_id, registration_key_id)` kuralı şemaya taşıdı;
      // bu test onun POZİTİF kanıtı ([[feedback_negative_guarantee_stays_green]]).
      const branchKey = await insertRegistrationKey(BRANCH_TENANT_ID);
      await expect(
        ctx
          .db!.insertInto('agents')
          .values({
            id: randomUUID(),
            tenant_id: LIVE_TENANT_ID, // ← başka tenant
            device_fingerprint: `fp-xfk-${randomUUID().slice(0, 8)}`,
            api_key_hash: await bcrypt.hash('irrelevant', TEST_COST),
            registration_key_id: branchKey.id, // ← B'nin anahtarı
          })
          .execute(),
      ).rejects.toThrow(/23503|foreign key|agents_registration_key_fk/i);
    });

    // ── RLS: denetim izi silinemez ──────────────────────────────────────────

    it('🔴 `app_tenant` kayıt anahtarı satırını SİLEMEZ (GRANT yok + DELETE policy yok)', async () => {
      const key = await insertRegistrationKey(BRANCH_TENANT_ID);
      const appPool = createAppTenantPool(DB_URL ?? '');
      const appDb = createKysely(appPool);
      try {
        // Rol gerçekten değişti mi? ([[feedback_verify_role_switch_with_current_user]])
        // ⚠️ `current_user` bir ANAHTAR SÖZCÜK, fonksiyon değil: `eb.fn()` ile
        // çağırmak `current_user()` üretir ve Postgres "syntax error at or
        // near (" der. Ham SQL şart.
        const who = await withTenant(appDb, BRANCH_TENANT_ID, (trx) =>
          sql<{ role: string }>`select current_user as role`
            .execute(trx)
            .then((r) => r.rows[0]!),
        );
        expect(who.role).toBe('app_tenant');

        // Okuma çalışır (register'ın aday sorgusu bu yetkiye dayanıyor).
        const visible = await withTenant(appDb, BRANCH_TENANT_ID, (trx) =>
          trx
            .selectFrom('agent_registration_keys')
            .select(['id'])
            .where('id', '=', key.id)
            .execute(),
        );
        expect(visible).toHaveLength(1);

        // Silme REDDEDİLİR: GRANT yok → Postgres 42501 fırlatır.
        await expect(
          withTenant(appDb, BRANCH_TENANT_ID, (trx) =>
            trx
              .deleteFrom('agent_registration_keys')
              .where('id', '=', key.id)
              .execute(),
          ),
        ).rejects.toThrow(/permission denied|42501/i);

        // Satır yerinde.
        const still = await ctx
          .db!.selectFrom('agent_registration_keys')
          .select(['id'])
          .where('id', '=', key.id)
          .executeTakeFirst();
        expect(still).toBeDefined();
      } finally {
        // ⚠️ `destroy()` havuzu ZATEN kapatır; ardından `appPool.end()` çağırmak
        // "Called end on pool more than once" ile patlar ve testi assertion'dan
        // DEĞİL teardown'dan kırmızı yapar ([[feedback_test_output_grep_hides_file_failure]]
        // sınıfı: hata mesajını oku, yoksa yanlış yere bakılır).
        await appDb.destroy();
      }
    });

    // ── Rotasyon script'i ───────────────────────────────────────────────────

    describe('rotate-agent-key script\'i', () => {
      async function insertAdmin(tenantId: string): Promise<string> {
        const id = randomUUID();
        const username = `rot-admin-${randomUUID().slice(0, 8)}`;
        await ctx
          .db!.insertInto('users')
          .values({
            id,
            tenant_id: tenantId,
            username,
            email: `${username}@test.local`,
            password_hash: await bcrypt.hash('irrelevant', TEST_COST),
            role: 'admin',
          })
          .execute();
        return username;
      }

      it('eski anahtara `valid_until` yazar, yenisini ekler, audit\'e SIR yazmaz', async () => {
        const actor = await insertAdmin(BRANCH_TENANT_ID);
        const old = await insertRegistrationKey(BRANCH_TENANT_ID);

        const result = await rotateAgentKey(ctx.db!, {
          tenantId: BRANCH_TENANT_ID,
          actor,
          graceDays: 7,
        });
        expect(result.affectedKeyCount).toBe(1);
        expect(result.plaintextKey).toMatch(/^pk2_[0-9a-f]{32}_/);

        const oldRow = await ctx
          .db!.selectFrom('agent_registration_keys')
          .select(['valid_until', 'revoked_at'])
          .where('id', '=', old.id)
          .executeTakeFirstOrThrow();
        expect(oldRow.valid_until).not.toBeNull();
        // Rotasyon İPTAL ETMEZ — grace penceresi bunun için var.
        expect(oldRow.revoked_at).toBeNull();

        // Yeni anahtar hemen geçerli: ikinci şube ajanı onunla kaydolabilir.
        const fp = `fp-newkey-${randomUUID().slice(0, 8)}`;
        expect((await registerWith(result.plaintextKey ?? '', fp)).status).toBe(200);

        // 🔴 Audit: yalnız id + pencere + sayı. Sırrın hiçbir parçası YOK.
        const audit = await ctx
          .db!.selectFrom('audit_logs')
          .select(['event_type', 'payload'])
          .where('tenant_id', '=', BRANCH_TENANT_ID)
          .where('event_type', '=', 'printer.registration_key_rotated')
          .executeTakeFirstOrThrow();
        const payloadText = JSON.stringify(audit.payload);
        expect(payloadText).toContain(result.newKeyId ?? 'YOK');
        const secret = (result.plaintextKey ?? '').split('_').slice(2).join('_');
        expect(payloadText).not.toContain(secret);
        expect(payloadText).not.toContain('pk2_');
      });

      it('actor çözülemezse REDDEDER ve hiçbir şey yazmaz', async () => {
        const before = await ctx
          .db!.selectFrom('agent_registration_keys')
          .select(['id'])
          .where('tenant_id', '=', BRANCH_TENANT_ID)
          .execute();

        await expect(
          rotateAgentKey(ctx.db!, {
            tenantId: BRANCH_TENANT_ID,
            actor: 'olmayan-admin@test.local',
          }),
        ).rejects.toBeInstanceOf(ActorUnresolvedError);

        const after = await ctx
          .db!.selectFrom('agent_registration_keys')
          .select(['id'])
          .where('tenant_id', '=', BRANCH_TENANT_ID)
          .execute();
        expect(after).toHaveLength(before.length);
      });

      it('`--dry-run` hiçbir şey yazmaz ve sır ÜRETMEZ', async () => {
        const actor = await insertAdmin(BRANCH_TENANT_ID);
        const old = await insertRegistrationKey(BRANCH_TENANT_ID);

        const result = await rotateAgentKey(ctx.db!, {
          tenantId: BRANCH_TENANT_ID,
          actor,
          dryRun: true,
        });
        expect(result.plaintextKey).toBeNull();
        expect(result.newKeyId).toBeNull();

        const rows = await ctx
          .db!.selectFrom('agent_registration_keys')
          .select(['id', 'valid_until'])
          .where('tenant_id', '=', BRANCH_TENANT_ID)
          .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.id).toBe(old.id);
        expect(rows[0]!.valid_until).toBeNull();
      });

      it('grace dışı değer reddedilir (0-30 gün; 0 = acil iptal, GEÇERLİ)', async () => {
        const actor = await insertAdmin(BRANCH_TENANT_ID);
        // 0 artık GEÇERLİ: sızan anahtarı anında geçersiz kılmanın tek yolu
        // (security-reviewer M3). Reddedilenler: negatif, 30 üstü, kesirli.
        for (const graceDays of [-1, 31, 1.5]) {
          await expect(
            rotateAgentKey(ctx.db!, {
              tenantId: BRANCH_TENANT_ID,
              actor,
              graceDays,
            }),
          ).rejects.toThrow(/grace-days/);
        }
      });

      it('`--revoke-after-grace` yalnız süresi DOLMUŞ anahtarı iptal eder', async () => {
        const actor = await insertAdmin(BRANCH_TENANT_ID);
        const expired = await insertRegistrationKey(BRANCH_TENANT_ID, {
          validUntil: new Date(Date.now() - 60_000),
        });
        const active = await insertRegistrationKey(BRANCH_TENANT_ID);

        const result = await rotateAgentKey(ctx.db!, {
          tenantId: BRANCH_TENANT_ID,
          actor,
          revokeAfterGrace: true,
        });
        expect(result.revokedCount).toBe(1);

        const expiredRow = await ctx
          .db!.selectFrom('agent_registration_keys')
          .select(['revoked_at', 'revoke_reason'])
          .where('id', '=', expired.id)
          .executeTakeFirstOrThrow();
        expect(expiredRow.revoked_at).not.toBeNull();
        expect(expiredRow.revoke_reason).toBe('rotated');

        const activeRow = await ctx
          .db!.selectFrom('agent_registration_keys')
          .select(['revoked_at'])
          .where('id', '=', active.id)
          .executeTakeFirstOrThrow();
        expect(activeRow.revoked_at).toBeNull();
      });
    });
  },
);
