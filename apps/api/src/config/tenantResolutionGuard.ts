import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { logger } from '../logger.js';
import { captureError } from '../observability/sentry.js';
import {
  TENANT_SLUG_RE,
  setDefaultTenantSlug,
} from '../auth/tenantResolution.js';

/**
 * ADR-042 K4 — **tenant çözümü açılış guard'ı** (eski adı M6 sunset guard).
 *
 * Eski sözleşme (ADR-041 Amd7 K4): *"auth tenant-çözümü sunucu sabitine bağlı,
 * ikinci tenant eklenirse alarm çal."* Bu varsayım **ADR-042 ile ortadan
 * kalktı** — tenant artık işletme kodundan ve refresh token önekinden
 * çözülüyor. Yani `tenants > 1` tek başına **artık bir hata değil**; ikinci
 * işletme desteklenen bir durumdur.
 *
 * Guard kaldırılmadı, **dönüştürüldü**: yerine, çözüm mekanizmasının kendi
 * sessiz başarısızlıklarını gören kontroller kondu. Boot-time maliyeti tek bir
 * `SELECT`, karşılığında kapatılan üç sessiz-kırılma sınıfı var.
 *
 * ⚠️ `TENANT_ID` env **adı değişmedi** — anlamı değişti: artık "tek tenant"
 * değil, **varsayılan (legacy) tenant**'tır; işletme kodu göndermeyen
 * istemciler ve öneksiz refresh token'lar oraya düşer.
 *
 * Yeni env / rol / GRANT gerektirmez: `tenants` RLS'e tabi değildir ve
 * `app_tenant`'ın SELECT yetkisi `000_init.sql:477` toplu grant'inden gelir.
 */

interface GuardRow {
  id: string;
  slug: string;
}

export async function assertTenantResolution(
  db: Kysely<DB>,
  defaultTenantId: string,
): Promise<void> {
  let rows: readonly GuardRow[];
  try {
    const result = await sql<GuardRow>`
      select id::text as id, slug from public.tenants where deleted_at is null
    `.execute(db);
    rows = result.rows;
  } catch (err) {
    // Guard bir **alarm**dır, ön-koşul değil: sorgu başarısız olursa API
    // açılmaya devam eder (aksi halde gözlem aracı kesinti kaynağına dönerdi).
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[api] tenant-resolution guard: sorgu başarısız — bu açılışta doğrulanamadı',
    );
    return;
  }

  // ── (i) Varsayılan tenant GERÇEKTEN var mı? — prod'da FAIL-FAST ────────────
  //
  // Bugünkü `TENANT_ID` fail-fast'i (index.ts) env'in **var olduğunu**
  // denetliyordu, **geçerli olduğunu** değil. Env yanlış/silinmiş bir UUID
  // gösteriyorsa işletme kodu göndermeyen HER giriş ve öneksiz HER refresh
  // token sessizce 401 olur — force-RLS'te context'siz okuma hata fırlatmaz,
  // 0 satır döner. Yani kesinti, hiçbir hata logu üretmeden yaşanır.
  // Bu, "beyan edilmiş ama doğrulanmamış politika" sınıfının ta kendisidir.
  const defaultRow = rows.find((r) => r.id === defaultTenantId);
  if (defaultRow === undefined) {
    const message = `TENANT_ID (${defaultTenantId}) tenants tablosunda yok veya silinmiş — slug'sız girişler ve öneksiz token'lar sessizce 401 olur`;
    if (process.env['NODE_ENV'] === 'production') {
      logger.error({ defaultTenantId }, `[api] tenant-resolution guard: ${message}`);
      captureError(new Error(message));
      process.exit(1);
    }
    // dev/test: durdurma (fixture'lar sahte tenant id'leriyle koşar), ama sus ma.
    logger.error({ defaultTenantId }, `[api] tenant-resolution guard: ${message}`);
  } else {
    // ── Rate-limit kanonikleştirmesi (ADR-042 kabul edilen artık riskin kapanışı)
    //
    // Varsayılan tenant'ın slug'ı ile slug'SIZ istek AYNI hesaba gider ama
    // anahtarları farklı olursa (`dilan-pide` vs `<default>`) o kullanıcıya
    // 15 dakikada 5 değil **10** şifre denemesi düşer. Slug'ı burada
    // öğreniyoruz çünkü boot'ta zaten `tenants` okunuyor — ikinci sorgu yok.
    setDefaultTenantSlug(defaultRow.slug);
  }

  // ── (ii) Tüm slug'lar biçime uyuyor mu? — savunma derinliği ───────────────
  //
  // CHECK (mig 068) düşürülürse veya elle `UPDATE` yapılırsa büyük/küçük harf
  // duyarsız giriş belirsizleşir. API durdurulmaz; bu bir veri hijyeni sinyali.
  const bad = rows.filter((r) => !TENANT_SLUG_RE.test(r.slug));
  if (bad.length > 0) {
    const message = `tenants.slug biçim ihlali (${bad.length} satır) — mig 068 CHECK'i düşmüş olabilir`;
    logger.error({ count: bad.length }, `[api] tenant-resolution guard: ${message}`);
    captureError(new Error(message));
  }

  // ── (iii) Çok tenant + legacy yol hâlâ açık ───────────────────────────────
  //
  // Birden fazla işletme varken slug göndermeyen bir istemci denemeyi
  // **varsayılan** tenant'a yönlendirir → ikinci şubenin personeli ayırt
  // edilemeyen bir 401 alır. Sinyal "istemci güncellemesi tamamlanmadı" der.
  // Legacy yolun gerçekten boşaldığı `auth.login.without_slug` ve
  // `auth.refresh.legacy_unprefixed` sayaçlarıyla ÖLÇÜLÜR (K4 iv).
  if (rows.length > 1) {
    logger.warn(
      { tenantCount: rows.length },
      '[api] tenant-resolution guard: çok tenant + varsayılan-tenant fallback açık — istemciler işletme kodu göndermiyorsa yanıltıcı 401 doğar',
    );
    return;
  }

  logger.info(
    { tenantCount: rows.length },
    '[api] tenant-resolution guard OK',
  );
}
