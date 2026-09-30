import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import { createKysely, createPool, type DB } from '@restoran-pos/db';
import { CRON_LOCK_IDS } from '@restoran-pos/shared-domain';
import { createAppTenantPool } from '../helpers/appTenantPool';
import { createCronPurgerPool } from '../helpers/cronPurgerPool';
import { runRetentionWatchdog } from '../../cron/retention-watchdog.js';
import { captureError } from '../../observability/sentry.js';

/**
 * Sentry kanalı mock'lanır: alarmın yalnız dönüş değerinde değil, **gerçekten
 * Sentry'ye gönderildiğini** de doğrulamak için (Amd6 K4). Mock olmadan
 * "alarm üretildi" ile "alarm bildirildi" arasındaki fark test edilmemiş kalırdı.
 */
vi.mock('../../observability/sentry.js', () => ({
  captureError: vi.fn(),
}));

/**
 * ADR-041 Amendment 6 — retention watchdog testleri.
 *
 * Watchdog, gece TTL-cleanup cron'unun üç task'ının gerçekten koştuğunu
 * `audit.purge` izlerinden doğrular. Kanıtlanması gereken iki şey var:
 *   (a) sağlıklı durumda SUSMASI (yanlış alarm üretmemesi) — alarm yorgunluğu
 *       en büyük başarısızlık modu,
 *   (b) her bozulma sınıfında KONUŞMASI.
 *
 * ⚠️ Fixture izolasyonu: `audit.purge` satırları **NULL-tenant** olduğu için
 * tenant'a göre ayrıştırılamaz. Bu yüzden her test kendi penceresini kurar:
 * `beforeEach` pencere içindeki TÜM `audit.purge` satırlarını siler (başka
 * testlerin/koşumların artıkları yanlış yeşil üretirdi — `pos_test`'te gerçekten
 * artık satırlar bulundu). Silme süperuser pool'uyla yapılır; `app_tenant`
 * bunu yapamaz (mig 063: DELETE policy YOK).
 */

const DB_URL = process.env['DATABASE_URL'];

const WINDOW_HOURS = 26;

/**
 * ⚠️ GÜVENLİK KİLİDİ (qa bulgusu + memory `feedback_local_test_db_separate`):
 * bu dosya `DELETE FROM audit_logs WHERE tenant_id IS NULL` çalıştırır — yani
 * yanlışlıkla `pos_dev`'e (veya prod'a!) yönlenirse **gerçek `audit.purge`
 * izlerini siler** ve retention kanıtını yok eder. Diğer test dosyaları
 * tenant-scoped sildiği için bu risk onlarda yok; burada NULL-tenant sildiğimiz
 * için var. Bu yüzden DB adı `test` içermiyorsa blok hiç koşmaz.
 */
const IS_TEST_DB = DB_URL !== undefined && /test/i.test(DB_URL);

describe.skipIf(DB_URL === undefined || DB_URL.length === 0 || !IS_TEST_DB)(
  'ADR-041 Amd6 — retention watchdog',
  () => {
    // Fixture/temizlik: süperuser (RLS'e tabi değil, DELETE yapabilir).
    let pool: Pool;
    let db: Kysely<DB>;
    // Watchdog'un prod'daki bağlantısı: cron_purger (BYPASSRLS).
    let cronPool: Pool;
    let cronDb: Kysely<DB>;
    // Negatif kontrol için: app_tenant (NOBYPASSRLS).
    let appPool: Pool;
    let appDb: Kysely<DB>;

    /** Pencere içine bir `audit.purge` izi yazar (sistem-actor, NULL tenant). */
    const writeTrace = async (
      table: string,
      deletedCount: number,
      ageHours = 1,
    ): Promise<void> => {
      // ⚠️ `jsonb_build_object` variadic "any" aldığı için PostgreSQL parametre
      // tipini çıkaramaz ("could not determine data type of parameter $1") →
      // her bind explicit cast'li.
      await sql`
        INSERT INTO audit_logs (id, tenant_id, event_type, payload, actor, created_at)
        VALUES (
          gen_random_uuid(), NULL, 'audit.purge',
          jsonb_build_object(
            'table', ${table}::text,
            'deleted_count', ${deletedCount}::int
          ),
          '{}'::jsonb,
          now() - make_interval(hours => ${ageHours}::int)
        )
      `.execute(db);
    };

    /** Üç task da sağlıklı iz bıraksın (audit_logs bilerek 0 — K3 istisnası). */
    const writeHealthyNight = async (): Promise<void> => {
      await writeTrace('audit_logs', 0);
      await writeTrace('call_logs', 23);
      await writeTrace('print_jobs', 207);
    };

    beforeAll(() => {
      pool = createPool({ connectionString: DB_URL ?? '' });
      db = createKysely(pool);
      cronPool = createCronPurgerPool(DB_URL ?? '');
      cronDb = createKysely(cronPool);
      appPool = createAppTenantPool(DB_URL ?? '');
      appDb = createKysely(appPool);
    });

    afterAll(async () => {
      await sql`
        DELETE FROM audit_logs
         WHERE tenant_id IS NULL AND event_type = 'audit.purge'
           AND created_at > now() - make_interval(hours => ${WINDOW_HOURS + 24})
      `.execute(db);
      await db.destroy();
      await cronDb.destroy();
      await appDb.destroy();
    });

    beforeEach(async () => {
      // Pencereyi temizle — artık satırlar testleri sahte-yeşil yapardı.
      await sql`
        DELETE FROM audit_logs
         WHERE tenant_id IS NULL AND event_type = 'audit.purge'
           AND created_at > now() - make_interval(hours => ${WINDOW_HOURS + 24})
      `.execute(db);
      vi.mocked(captureError).mockClear();
    });

    it('sağlıklı gece: üç task iz bıraktı → alarm YOK, Sentry sessiz', async () => {
      await writeHealthyNight();
      const alerts = await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      expect(alerts).toEqual([]);
      // Amd6 K4 — sağlıklı durumda Sentry'ye event GİTMEMELİ (alarm yorgunluğu).
      expect(captureError).not.toHaveBeenCalled();
    });

    it('bir task iz bırakmadı → alarm (mesajda task adı)', async () => {
      await writeTrace('audit_logs', 0);
      await writeTrace('call_logs', 23);
      // print_jobs YOK — cron koşmadı ya da self-audit'i sessizce başarısız oldu.
      const alerts = await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('print_jobs');
      expect(alerts[0]).toContain('audit.purge izi BIRAKMADI');
    });

    it('hiç task koşmadı → üç alarm (cron tamamen ölü)', async () => {
      const alerts = await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      expect(alerts).toHaveLength(3);
    });

    it('print_jobs deleted_count=0 → alarm (retention sessizce kırılmış olabilir)', async () => {
      await writeTrace('audit_logs', 0);
      await writeTrace('call_logs', 23);
      await writeTrace('print_jobs', 0);
      const alerts = await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('print_jobs');
      expect(alerts[0]).toContain('deleted_count=0');
    });

    /**
     * Amd6 K3'ün KRİTİK ayrımı. Bu test olmadan watchdog her gün yanlış alarm
     * çalar: audit retention 2 yıl ve en eski kayıt 2026-07-04 → ilk gerçek
     * silme 2028'de, yani `deleted_count: 0` bugün SAĞLIKLI durumdur.
     */
    it('audit_logs deleted_count=0 → alarm YOK (2 yıl retention, K3 istisnası)', async () => {
      await writeTrace('audit_logs', 0);
      await writeTrace('call_logs', 5);
      await writeTrace('print_jobs', 12);
      const alerts = await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      expect(alerts).toEqual([]);
    });

    it('call_logs deleted_count=0 → alarm (KVKK 30-gün retention kırılmış olabilir)', async () => {
      await writeTrace('audit_logs', 0);
      await writeTrace('call_logs', 0);
      await writeTrace('print_jobs', 12);
      const alerts = await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('call_logs');
      expect(alerts[0]).toContain('deleted_count=0');
    });

    it('alarm üretilince Sentry kanalına da gider (Amd6 K4)', async () => {
      await writeTrace('audit_logs', 0);
      await writeTrace('call_logs', 23);
      // print_jobs eksik → bir alarm.
      const alerts = await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      expect(alerts).toHaveLength(1);
      // Dönüş değeri değil, BİLDİRİM kanalı doğrulanıyor: her alarm için bir
      // `captureError(Error)` çağrısı. Mevcut kanal kullanılıyor (yeni Sentry
      // yüzeyi açılmadı) → ADR-040 beforeSend/deepRedact PII temizliği geçerli.
      expect(captureError).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(captureError).mock.calls[0]?.[0];
      expect(arg).toBeInstanceOf(Error);
      expect((arg as Error).message).toContain('print_jobs');
    });

    /**
     * Amd6 K7 — watchdog kendi başarısızlığını YUTMAZ. `ttl-cleanup.ts`'in
     * task'ları hatayı `logger.error`'a yazıp yutuyor ve S134'te bulunan
     * sessizliğin kaynağı tam olarak buydu; alarmın kendisi aynı tuzağa
     * düşerse "alarmı izleyen alarm yok" durumu doğar.
     */
    it('kontrol sorgusu patlarsa captureError ile raporlanır, sessizce yutulmaz', async () => {
      // Erişilemez bir DB → kontrol sorgusu KESİN fırlatır. (Kapatılmış bir
      // Kysely yetmedi: pool yeniden bağlanıp boş sonuç döndürüyor, bu da
      // "üç task da koşmamış" alarmı üretip senaryoyu maskeliyordu.)
      // Lock sağlam `cronPool`'dan alınır → patlayan YALNIZ kontrol sorgusudur,
      // yani K7'nin tam senaryosu.
      const brokenPool = new Pool({
        connectionString:
          'postgresql://no_such_role:x@127.0.0.1:5432/no_such_db',
        connectionTimeoutMillis: 3000,
      });
      const brokenDb = createKysely(brokenPool);

      const alerts = await runRetentionWatchdog({
        pool: cronPool,
        db: brokenDb,
      });
      await brokenPool.end().catch(() => {
        /* zaten kopuk */
      });

      // Bulgu yok (sorgu koşamadı) ama SESSİZ de değil: hata raporlandı.
      expect(alerts).toEqual([]);
      expect(captureError).toHaveBeenCalledTimes(1);
      expect(vi.mocked(captureError).mock.calls[0]?.[0]).toBeInstanceOf(Error);
    });

    /**
     * ttl-cleanup'ın advisory-lock deseni: iki instance aynı anda koşmasın.
     * Lock tutulduğunda watchdog sessiz çıkar — alarm ÜRETMEZ (yoksa her
     * çakışmada yanlış alarm çalardı).
     */
    it('advisory lock başkasındaysa sessiz çıkar (alarm üretmez)', async () => {
      await writeHealthyNight();
      const blocker = await cronPool.connect();
      try {
        const held = await blocker.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS locked',
          [CRON_LOCK_IDS.RETENTION_WATCHDOG.toString()],
        );
        expect(held.rows[0]?.locked).toBe(true);

        const alerts = await runRetentionWatchdog({
          pool: cronPool,
          db: cronDb,
        });
        expect(alerts).toEqual([]);
        expect(captureError).not.toHaveBeenCalled();
      } finally {
        await blocker.query('SELECT pg_advisory_unlock($1)', [
          CRON_LOCK_IDS.RETENTION_WATCHDOG.toString(),
        ]);
        blocker.release();
      }
    });

    it('pencere sınırı: 25 saatlik iz TAZE, 30 saatlik iz YOK sayılır', async () => {
      await writeTrace('audit_logs', 0, 25);
      await writeTrace('call_logs', 23, 25);
      await writeTrace('print_jobs', 207, 30); // pencere DIŞI
      const alerts = await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('print_jobs');
    });

    /**
     * ⚠️ Amd6 K5'in KANITI — watchdog'un `cron_purger` kullanması teknik bir
     * zorunluluk, tercih değil. `audit.purge` izleri `tenant_id IS NULL` ve
     * migration 063'ün SELECT policy'si NULL'ı dışlar → `app_tenant` ile koşan
     * bir watchdog izleri HİÇ göremez, "üç task da koşmamış" sanır ve **her gün
     * üç yanlış alarm** üretir. Bu test o davranışı kayda geçirir ki ileride
     * biri "neden app pool değil" diye sorduğunda cevap kanıtlı olsun.
     */
    it('negatif kontrol: app_tenant pool ile koşarsa izleri göremez → yanlış alarm', async () => {
      await writeHealthyNight();

      // SEBEBİ doğrudan kanıtla (qa önerisi): app_tenant için sorgu ÇALIŞIR
      // (yetki var) ama policy NULL-tenant satırlarını filtreler → 0 satır.
      // Bu assert olmadan "3 alarm" sonucu yetki hatasından da gelebilirdi;
      // böyle ayırt edilmiş oluyor.
      const visibleToApp = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM audit_logs
         WHERE tenant_id IS NULL AND event_type = 'audit.purge'
      `.execute(appDb);
      expect(visibleToApp.rows[0]?.n).toBe(0);

      const wrongPoolAlerts = await runRetentionWatchdog({
        pool: appPool,
        db: appDb,
      });
      expect(wrongPoolAlerts).toHaveLength(3);
      // Her alarm Sentry'ye de gider → yanlış pool GÜNDE ÜÇ yanlış event demek.
      expect(captureError).toHaveBeenCalledTimes(3);

      vi.mocked(captureError).mockClear();
      // Doğru pool ile AYNI veride alarm YOK — fark tamamen rolden geliyor.
      const correctPoolAlerts = await runRetentionWatchdog({
        pool: cronPool,
        db: cronDb,
      });
      expect(correctPoolAlerts).toEqual([]);
      expect(captureError).not.toHaveBeenCalled();
    });

    /**
     * qa bulgusu (S134) — watchdog'un en büyük başarısızlık modu YANLIŞ ALARM.
     * Cron bir gecede iki kez koşabilir (`pm2 restart`, elle tetikleme) ve
     * İKİNCİ koşum daima `deleted_count: 0` bırakır (ilki zaten silmiştir).
     * "En yeni ize bak" mantığı bu durumda sağlıklı sistemi arızalı gösterirdi;
     * kod pencere içindeki izleri TOPLAR.
     */
    it('aynı task için iki iz (cron iki kez koştu): 207 + 0 → alarm YOK', async () => {
      await writeTrace('audit_logs', 0, 6);
      await writeTrace('call_logs', 23, 6);
      await writeTrace('print_jobs', 207, 6); // ilk koşum: gerçekten sildi
      await writeTrace('print_jobs', 0, 1); // ikinci koşum: silecek şey kalmadı
      const alerts = await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      expect(alerts).toEqual([]);
      expect(captureError).not.toHaveBeenCalled();
    });

    it('audit_logs=0 muafiyeti Sentry kanalına da yansır (hiç event yok)', async () => {
      await writeTrace('audit_logs', 0);
      await writeTrace('call_logs', 5);
      await writeTrace('print_jobs', 12);
      await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      // Alarm yorgunluğunun oluşacağı yer tam burası: muafiyet çalışmasa her
      // gün bir Sentry event'i giderdi.
      expect(captureError).not.toHaveBeenCalled();
    });

    it('hiç task koşmadıysa üç alarmın üçü de Sentry kanalına gider', async () => {
      const alerts = await runRetentionWatchdog({ pool: cronPool, db: cronDb });
      expect(alerts).toHaveLength(3);
      expect(captureError).toHaveBeenCalledTimes(3);
    });
  },
);
