import 'dotenv/config';
import { initSentry } from './observability/sentry.js';
import { createServer } from 'node:http';
import { sql } from 'kysely';
import {
  createPool,
  createKysely,
} from '@restoran-pos/db';
import { buildApp } from './app';
import { createRealtimeServer } from './realtime/server.js';
import { buildMostRecentPendingCall } from './realtime/pending-caller-replay.js';
import { resolveCallerStationUserId } from './realtime/caller-station-lookup.js';
import { startTtlCleanup } from './cron/ttl-cleanup.js';
import { startRetentionWatchdog } from './cron/retention-watchdog.js';
import { logger } from './logger.js';
import { assertAuthConfig } from './config/authConfig.js';
import { warnIfMultiTenant } from './config/singleTenantGuard.js';

// ADR-040 — Sentry'yi mümkün olan en erken (dotenv'den sonra) başlat.
// DSN yoksa no-op; hiçbir şeyi bloke etmez.
initSentry();

const port = process.env['PORT'] ?? 3001;

const accessSecret = process.env['JWT_ACCESS_SECRET'];
if (accessSecret === undefined || accessSecret.length < 32) {
  throw new Error(
    'JWT_ACCESS_SECRET is required (min 32 chars) — set it in .env',
  );
}

// ADR-004 Amendment 2 — Print Agent JWT (user JWT'den ayrı secret;
// compromise blast radius daraltılır). HS256, type='agent'/'agent_refresh'
// claim ile user token'larından izole; `requireAgentJwt` middleware verify.
const agentSecret = process.env['JWT_AGENT_SECRET'];
if (agentSecret === undefined || agentSecret.length < 32) {
  throw new Error(
    'JWT_AGENT_SECRET is required (min 32 chars) — set it in .env',
  );
}

// ADR-002 §11.2 (Amd5) — RTR grace penceresi yapılandırması fail-fast doğrulanır;
// üst sınırı aşan/geçersiz değer sessizce güvenlik penceresini genişletemesin.
assertAuthConfig();

// MIM-7 (DD triyajı B — ucuz mitigasyon, ADR-002 fail-fast disiplini): prod'da
// TENANT_ID fail-fast. Env unutulursa sessizce placeholder tenant'a
// (000...001) düşmek YANLIŞ-TENANT scope'una yol açar — tüm sorgular var
// olmayan tenant'a gider → sessiz kırık (login/veri boş). GUV-2 (DATABASE_URL)
// ile birebir aynı disiplin: prod'da erken+gürültülü çök. Dev/test'te
// placeholder korunur (kolaylık). Tam çok-tenant tenant türetme (bootstrap-dışı,
// JWT/istekten) = v5.1 (MIM-7 gövdesi, ADR gerektirir).
const tenantIdEnv = process.env['TENANT_ID'];
if (
  process.env['NODE_ENV'] === 'production' &&
  (tenantIdEnv === undefined || tenantIdEnv === '')
) {
  throw new Error(
    'TENANT_ID is required in production — placeholder tenant fallback reddedildi (MIM-7)',
  );
}
const tenantId = tenantIdEnv ?? '00000000-0000-0000-0000-000000000001';

// GUV-2 (DD triyajı A) — prod'da DATABASE_URL fail-fast. Env unutulursa
// sessizce lokal dev DB'ye düşmek prod'da veri tutarsızlığı/yanlış-DB felaketi
// olurdu; JWT secret fail-fast'i (yukarı) ile aynı disiplin. Dev/test'te
// varsayılan korunur (kolaylık).
const databaseUrlEnv = process.env['DATABASE_URL'];
if (
  process.env['NODE_ENV'] === 'production' &&
  (databaseUrlEnv === undefined || databaseUrlEnv === '')
) {
  throw new Error(
    'DATABASE_URL is required in production — dev DB fallback reddedildi (GUV-2)',
  );
}
const databaseUrl =
  databaseUrlEnv ?? 'postgresql://postgres:postgres@localhost:5432/pos_dev';

const pool = createPool({ connectionString: databaseUrl });
const db = createKysely(pool);

// ADR-041 Amd5 K2 — TTL-cleanup cron'unun AYRI bağlantısı (`cron_purger`,
// BYPASSRLS). Gerekçe: `audit_logs` force-RLS'li ve cron'un üç işi
// **`tenant_id IS NULL`** üzerinde çalışıyor (sistem-actor self-audit INSERT'i
// + NULL-tenant retention DELETE'i). Bunlar `withTenant` ile ÇÖZÜLEMEZ —
// helper geçersiz UUID'de transaction'ı hiç açmaz (fail-closed). app_tenant
// (NOBYPASSRLS) ile denenirse policy `WITH CHECK` reddeder ve cron'un
// try/catch'i hatayı yutar → **retention sessizce ölür** (KVKK).
//
// ⚠️ Env YOKSA app pool'una DÜŞMEK YASAK (Amd5 K2): sessizce yanlış rolle
// koşmak tam olarak yukarıdaki sessiz ölümü üretir. Prod'da fail-fast
// (GUV-2/M4 disiplini), dev/test'te cron başlatılmaz + görünür uyarı.
const cronDatabaseUrlEnv = process.env['CRON_DATABASE_URL'];
if (
  process.env['NODE_ENV'] === 'production' &&
  (cronDatabaseUrlEnv === undefined || cronDatabaseUrlEnv === '')
) {
  throw new Error(
    'CRON_DATABASE_URL is required in production — app pool fallback reddedildi (ADR-041 Amd5 K2: NULL-tenant retention sessizce ölür)',
  );
}
const cronPool =
  cronDatabaseUrlEnv !== undefined && cronDatabaseUrlEnv !== ''
    ? createPool({ connectionString: cronDatabaseUrlEnv, max: 2 })
    : null;
const cronDb = cronPool !== null ? createKysely(cronPool) : null;

// ⚠️ Güvenlik denetimi (S134) — BYPASSRLS credential'ını process env'inden
// KALDIR. Pool kurulduktan sonra bağlantı dizesine ihtiyaç yok; env'de kalırsa
// herhangi bir bağımlılık `process.env`'den okuyup KENDİ BYPASSRLS pool'unu
// açabilir. ADR-002 §13.5 A1 bunu "process boundary ihlali = supply-chain
// incident" diye adlandırıyor; in-process ikinci pool (Amd3 Karar 2) bilinçli
// bir sapma olduğu için bu azaltım bedavaya alınır.
// (cronPool/cronDb yalnız startTtlCleanup'a ve M5'e verilir — buildApp ve
// realtime app pool'unu alır, yani API kodundan bu pool'a sızma yolu yoktur.)
if (cronDatabaseUrlEnv !== undefined) {
  delete process.env['CRON_DATABASE_URL'];
}

// M4 (ADR-041 Amendment 1) — RLS'in gerçekten ısırdığının runtime kanıtı.
// Prod'da uygulama `app_tenant` (NOBYPASSRLS) rolüyle bağlanmalı; superuser
// veya BYPASSRLS bir rolle bağlanırsa `FORCE ROW LEVEL SECURITY` **sessizce
// etkisiz** olur (tüm tenant izolasyonu kağıt üstünde kalır, hata vermez).
// Bu, çok-tenant için en tehlikeli footgun → prod'da fail-fast. Dev/CI
// postgres superuser kullandığından yalnız NODE_ENV=production'da koşar
// (GUV-2 / MIM-7 fail-fast disiplini). Async: pool hazır olunca kontrol eder,
// yanlışsa süreç kapanır (listen başlamış olsa bile derhal exit).
if (process.env['NODE_ENV'] === 'production') {
  void (async () => {
    try {
      const result = await sql<{
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`.execute(
        db,
      );
      const role = result.rows[0];
      if (role === undefined || role.rolbypassrls || role.rolsuper) {
        logger.error(
          { rolbypassrls: role?.rolbypassrls, rolsuper: role?.rolsuper },
          '[api] M4 FAIL: uygulama BYPASSRLS/superuser rolüyle bağlı — RLS sessizce etkisiz. DATABASE_URL app_tenant (NOBYPASSRLS) olmalı. Kapatılıyor.',
        );
        process.exit(1);
      }
      logger.info('[api] M4 OK: DB rolü NOBYPASSRLS (RLS enforcement aktif)');
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[api] M4: DB rol doğrulaması başarısız — kapatılıyor',
      );
      process.exit(1);
    }
  })();
}

// M5 (ADR-041 Amendment 5 K3) — M4'ün SİMETRİĞİ. M4 "app pool bypass
// ETMEMELİ" der; M5 tam tersini garanti eder: cron pool **bypass ETMELİ**.
// Etmezse `tenant_id IS NULL` self-audit INSERT'i policy'ye takılır, cron'un
// try/catch'i yutar ve retention **sessizce** ölür — yani yanlış yapılandırma
// gürültü çıkarmaz. M4 ile aynı fail-fast disiplini.
//
// ⚠️ Koşul `rolbypassrls && !rolsuper` — İKİ yönlü (güvenlik denetimi bulgusu).
// İlk hâli yalnız "bypass edebiliyor mu" diye soruyordu (`OR rolsuper`), çünkü
// superuser `rolbypassrls=false` olsa da RLS'i bypass eder. Ama o koşul
// `CRON_DATABASE_URL` yanlışlıkla `postgres` süperuserını taşırsa **GEÇER** ve
// API sürecine tam-süperuser bir in-process pool verirdi: her tabloda sınırsız
// UPDATE/DELETE, `audit_logs` UPDATE dahil → migration 063'ün kurduğu
// "denetim izi değiştirilemez" garantisi tam olarak kaybolurdu.
// Doğru talep: bypass ETMELİ **ama** süperuser OLMAMALI — yani tam olarak
// `cron_purger` gibi dar yetkili bir rol. M4 ile simetri de böylece tamamlanır:
//   M4 → !rolbypassrls && !rolsuper   (app pool: bypass etmemeli)
//   M5 →  rolbypassrls && !rolsuper   (cron pool: bypass etmeli)
// Her ikisinde `!rolsuper` var: süperuser hiçbir runtime bağlantısında istenmez.
// Dev/test etkilenmez — M5 yalnız NODE_ENV=production'da koşar.
if (process.env['NODE_ENV'] === 'production' && cronDb !== null) {
  void (async () => {
    try {
      const result = await sql<{
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`.execute(
        cronDb,
      );
      const role = result.rows[0];
      if (role === undefined || !role.rolbypassrls || role.rolsuper) {
        logger.error(
          { rolbypassrls: role?.rolbypassrls, rolsuper: role?.rolsuper },
          '[api] M5 FAIL: cron bağlantısı BYPASSRLS + non-superuser OLMALI. BYPASSRLS değilse NULL-tenant self-audit/retention sessizce kırılır; superuser ise API sürecine sınırsız yetki girer ve audit_logs değiştirilemezliği kaybolur. CRON_DATABASE_URL cron_purger olmalı. Kapatılıyor.',
        );
        process.exit(1);
      }
      logger.info(
        '[api] M5 OK: cron bağlantısı BYPASSRLS + non-superuser (NULL-tenant retention aktif)',
      );
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[api] M5: cron DB rol doğrulaması başarısız — kapatılıyor',
      );
      process.exit(1);
    }
  })();
}

// M6 (ADR-041 Amendment 7 K4) — auth tenant-çözümünün tek-tenant sabitine
// bağlı olduğu varsayımının **sunset guard**'ı. M4/M5'in aksine fail-fast
// DEĞİL: ikinci tenant eklemek meşru bir iştir, amaç engellemek değil
// sessizliği kırmaktır (gerekçe + kalıntı risk: config/singleTenantGuard.ts).
// NODE_ENV kapısı YOK — M4/M5 prod-özeldir çünkü dev superuser kullanır; bu
// kontrol role bakmaz, tenant sayar ve ikinci tenant önce DEV'de eklenir, yani
// uyarının orada da görünmesi istenir. Açılışta bir kez koşar (istek yolu
// değil); testler `index.ts`'i import etmez.
void warnIfMultiTenant(db);

// ADR-016 §11 — Caller bridge shared secret. `undefined` ise bridge endpoint'i
// fail-closed (401). Prod kurulumda set edilir; dev/CI'da opsiyonel.
const bridgeToken = process.env['BRIDGE_TOKEN'];

process.on('unhandledRejection', (reason) => {
  // Normalize reason to avoid leaking DB connection strings or tokens from
  // raw Error messages (e.g. pg driver errors contain DATABASE_URL).
  const safeReason =
    reason instanceof Error
      ? { name: reason.name, message: reason.message.replace(/:[^@\s]+@/g, ':***@') }
      : { raw: String(reason).slice(0, 200) };
  logger.error({ reason: safeReason }, '[api] unhandledRejection');
});

// ADR-010 + ADR-020 K12 — Realtime io, app'e referans olarak geçecek
// (kitchen.orderSent / kitchen.itemStatusChanged / order:* emit'leri
// için). Wire sırası kritik: io → app → httpServer.on('request', app).
//
// 1. Bare http server (henüz request listener yok)
const httpServer = createServer();

// 2. Socket.IO realtime — bare httpServer'a upgrade handler attach eder
const realtime = createRealtimeServer({
  httpServer,
  accessSecret,
  webOrigin: process.env['WEB_ORIGIN'] ?? 'http://localhost:5173',
  // ADR-016 §11 — caller-station room auto-join. Bu lookup GEÇİLMEZSE
  // handshake'teki join bloğu hiç çalışmaz → emitIncomingCall hep BOŞ odaya
  // gider → popup yapısal ölü (S86 canlı bulgu; #301 io-wiring'in kardeşi).
  // ADR-041 F4d — tenant_settings RLS'e alındı; lookup withTenant sarımıyla
  // ayrı modülde (test edilebilirlik: index.ts bootstrap'ı unit-test edilemez).
  callerStationLookup: (stationTenantId) =>
    resolveCallerStationUserId(db, stationTenantId),
  // ADR-016 §11 (S104) — istasyon yeniden bağlanınca son cevapsız çağrının
  // (≤5 dk) telafi emit'i; socket kopukken kaybolan popup'ı kurtarır.
  pendingCallReplay: (replayTenantId) =>
    buildMostRecentPendingCall(db, replayTenantId, 300),
});

// 3. Express app — io referansı ile build (deps.io tanımlı; ordersRouter
//    ve diğer route'lar emit edebilir)
const app = buildApp({
  pool,
  db,
  accessSecret,
  agentSecret,
  tenantId,
  webOrigin: process.env['WEB_ORIGIN'] ?? 'http://localhost:5173',
  io: realtime.io,
  ...(bridgeToken !== undefined ? { bridgeToken } : {}),
});

// 4. HTTP request handler olarak app'i bağla (Socket.IO upgrade events
//    ayrı path'te akmaya devam eder)
httpServer.on('request', app);

httpServer.listen(port, () => {
  logger.info({ port }, '[api] Listening on http://localhost:%s', String(port));
});

// ADR-002 §13 — TTL cleanup cron. Test ortamında ve DISABLE_CRON=1 ile devre dışı.
if (process.env['NODE_ENV'] !== 'test' && process.env['DISABLE_CRON'] !== '1') {
  // ADR-041 Amd5 K2/K5 — cron ARTIK cron_purger (BYPASSRLS) pool'uyla koşar:
  // audit_logs force-RLS'li ve cron'un NULL-tenant INSERT/DELETE'leri
  // app_tenant ile imkânsız. Env yoksa cron BAŞLATILMAZ (prod'da yukarıda
  // fail-fast; burası dev/test yolu) — app pool'a düşmek retention'ı sessizce
  // yanlış rolle koşturmak olurdu.
  if (cronPool !== null && cronDb !== null) {
    startTtlCleanup({ pool: cronPool, db: cronDb });
    // ADR-041 Amd6 — retention watchdog (09:00): gece cron'unun üç task'ının
    // gerçekten koştuğunu `audit.purge` izlerinden doğrular. Aynı pool ŞART
    // (K5): izler `tenant_id IS NULL` ve mig 063'ün SELECT policy'si NULL'ı
    // dışlıyor → app_tenant ile sürekli yanlış alarm üretirdi.
    startRetentionWatchdog({ pool: cronPool, db: cronDb });
  } else {
    logger.warn(
      '[api] TTL-cleanup cron VE retention watchdog BAŞLATILMADI: CRON_DATABASE_URL yok. audit_logs/call_logs/print_jobs retention KOŞMUYOR ve bunu bildirecek alarm da YOK (ADR-041 Amd5 K2 + Amd6 K5).',
    );
  }
}
