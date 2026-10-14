import { randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { logger } from '../logger';

/**
 * ADR-042 — **tek paylaşımlı tenant çözümleyici** (v5.1 Faz 1 / MIM-7 gövdesi).
 *
 * Bu modülden önce tenant çözümü **dört ayrı yerde** sunucu sabitine (`deps.tenantId`)
 * bağlıydı: `/auth/login`, `/auth/logout`, `/auth/refresh` rotasyonu ve agent
 * register. Varsayım dört yere yayıldığı için ikinci tenant eklendiğinde dördünün
 * de ayrı ayrı bulunup düzeltilmesi gerekirdi — ADR-041 Amd7 bu borcu kayda
 * geçirmişti. Burası o borcun kapandığı yer: **çözüm bir daha kopyalanmaz.**
 *
 * 🔑 **Çözülen tenant KAPSAM seçer, YETKİ vermez.**
 * Ne slug ne de token öneki bir iddiadır. Yetki her zaman arkasındaki gerçek
 * doğrulamadan gelir: login'de bcrypt, refresh'te `token_hash`'in o tenant'ta
 * bulunması. Saldırgan slug'ı veya öneki değiştirirse yalnız **yanlış yere bakmış**
 * olur; eşleşme bulamaz ve aynı 401'i alır. Bu, ADR-041 Amd7 K4(2)'nin agent
 * öneki için kurduğu muhakemenin aynısıdır.
 *
 * 🔑 **Neden yeni BYPASSRLS pool'u YOK.** Çözüm sorgusu RLS'e tabi **olmayan**
 * `tenants` tablosundan okur (ADR-041 bu tabloyu bilerek RLS dışında bıraktı;
 * `app_tenant`'ın SELECT yetkisi `000_init.sql:477` toplu grant'inden gelir).
 * Yani kimliği doğrulanmamış bir yola bypass yetkisi **girmez** — ADR-041'in tam
 * olarak engellemek için var olduğu şey budur.
 */

/** ADR-042 K1.6 — mig 068 CHECK'i ile AYNI biçim. İkisi ayrışırsa giriş sessizce bozulur. */
export const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

/** Refresh token sürüm öneki (ADR-042 K2). Parse yalnız bilinen sürümü tanır. */
const REFRESH_PREFIX_RE = /^rt1_([0-9a-f]{32})_/;

const REFRESH_SECRET_BYTES = 32;

/** Cutover öncesi biçim: 32 byte base64url = 43 karakter, öneksiz. */
const LEGACY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Rate-limit anahtarında slug yerine kullanılan sentinel (ADR-042 K1 rate-limit).
 * Slug'sız istekler tek kovada toplanır — bugünkü davranışla aynı.
 */
export const DEFAULT_SLUG_KEY = '<default>';

/** Anahtar-şişme koruması (S139 güvenlik kapısı C-1'in slug için tekrarı). */
const SLUG_KEY_MAX = 32;

/**
 * İki taraflı normalize: istemci de normalize eder, sunucu da. Tek tarafa
 * güvenilmez — eski/yanlış yazılmış bir istemci ham değer gönderebilir.
 */
export function normalizeSlug(raw: unknown): string | undefined {
  // 🔴 `unknown` BİLEREK: bu fonksiyon rate-limit `keyGenerator`'ından da çağrılır
  // ve orası HAM GÖVDEYİ okur — zod `validateBody` limiter'dan SONRA koşar.
  // `as string` cast'i ile `{"tenantSlug": 123}` gönderen bir istek
  // `raw.trim is not a function` fırlatır → kimlik doğrulama ÖNCESİ 500 +
  // Sentry kaydı. Taban kova 60/dk × dağıtık IP = Sentry kotası yakma.
  // E-posta yolu (`routes/auth.ts`) bu korumayı zaten yapıyor; burası onun eşleniği.
  if (typeof raw !== 'string') return undefined;
  // 🔑 slice ÖNCE: 10 MB'lık bir string'e trim/toLowerCase uygulamak geçici
  // olarak o boyutta kopya ayırırdı (`express.json({limit:'10mb'})`).
  // E-posta yolu da bilerek bu sırada yapıyor.
  const trimmed = raw.slice(0, SLUG_KEY_MAX).trim().toLowerCase();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Sıkı rate-limit kovasının slug bileşeni (ADR-042 K1, ADR-002 §14.3 amend).
 *
 * 🔴 Güvenlik gereği, kozmetik değil: aynı e-posta iki tenant'ta **iki ayrı
 * hesaptır**. Slug anahtara girmezse A işletmesindeki yanlış şifre denemeleri
 * B işletmesindeki aynı e-postalı kullanıcıyı kilitler → çapraz-tenant DoS.
 */
export function slugRateLimitKey(raw: unknown): string {
  return normalizeSlug(raw) ?? DEFAULT_SLUG_KEY;
}

/**
 * Giriş için tenant çözer (ADR-042 K1).
 *
 * - slug **yoksa** → varsayılan (legacy) tenant. Bugünkü davranışın birebir aynısı
 *   → yayındaki web bundle'ı ve App Store'daki mobil sürüm değişmeden çalışır.
 * - slug **varsa ama bulunamazsa** → `null`. Çağıran bunu "kullanıcı bulunamadı"
 *   ile **aynı** şekilde ele almalıdır: dummy hash + aynı 401. "İşletme yok" gibi
 *   ayırt edici bir yanıt ÜRETİLMEZ, yoksa işletme-varlığı enumeration'ı açılır.
 *
 * `withTenant` DIŞINDA, tek satırlık okuma — `tenants` RLS'siz olduğu için
 * context gerekmez ve gerekmemesi bu tasarımın temel taşıdır.
 */
export async function resolveTenantFromSlug(
  db: Kysely<DB>,
  rawSlug: string | undefined,
  defaultTenantId: string,
): Promise<string | null> {
  const slug = normalizeSlug(rawSlug);
  // NOT: `auth.login.without_slug` sayacı burada DEĞİL, route'ta **başarılı**
  // girişten sonra yazılır. Burada yazılsaydı her başarısız bot denemesi sayacı
  // kirletir ve "istemciler güncellendi mi" sorusu ölçülemez hale gelirdi.
  if (slug === undefined) return defaultTenantId;
  // Biçimi tutmayan slug DB'ye hiç gitmez; sonuç yine "bulunamadı" ile aynıdır.
  if (!TENANT_SLUG_RE.test(slug)) return null;

  const row = await sql<{ id: string }>`
    SELECT id FROM tenants WHERE slug = ${slug} AND deleted_at IS NULL
  `.execute(db);
  return row.rows[0]?.id ?? null;
}

/**
 * Yeni refresh token üretir: `rt1_<32hex tenant uuid>_<43 karakter base64url>`.
 *
 * Önek **kriptografik olarak token'a bağlıdır**: hash sunulan dizgenin TAMAMI
 * üzerinden alınır, yani öneki kurcalamak hash'i değiştirir ve satırı bulunamaz
 * kılar. Tam uuid kullanılır, 8-hex kısaltma DEĞİL — kısaltma `LIKE '<short>%'`
 * tipi aramaya ve önek-çakışması risk sınıfına yol açar; ADR-041 Amd7 K4(2) tam
 * olarak o deseni koddan kaldırmıştı.
 */
export function buildRefreshToken(tenantId: string): string {
  const hex = tenantId.replace(/-/g, '').toLowerCase();
  const secret = randomBytes(REFRESH_SECRET_BYTES).toString('base64url');
  return `rt1_${hex}_${secret}`;
}

/**
 * Refresh/logout için tenant çözer (ADR-042 K2).
 *
 * **Geriye uyumluluk zorunlu:** öneksiz (43 karakterlik, bugün canlı olan) token
 * → varsayılan tenant. Kanıt niteliğinde doğru: cutover'dan önce üretilmiş her
 * token, o an var olan **tek** tenant'a aittir. Bu yol token ömrü boyunca (30 gün
 * sliding + 7 gün TTL = azami 37 gün) açık kalmak ZORUNDADIR; kapatmak tüm açık
 * oturumları düşürürdü.
 *
 * Tenant bulunamazsa `null` → çağıran mevcut `401 AUTH_REFRESH_INVALID`'i döner.
 * Yeni hata kodu YOK (yeni oracle yok).
 */
export async function resolveTenantFromRefreshToken(
  db: Kysely<DB>,
  plainToken: string,
  defaultTenantId: string,
): Promise<string | null> {
  const match = REFRESH_PREFIX_RE.exec(plainToken);
  if (match === null) {
    // K4(iv) sayacı YALNIZ biçim-geçerli (43 karakter base64url = cutover öncesi
    // gerçek bir token) girdide sayar. Aksi halde her bot taraması sayacı
    // kirletir ve "legacy yol 37 gün sonra boşaldı mı" sorusu ASLA
    // ölçülemez — yani kapatma kararı süresiz sarkar.
    if (LEGACY_TOKEN_RE.test(plainToken)) {
      logger.info(
        { counter: 'auth.refresh.legacy_unprefixed' },
        'refresh token without tenant prefix',
      );
    }
    return defaultTenantId;
  }
  const hex = match[1]!;
  const tenantId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');

  const row = await sql<{ id: string }>`
    SELECT id FROM tenants WHERE id = ${tenantId}::uuid AND deleted_at IS NULL
  `.execute(db);
  return row.rows[0]?.id ?? null;
}
