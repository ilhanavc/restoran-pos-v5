/**
 * ADR-002 §13 — TTL cleanup cron testleri.
 *
 * DATABASE_URL set değilse skip edilir (CI'da Postgres koşar).
 *
 * Test senaryoları:
 *   1. purgeCallLogs: 30 günden eski call_logs silinir, yeniler kalır.
 *   2. purgeAuditLogs: 2 yıldan eski audit_logs silinir, yeniler kalır.
 *   3. Advisory lock collision: harici client lock alır → task silent exit.
 *   4. purgePrintJobs: 30 günden eski TERMİNAL job silinir; queued ASLA
 *      silinmez (ADR-004 Amd5 KVKK retention — paket fişi payload PII'si).
 *   5. purgeRefreshTokens: 37 günden eski token ANONİMLEŞTİRİLİR (satır
 *      SİLİNMEZ — üç PII kolonu NULL'lanır, `token_hash`/`family_id` aynen
 *      kalır); AKTİF oturuma ASLA dokunulmaz; sınır değeri (tam 7 gün grace)
 *      korunur; ikinci koşum aynı satırı tekrar işlemez (guard yüklemi);
 *      `cron_purger`'ın kolon-GRANT'i dışına UPDATE denemesi `42501` alır.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createKysely, type DB } from '@restoran-pos/db';
import { createAppTenantPool } from '../helpers/appTenantPool';
import { createCronPurgerPool } from '../helpers/cronPurgerPool';
import { CRON_LOCK_IDS } from '@restoran-pos/shared-domain';
import {
  purgeAuditLogs,
  purgeCallLogs,
  purgePrintJobs,
  purgeRefreshTokens,
} from '../../cron/ttl-cleanup.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('ttl-cleanup cron (ADR-002 §13)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  // ADR-041 F4a — cron RLS harness: purgeCallLogs `withTenant` sarımı (call_logs
  // RLS) yalnız app_tenant (NOBYPASSRLS) altında GERÇEKTEN sınanır. Superuser
  // pool ile sarım sökülse bile test yeşil kalırdı (sahte-yeşil, F2 dersi
  // [[feedback_rls_consumer_completeness_audit]]). Seed/assertion superuser `db`
  // ile; cron çağrısı app_tenant `appPool`/`appDb` ile.
  let appPool: Pool;
  let appDb: Kysely<DB>;
  // ADR-041 Amd5 K5/K6 — cron ARTIK prod'da `cron_purger` (BYPASSRLS) pool'uyla
  // koşuyor: audit_logs force-RLS'li (mig 063) ve cron'un `tenant_id IS NULL`
  // işleri (sistem-actor self-audit INSERT + NULL-tenant retention DELETE)
  // app_tenant ile İMKÂNSIZ. Test bu rolü `-c role=cron_purger` ile taklit eder
  // (süperuser her rolün üyesi → LOGIN/parola gerekmez; o yalnız prod adımı).
  // ⚠️ Süperuser `pool` ile koşulursa RLS hiç devreye girmez → yanlış rol
  // MASKELENİR (F4d-2'de purgePrintJobs tam bu tuzağa düşmüştü).
  let cronPool: Pool;
  let cronDb: Kysely<DB>;
  const tenantId = randomUUID();
  /** refresh_tokens → users(id, tenant_id) FK'si için fixture kullanıcı. */
  const userId = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    appPool = createAppTenantPool(DATABASE_URL ?? '');
    appDb = createKysely(appPool);
    cronPool = createCronPurgerPool(DATABASE_URL ?? '');
    cronDb = createKysely(cronPool);

    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        name: 'TTL Test Tenant',
        slug: `ttl-test-${tenantId.slice(0, 8)}`,
      })
      .execute();

    await sql`
      INSERT INTO users (id, tenant_id, role, username, password_hash, email)
      VALUES (${userId}::uuid, ${tenantId}::uuid, 'admin', ${`ttl-${userId.slice(0, 8)}`}, 'x',
              ${`ttl-${userId.slice(0, 8)}@local.test`})
    `.execute(db);
  });

  afterAll(async () => {
    // Best-effort cleanup; CASCADE FK olmadığı için manuel sırayla.
    // ⚠️ Sıra bağlayıcı: refresh_tokens → users → tenants (tenants FK'si
    // RESTRICT; users FK'si CASCADE ama parent_id zincirini önce boşaltmak
    // hata mesajını okunur tutuyor).
    await sql`DELETE FROM refresh_tokens WHERE tenant_id = ${tenantId}::uuid`.execute(
      db,
    );
    await sql`DELETE FROM users WHERE tenant_id = ${tenantId}::uuid`.execute(db);
    await sql`DELETE FROM call_logs WHERE tenant_id = ${tenantId}::uuid`.execute(
      db,
    );
    await sql`DELETE FROM print_jobs WHERE tenant_id = ${tenantId}::uuid`.execute(
      db,
    );
    await sql`DELETE FROM audit_logs WHERE tenant_id = ${tenantId}::uuid`.execute(
      db,
    );
    await sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`.execute(db);
    await db.destroy();
    await appDb.destroy();
    await cronDb.destroy();
  });

  it('purgeCallLogs: 30 günden eski silinir, yeniler kalır', async () => {
    const oldId = randomUUID();
    const newId = randomUUID();
    // 31 gün önce ve 5 gün önce iki kayıt insert et.
    await sql`
      INSERT INTO call_logs (id, tenant_id, normalized_phone, status, received_at)
      VALUES
        (${oldId}::uuid, ${tenantId}::uuid, '+905551112233', 'completed', now() - interval '31 days'),
        (${newId}::uuid, ${tenantId}::uuid, '+905551112244', 'completed', now() - interval '5 days')
    `.execute(db);

    // app_tenant altında koştur → withTenant sarımı RLS'e tabi. Sarım sökülürse
    // fail-closed 0 satır silinir → `not.toContain(oldId)` KIRMIZI (negatif-kontrol).
    // ADR-041 Amd5 K5 — prod'da üç task da `cron_purger` ile koşar. appPool
    // (app_tenant) ile koşmak DELETE'i doğru yapar (F4a sarımı sayesinde) ama
    // self-audit NULL INSERT'ini policy reddeder ve try/catch YUTAR → log'da
    // 42501, testte sessizlik. O degradasyon ayrı bir testle belgelendi
    // ("defense-in-depth" testi); burada prod-sadık rol kullanılır.
    await purgeCallLogs({ pool: cronPool, db: cronDb });

    const remaining = await db
      .selectFrom('call_logs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .execute();
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain(newId);
    expect(ids).not.toContain(oldId);
  });

  it('purgeAuditLogs: 2 yıldan eski silinir, yeniler kalır', async () => {
    const oldId = randomUUID();
    const newId = randomUUID();
    await sql`
      INSERT INTO audit_logs (id, tenant_id, event_type, payload, actor, created_at)
      VALUES
        (${oldId}::uuid, ${tenantId}::uuid, 'auth.login', '{}'::jsonb, '{}'::jsonb, now() - interval '3 years'),
        (${newId}::uuid, ${tenantId}::uuid, 'auth.login', '{}'::jsonb, '{}'::jsonb, now() - interval '7 days')
    `.execute(db);

    // ADR-041 Amd5 K5 — `cron_purger` (BYPASSRLS) ZORUNLU: audit_logs
    // force-RLS'li (mig 063) ve `purgeAuditLogs`'un İKİ pass'i var —
    // per-tenant (:245) **ve** `tenant_id IS NULL` sistem-actor (:274). NULL
    // pass'i `withTenant` ile sarılamaz (helper geçersiz UUID'de tx açmaz),
    // app_tenant ile de policy 0 satır döndürür. Süperuser `pool` ile koşmak
    // RLS'i tümden bypass eder → yanlış rol MASKELENİR (sahte-yeşil).
    await purgeAuditLogs({ pool: cronPool, db: cronDb });

    const remaining = await db
      .selectFrom('audit_logs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .execute();
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain(newId);
    expect(ids).not.toContain(oldId);
  });

  it('purgePrintJobs: 30 günden eski TERMİNAL job silinir; yeni terminal + eski queued KALIR', async () => {
    const oldSuccess = randomUUID();
    const newSuccess = randomUUID();
    const oldQueued = randomUUID();
    await sql`
      INSERT INTO print_jobs (id, tenant_id, status, payload, created_at, updated_at)
      VALUES
        (${oldSuccess}::uuid, ${tenantId}::uuid, 'success', '{"kind":"kitchen"}'::jsonb, now() - interval '40 days', now() - interval '31 days'),
        (${newSuccess}::uuid, ${tenantId}::uuid, 'success', '{"kind":"kitchen"}'::jsonb, now() - interval '10 days', now() - interval '5 days'),
        (${oldQueued}::uuid,  ${tenantId}::uuid, 'queued',  '{"kind":"kitchen"}'::jsonb, now() - interval '40 days', now() - interval '31 days')
    `.execute(db);

    // ADR-041 Amd5 K5 — prod-sadık rol: cron_purger (BYPASSRLS). Süperuser
    // `pool` ile koşulursa RLS tümden bypass olur ve yanlış rol maskelenir
    // (Amd4 K5 / F2 dersi, dosya başındaki not).
    await purgePrintJobs({ pool: cronPool, db: cronDb });

    const remaining = await db
      .selectFrom('print_jobs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .execute();
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain(newSuccess); // 30 günden yeni terminal → kalır
    expect(ids).toContain(oldQueued); // queued yaşına bakılmaksızın ASLA silinmez
    expect(ids).not.toContain(oldSuccess); // eski terminal → silindi
  });

  /**
   * ADR-041 Amd5 K5'in **defense-in-depth iddiasının sınırı** (S134 ampirik
   * bulgusu). K5, Amd4 K3'ün `withTenant` sarımının "pool yanlış yapılandırılırsa
   * ikinci ağ" olarak KALMASINA karar verdi. Bu test o iddianın tam olarak ne
   * kadarını karşıladığını kayda geçirir:
   *
   *   ✅ Retention DELETE'i app_tenant (NOBYPASSRLS) ile de DOĞRU çalışır —
   *      sarım tenant context'i sağlar, eski terminal kayıt silinir.
   *   ❌ Self-audit izi KAYBOLUR — `tenantId: null` INSERT'i policy'nin
   *      `WITH CHECK … AND tenant_id IS NOT NULL` koşuluna takılır (42501) ve
   *      task'ın try/catch'i hatayı YUTAR. Yani yanlış pool sessizce
   *      "sildim ama kaydetmedim" durumuna düşer.
   *
   * Bu kabul edilmiş bir degradasyondur (veri korunur, iz kaybolur) ve prod'da
   * M5 boot-assertion'ı (Amd5 K3) bu yapılandırmanın oluşmasını engeller.
   * Test bunu belgeler ki ileride "neden hem sarım hem bypass var" sorusunun
   * ve "log'da 42501 görüyorum" gözleminin cevabı kayıtlı olsun.
   */
  it('defense-in-depth: app_tenant pool ile DELETE doğru çalışır, self-audit izi kaybolur', async () => {
    const oldSuccess = randomUUID();
    const before = new Date();
    await sql`
      INSERT INTO print_jobs (id, tenant_id, status, payload, created_at, updated_at)
      VALUES (${oldSuccess}::uuid, ${tenantId}::uuid, 'success', '{"kind":"kitchen"}'::jsonb, now() - interval '40 days', now() - interval '31 days')
    `.execute(db);

    await purgePrintJobs({ pool: appPool, db: appDb });

    // (a) DELETE çalıştı — Amd4 K3 sarımının değeri.
    const remaining = await db
      .selectFrom('print_jobs')
      .select('id')
      .where('id', '=', oldSuccess)
      .execute();
    expect(remaining).toHaveLength(0);

    // (b) Ama self-audit yazılamadı — bu çağrıya ait `audit.purge` satırı YOK.
    const selfAudit = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM audit_logs
      WHERE tenant_id IS NULL
        AND event_type = 'audit.purge'
        AND payload->>'table' = 'print_jobs'
        AND created_at >= ${before.toISOString()}::timestamptz
    `.execute(db);
    expect(selfAudit.rows[0]?.n).toBe(0);
  });

  /**
   * KVKK m.7 — `refresh_tokens` 37 gün retention'ı (migration `002:16`'da beyan
   * edilmiş, S136'da uygulandı). Satırlar
   * `ip_address`/`user_agent`/`device_label` tutar.
   *
   * ⚠️ DÖRT TASK'IN TEK İSTİSNASI: bu task satır SİLMEZ, üç PII kolonunu
   * NULL'lar (anonimleştirme — gerekçe `ttl-cleanup.ts`
   * `REFRESH_TOKEN_GRACE_DAYS` JSDoc'unda; GRANT tarafı migration 067).
   * Bu yüzden assertion'ların omurgası "satır gitti mi" DEĞİL:
   *   • üç PII kolonu NULL OLDU mu, ve
   *   • `token_hash` + `family_id` DEĞİŞMEDEN kaldı mı
   * (ikincisi kritik: reuse-detection'ın süresiz korunduğunun tek kanıtı o).
   *
   * ⚠️ Bu blok TETİKLEYİCİ vaka seçer ([[feedback_test_picked_non_triggering_case]]):
   * yüklem `expires_at < now() - 7 gün` olduğu için yalnızca "eski" ve "yeni"
   * iki satır üretmek yeterli DEĞİL — sınırın İKİ YANINDA birer satır ve
   * yaşına bakılmaksızın korunması gereken bir AKTİF satır gerekir.
   */
  describe('purgeRefreshTokens (KVKK m.7 — 37 gün anonimleştirme)', () => {
    /** Tek bir RTR ailesi — zincir testinde sınır linki bu aileden çıkar. */
    const familyId = randomUUID();

    /**
     * Token satırı yazar. `token_hash` global UNIQUE (ADR-002 §4.2) → id'den
     * türetilen sha256 ile çakışma olmaz. Üç PII kolonu da DOLU yazılır:
     * anonimleştirmenin gerçekten bir şey değiştirdiğini ancak dolu bir
     * başlangıç hâli kanıtlar (NULL'dan NULL'a geçiş hiçbir şey ispatlamaz).
     */
    const insertToken = async (opts: {
      id: string;
      /** `expires_at = now() + <interval>`; negatif interval geçmişi gösterir. */
      expiresAt: string;
      revoked: boolean;
      parentId?: string;
    }): Promise<void> => {
      await sql`
        INSERT INTO refresh_tokens
          (id, tenant_id, user_id, token_hash, parent_id, family_id,
           expires_at, revoked_at, revoked_reason, ip_address, user_agent,
           device_label)
        VALUES (
          ${opts.id}::uuid, ${tenantId}::uuid, ${userId}::uuid,
          sha256(${opts.id}::text::bytea),
          ${opts.parentId ?? null}::uuid,
          ${familyId}::uuid,
          now() + ${opts.expiresAt}::interval,
          ${opts.revoked ? sql`now() - interval '1 day'` : sql`NULL`},
          ${opts.revoked ? 'rotated' : null},
          '10.0.0.7'::inet, 'vitest', 'iPhone 15'
        )
      `.execute(db);
    };

    interface PiiState {
      id: string;
      ip_null: boolean;
      ua_null: boolean;
      device_null: boolean;
      /** `token_hash` INSERT'teki değerle birebir aynı mı? */
      hash_intact: boolean;
      family_intact: boolean;
      parent_id: string | null;
    }

    /**
     * Her satırın PII durumunu VE kimlik kolonlarının bozulmadığını tek
     * sorguda okur. `hash_intact` DB tarafında `sha256(id)` ile yeniden
     * hesaplanıp karşılaştırılır — yani "hash'e dokunulmadı" iddiası
     * uygulamadan değil, verinin kendisinden doğrulanır.
     */
    const piiStates = async (): Promise<PiiState[]> => {
      const rows = await sql<PiiState>`
        SELECT id,
               ip_address   IS NULL AS ip_null,
               user_agent   IS NULL AS ua_null,
               device_label IS NULL AS device_null,
               token_hash = sha256(id::text::bytea) AS hash_intact,
               family_id = ${familyId}::uuid        AS family_intact,
               parent_id
          FROM refresh_tokens
         WHERE tenant_id = ${tenantId}::uuid
      `.execute(db);
      return rows.rows;
    };

    const stateOf = (states: PiiState[], id: string): PiiState => {
      const found = states.find((s) => s.id === id);
      if (found === undefined) {
        // 🔴 Satır KAYBOLMUŞ demektir. Anonimleştirme hiçbir satır silmez;
        // bu yüzden "bulunamadı" sessizce atlanacak bir durum değil, testin
        // en önemli regresyonudur ve açık mesajla patlamalı.
        throw new Error(`refresh_tokens satırı SİLİNMİŞ (olmamalıydı): ${id}`);
      }
      return found;
    };

    /**
     * ⚠️ Temizlik `afterEach`'te, test gövdesinin SONUNDA değil: bir assert
     * patlarsa gövde sonundaki temizlik hiç koşmaz ve artık satırlar bir
     * SONRAKİ testi de kırardı (negatif kontrolde tam bu görüldü — mig 066
     * sökülünce zincir testi kırıldı, artıkları self-audit testini de
     * düşürdü). Teşhisi bulanıklaştıran bu zinciri kesiyoruz.
     */
    afterEach(async () => {
      await sql`DELETE FROM refresh_tokens WHERE tenant_id = ${tenantId}::uuid`.execute(
        db,
      );
      await sql`
        DELETE FROM audit_logs
         WHERE tenant_id IS NULL AND event_type = 'audit.purge'
           AND payload->>'table' = 'refresh_tokens'
      `.execute(db);
    });

    /**
     * Sahte-yeşil kapısı ([[feedback_verify_role_switch_with_current_user]]):
     * cron pool'u GERÇEKTEN `cron_purger` mı, yoksa süperuser mı? Süperuser
     * RLS'e tabi değildir → yanlış rol maskelenir ve bu bloğun tamamı
     * anlamsızlaşır. Aynı test `refresh_tokens`'ın force-RLS'li olduğunu da
     * ampirik gösterir: app_tenant context'siz 0 satır görür.
     */
    it('ROL TEYİDİ: cron pool = cron_purger (BYPASSRLS), app_tenant context\'siz 0 satır görür', async () => {
      const probeId = randomUUID();
      await insertToken({ id: probeId, expiresAt: '20 days', revoked: false });

      const cronWho = await sql<{ u: string }>`
        SELECT current_user AS u
      `.execute(cronDb);
      expect(cronWho.rows[0]?.u).toBe('cron_purger');

      const appWho = await sql<{ u: string }>`
        SELECT current_user AS u
      `.execute(appDb);
      expect(appWho.rows[0]?.u).toBe('app_tenant');

      // BYPASSRLS → satırı GÖRÜR.
      const cronSees = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM refresh_tokens WHERE id = ${probeId}::uuid
      `.execute(cronDb);
      expect(cronSees.rows[0]?.n).toBe(1);

      // NOBYPASSRLS + tenant context YOK → mig 065 policy fail-closed.
      const appSees = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM refresh_tokens WHERE id = ${probeId}::uuid
      `.execute(appDb);
      expect(appSees.rows[0]?.n).toBe(0);

      // 🔒 YETKİ İNVARYANTI — mig 067'nin KOLON-SEVİYESİ daraltmasının kanıtı.
      //
      // `cron_purger`'ın TABLO GENELİ UPDATE yetkisi hâlâ YOKTUR; yetki yalnız
      // üç PII kolonunda verilmiştir (`GRANT UPDATE (ip_address, user_agent,
      // device_label)`). Bu bilinçli bir daraltmadır: rol BYPASSRLS'tir (mig
      // 000:23), yani RLS onu hiç kısıtlamaz ve kalan tek savunma GRANT'tir.
      // Tablo geneli UPDATE verilmiş olsa `token_hash` (kimlik sırrı),
      // `revoked_at`/`revoked_reason` (reuse-detection durumu) ve `expires_at`
      // (oturum ömrü — ileriye çekilirse canlı oturum süresiz uzatılabilirdi)
      // da yazılabilir olurdu.
      //
      // Negatif taraf (`c_hash`/`c_revoked`/`c_expires` = false) asıl
      // kilitlenen şeydir: biri ileride tabloya geniş UPDATE verirse bu
      // assertion KIRMIZI verir. S134'ün eksik/fazla-GRANT sınıfı sessiz
      // kalmasın.
      const cronUpd = await sql<{
        table_update: boolean;
        c_ip: boolean;
        c_ua: boolean;
        c_dev: boolean;
        c_hash: boolean;
        c_revoked: boolean;
        c_expires: boolean;
      }>`
        SELECT has_table_privilege(current_user,'refresh_tokens','UPDATE')
                 AS table_update,
               has_column_privilege(current_user,'refresh_tokens','ip_address','UPDATE')
                 AS c_ip,
               has_column_privilege(current_user,'refresh_tokens','user_agent','UPDATE')
                 AS c_ua,
               has_column_privilege(current_user,'refresh_tokens','device_label','UPDATE')
                 AS c_dev,
               has_column_privilege(current_user,'refresh_tokens','token_hash','UPDATE')
                 AS c_hash,
               has_column_privilege(current_user,'refresh_tokens','revoked_at','UPDATE')
                 AS c_revoked,
               has_column_privilege(current_user,'refresh_tokens','expires_at','UPDATE')
                 AS c_expires
      `.execute(cronDb);
      expect(cronUpd.rows[0]).toEqual({
        table_update: false,
        c_ip: true,
        c_ua: true,
        c_dev: true,
        c_hash: false,
        c_revoked: false,
        c_expires: false,
      });
    });

    /**
     * Kolon-GRANT'inin **davranışsal** kanıtı (introspection tek başına
     * yetmez — `has_column_privilege` yanlış okunabilir, gerçek DML
     * reddedilmezse daraltma kâğıt üstünde kalır).
     *
     * ⚠️ Her UPDATE AYRI bir bağlantı/istekte koşmalı: `42501` transaction'ı
     * abort eder, aynı tx'te ikinci sorgu `25P02` verirdi. Kysely'nin her
     * `sql``.execute(cronDb)` çağrısı kendi auto-commit'inde koştuğu için bu
     * sağlanıyor.
     */
    it('kolon-GRANT daraltması: cron_purger üç PII kolonunu NULL\'layabilir, token_hash/expires_at/revoked_at UPDATE\'i 42501 ile REDDEDİLİR', async () => {
      const probeId = randomUUID();
      await insertToken({ id: probeId, expiresAt: '-45 days', revoked: true });

      // (a) İzin verilen: üç PII kolonu.
      await sql`
        UPDATE refresh_tokens
           SET ip_address = NULL, user_agent = NULL, device_label = NULL
         WHERE id = ${probeId}::uuid
      `.execute(cronDb);
      const after = stateOf(await piiStates(), probeId);
      expect(after.ip_null).toBe(true);
      expect(after.ua_null).toBe(true);
      expect(after.device_null).toBe(true);
      expect(after.hash_intact).toBe(true);

      // (b) Reddedilenler. `42501` = insufficient_privilege.
      // ⚠️ Thunk dizisi, hazır Promise dizisi DEĞİL: hazır promise'ler anında
      // koşar ve sıradaki `await`'e kadar "unhandled rejection" olarak durur.
      const forbidden: Array<[string, () => Promise<unknown>]> = [
        [
          'token_hash',
          () =>
            sql`UPDATE refresh_tokens SET token_hash = sha256('hijack'::bytea)
                 WHERE id = ${probeId}::uuid`.execute(cronDb),
        ],
        [
          'expires_at',
          () =>
            sql`UPDATE refresh_tokens SET expires_at = now() + interval '365 days'
                 WHERE id = ${probeId}::uuid`.execute(cronDb),
        ],
        [
          'revoked_at',
          () =>
            sql`UPDATE refresh_tokens SET revoked_at = NULL
                 WHERE id = ${probeId}::uuid`.execute(cronDb),
        ],
      ];
      // Mesaja değil HATA KODUNA bak (migration denetimi önerisi): test adı
      // `42501` vaat ediyor ve mesaj metni Postgres sürümüne/yerelleştirmeye
      // göre değişebilir; `code` kararlı sözleşmedir.
      for (const [column, attempt] of forbidden) {
        let caught: unknown;
        try {
          await attempt();
        } catch (err) {
          caught = err;
        }
        expect(caught, `${column} UPDATE reddedilmeliydi`).toBeDefined();
        expect(
          (caught as { code?: string }).code,
          `${column} UPDATE 42501 vermeliydi`,
        ).toBe('42501');
      }

      // Reddedilen denemelerin HİÇBİRİ veriyi değiştirmedi.
      const final = stateOf(await piiStates(), probeId);
      expect(final.hash_intact).toBe(true);
      expect(final.family_intact).toBe(true);
    });

    it('37 günden eski (revoked dâhil) ANONİMLEŞTİRİLİR — token_hash/family_id DEĞİŞMEZ; sınır içindeki, yeni ve AKTİF token\'a DOKUNULMAZ', async () => {
      const wayOld = randomUUID(); // 45 gün önce expire → ANONİMLEŞİR
      const justOver = randomUUID(); // 7 gün + 1 dk önce expire → ANONİMLEŞİR (sınırın dışı)
      const atBoundary = randomUUID(); // 7 gün - 1 dk önce expire → DOKUNULMAZ (sınırın içi)
      const recentlyExpired = randomUUID(); // dün expire → DOKUNULMAZ
      const revokedOld = randomUUID(); // revoked + 30 gün önce expire → ANONİMLEŞİR
      const revokedFresh = randomUUID(); // revoked ama expires_at gelecekte → DOKUNULMAZ
      const active = randomUUID(); // AKTİF oturum → ASLA DOKUNULMAZ

      await insertToken({ id: wayOld, expiresAt: '-45 days', revoked: true });
      await insertToken({
        id: justOver,
        expiresAt: '-7 days -1 minutes',
        revoked: false,
      });
      await insertToken({
        id: atBoundary,
        expiresAt: '-7 days +1 minutes',
        revoked: false,
      });
      await insertToken({
        id: recentlyExpired,
        expiresAt: '-1 days',
        revoked: false,
      });
      await insertToken({
        id: revokedOld,
        expiresAt: '-30 days',
        revoked: true,
      });
      await insertToken({
        id: revokedFresh,
        expiresAt: '10 days',
        revoked: true,
      });
      await insertToken({ id: active, expiresAt: '20 days', revoked: false });

      await purgeRefreshTokens({ pool: cronPool, db: cronDb });

      // 🔴 Önce: HİÇBİR SATIR SİLİNMEDİ (anonimleştirme satır sayısını
      // değiştirmez). `stateOf` bulunamayan id'de açık mesajla patlar.
      const states = await piiStates();
      expect(states).toHaveLength(7);

      // Anonimleştirilenler — sınırın DIŞI.
      for (const id of [wayOld, justOver, revokedOld]) {
        const s = stateOf(states, id);
        expect(s.ip_null).toBe(true);
        expect(s.ua_null).toBe(true);
        expect(s.device_null).toBe(true);
        // 🔑 KRİTİK: reuse-detection'ın korunduğunun kanıtı. Bu iki kolon
        // bozulursa çalınmış eski bir token sunulduğunda `findByTokenHash`
        // onu bulamaz → aile iptali ve `logger.warn` izi kaybolur.
        expect(s.hash_intact).toBe(true);
        expect(s.family_intact).toBe(true);
      }

      // DOKUNULMAYANLAR — PII'leri AYNEN duruyor.
      // atBoundary/recentlyExpired: sınır değeri, tam 7 günün İÇİ → pay korunur.
      // revokedFresh: revoke edilmiş ama henüz expire olmamış → yaşlanmasını bekler.
      // active: 🔴 EN KRİTİK REGRESYON — canlı oturumun verisine dokunmak.
      for (const id of [atBoundary, recentlyExpired, revokedFresh, active]) {
        const s = stateOf(states, id);
        expect(s.ip_null).toBe(false);
        expect(s.ua_null).toBe(false);
        expect(s.device_null).toBe(false);
        expect(s.hash_intact).toBe(true);
      }
    });

    /**
     * Guard yükleminin (`… IS NOT NULL`) kanıtı — iki ayrı başarısızlık modunu
     * birden kapatır:
     *   1. **Sayaç şişmesi:** guard olmasa aynı satırlar her gece yeniden
     *        UPDATE edilir, `audit.purge` sayacı yapay olarak büyür ve
     *        watchdog'un "anlamlı iş yapıldı mı" sinyali anlamını kaybeder.
     *   2. **Döngü sonlanması:** `for(;;)` "etkilenen < BATCH_LIMIT" ile biter;
     *        victim kümesi küçülmezse 10k'dan fazla uygun satırda SONSUZ döngü.
     * Buradaki assertion birinciyi ölçüyor (ikincisi ancak 10k+ satırla
     * tetiklenir — birim testte üretilmesi anlamsız, guard aynı yüklem).
     */
    it('ikinci koşum aynı satırları TEKRAR işlemez (guard yüklemi) — ikinci iz anonimleştirilen=0', async () => {
      const before = new Date();
      const old = randomUUID();
      await insertToken({ id: old, expiresAt: '-45 days', revoked: true });

      await purgeRefreshTokens({ pool: cronPool, db: cronDb });
      await purgeRefreshTokens({ pool: cronPool, db: cronDb });

      const traces = await sql<{ deleted_count: string | null }>`
        SELECT payload->>'deleted_count' AS deleted_count
          FROM audit_logs
         WHERE tenant_id IS NULL
           AND event_type = 'audit.purge'
           AND payload->>'table' = 'refresh_tokens'
           AND created_at >= ${before.toISOString()}::timestamptz
         ORDER BY created_at
      `.execute(db);
      expect(traces.rows).toHaveLength(2);
      expect(Number(traces.rows[0]?.deleted_count)).toBe(1);
      // Guard çalışıyor: ikinci gece yapacak iş YOK.
      expect(Number(traces.rows[1]?.deleted_count)).toBe(0);

      // Satır hâlâ orada ve PII'si NULL (idempotent sonuç).
      const s = stateOf(await piiStates(), old);
      expect(s.ip_null).toBe(true);
      expect(s.hash_intact).toBe(true);
    });

    /**
     * 🔴 ANONİMLEŞTİRME KARARININ ÇEKİRDEK SENARYOSU — güvenlik denetiminin
     * bulduğu kayıp tam olarak buydu.
     *
     * Gerçek RTR zinciri A ← B ← C: `expires_at` zincirde monoton artar (her
     * rotasyon +30 gün sliding) → cutoff A ile B arasına düşer, yani **ailenin
     * head'i (C) CANLI iken atası (A) 37 günü aşmıştır**. "Uzun ömürlü aile"
     * teorik değil, her gün kullanılan bir cihazın normal hâlidir.
     *
     * SİLME davranışında A yok olurdu: A çalınıp sunulsa `findByTokenHash`
     * bulamaz → `AUTH_REFRESH_INVALID`, **canlı oturum (C) devam eder, iz
     * kalmaz**. ANONİMLEŞTİRMEDE A durur: `token_hash` bulunur, `revoked_at`
     * yaşı grace'in (varsayılan 60 sn, tavan 5 dk) çok üstündedir →
     * `revokeFamilyAll('reuse_detected')` canlı oturumu KAPATIR + `logger.warn`
     * izi düşer. Bu testin kilitlediği invaryant: **A'nın kimlik kolonları
     * yaşına rağmen bozulmaz.**
     *
     * Yan fayda: `parent_id` zinciri de bozulmaz (hiçbir satır silinmediği için
     * mig 066'nın `ON DELETE SET NULL`'ı hiç tetiklenmez) → rotasyon
     * çatallanması adli sinyali korunur.
     */
    it('uzun ömürlü RTR ailesi: 37 günü aşan ATA anonimleşir ama token_hash/family_id/parent_id zinciri BOZULMAZ (reuse-detection korunur)', async () => {
      const a = randomUUID();
      const b = randomUUID();
      const c = randomUUID();
      await insertToken({ id: a, expiresAt: '-40 days', revoked: true });
      await insertToken({
        id: b,
        expiresAt: '-3 days',
        revoked: true,
        parentId: a,
      });
      await insertToken({
        id: c,
        expiresAt: '+20 days',
        revoked: false,
        parentId: b,
      });

      await purgeRefreshTokens({ pool: cronPool, db: cronDb });

      const states = await piiStates();
      expect(states).toHaveLength(3); // hiçbiri silinmedi

      const sa = stateOf(states, a);
      expect(sa.ip_null).toBe(true); // PII gitti (KVKK m.7)
      expect(sa.ua_null).toBe(true);
      expect(sa.device_null).toBe(true);
      expect(sa.hash_intact).toBe(true); // 🔑 reuse-detection anahtarı DURUYOR
      expect(sa.family_intact).toBe(true);

      // B ve C sınırın içinde → hiç dokunulmadı.
      expect(stateOf(states, b).ip_null).toBe(false);
      expect(stateOf(states, c).ip_null).toBe(false);

      // Zincir aynen ayakta — hiçbir `parent_id` NULL'a düşmedi.
      expect(stateOf(states, b).parent_id).toBe(a);
      expect(stateOf(states, c).parent_id).toBe(b);
    });

    /**
     * S135'in ampirik bulgusunun bu tabloda kayda geçmesi + watchdog'un
     * `refresh_tokens` için neden `zeroIsSuspicious: true` olduğunun kanıtı:
     * force-RLS altında YANLIŞ rolle koşan bir UPDATE **hata fırlatmaz**,
     * `rowCount=0` ile sessizce "başarılı" döner. Yani pool yanlış
     * yapılandırılırsa (`CRON_DATABASE_URL` eksik/yanlış) retention sessizce
     * ölür ve `ip_address`/`user_agent`/`device_label` süresiz saklanır —
     * log'da tek iz `deleted_count: 0`'dır. Alarmın okuduğu sinyal tam olarak
     * budur ve S136'da oracle ile yanlış-pozitiften ayrıştırıldı.
     *
     * (print_jobs'ın muadil "defense-in-depth" testinin AKSİNE burada UPDATE
     * doğru çalışMAZ: `purgeRefreshTokens` bilinçli olarak `withTenant`
     * sarmaz — prod'da paylaşımlı BYPASSRLS cron pool'uyla koşar, bkz.
     * `batchAnonymizeRefreshTokens`.)
     */
    it('negatif kontrol: app_tenant pool SESSİZCE 0 satır anonimleştirir (hata fırlatmaz)', async () => {
      const old = randomUUID();
      await insertToken({ id: old, expiresAt: '-45 days', revoked: true });

      await expect(
        purgeRefreshTokens({ pool: appPool, db: appDb }),
      ).resolves.toBeUndefined();

      // PII HÂLÂ orada — sessiz bozulma.
      const s = stateOf(await piiStates(), old);
      expect(s.ip_null).toBe(false);
      expect(s.ua_null).toBe(false);
      expect(s.device_null).toBe(false);
    });

    it('self-audit: `audit.purge` izi `table:refresh_tokens` + `operation:anonymize` ile yazılır (watchdog `deleted_count`\'u okur)', async () => {
      const before = new Date();
      const old = randomUUID();
      await insertToken({ id: old, expiresAt: '-45 days', revoked: true });

      await purgeRefreshTokens({ pool: cronPool, db: cronDb });

      const trace = await sql<{
        deleted_count: string | null;
        operation: string | null;
      }>`
        SELECT payload->>'deleted_count' AS deleted_count,
               payload->>'operation'     AS operation
          FROM audit_logs
         WHERE tenant_id IS NULL
           AND event_type = 'audit.purge'
           AND payload->>'table' = 'refresh_tokens'
           AND created_at >= ${before.toISOString()}::timestamptz
      `.execute(db);
      expect(trace.rows).toHaveLength(1);
      // ⚠️ Anahtar adı bilinçli olarak `deleted_count` KALDI: watchdog'un
      // okuduğu kontrat odur, yeniden adlandırmak onu sessizce kör ederdi.
      // Anlam farkını `operation` taşır — sanitizer allow-list'inden geçtiğini
      // de bu assertion doğrular ([[feedback_zod_schema_silently_drops_field]]:
      // listede olmayan alan HATA VERMEDEN düşerdi).
      expect(Number(trace.rows[0]?.deleted_count)).toBeGreaterThanOrEqual(1);
      expect(trace.rows[0]?.operation).toBe('anonymize');
    });
  });

  it('advisory lock collision: harici client lock tutuyorsa silent exit', async () => {
    const oldId = randomUUID();
    await sql`
      INSERT INTO call_logs (id, tenant_id, normalized_phone, status, received_at)
      VALUES
        (${oldId}::uuid, ${tenantId}::uuid, '+905557778899', 'completed', now() - interval '60 days')
    `.execute(db);

    const lockId = CRON_LOCK_IDS.TTL_CLEANUP_CALL_LOGS.toString();
    const blocker = await pool.connect();
    try {
      const got = await blocker.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [lockId],
      );
      expect(got.rows[0]?.acquired).toBe(true);

      // Lock zaten harici clientte → task silent exit, throw atmaz, satırı silmez.
      await expect(purgeCallLogs({ pool, db })).resolves.toBeUndefined();

      const stillThere = await db
        .selectFrom('call_logs')
        .select('id')
        .where('id', '=', oldId)
        .execute();
      expect(stillThere.map((r) => r.id)).toContain(oldId);
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [lockId]);
      blocker.release();
    }

    // Lock serbest → ikinci çağrı satırı silsin (cleanup için).
    await purgeCallLogs({ pool, db });
    const after = await db
      .selectFrom('call_logs')
      .select('id')
      .where('id', '=', oldId)
      .execute();
    expect(after).toHaveLength(0);
  });
});
