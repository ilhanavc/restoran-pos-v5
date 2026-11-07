/**
 * ADR-044 K2 — print-agent **kayıt anahtarı rotasyonu** (ops script'i).
 *
 * ## Neden script, neden UI değil
 *
 * Rotasyonun tetikleyicisi **yalnız bu script**tir; müdür ekranından bir
 * düğme **kapsam dışıdır** (ADR-044 K8, ürün sahibi kararı K10-2). Gerekçe:
 * bir UI, sırrı **ekranda göstermek** zorundadır (ekran görüntüsü, pano,
 * tarayıcı geçmişi, omuz üstü) ve yılda bir yapılan bir işlem için yeni bir
 * yetki + i18n + HCI yüzeyi açar. Anahtarın hedefi zaten bir ekran değil,
 * restoran PC'sindeki **üç servis env'i**dir.
 *
 * ## Neyi değiştirir
 *
 * ADR-044 öncesi kayıt sırrının hash'i `agents.api_key_hash` üzerinde
 * yaşıyordu ve yeni kayıtta *eşleşen satırdan kopyalanıyordu*. Prod ölçümü
 * (2026-11-05): 5 ajan / 2 hash, **dördü birebir aynı** — biri 4 Temmuz'da
 * İPTAL EDİLMİŞ satır. Yani bir `agents` satırını iptal etmek, o satırın
 * taşıdığı anahtarı **iptal etmiyordu**. `agent_registration_keys` yetki
 * sorusunu devralır; bu script o tabloyu döndürür.
 *
 * ## İki ayrı koşum (sıra bağlayıcı)
 *
 * 1. **rotate** — yeni anahtar üretilir, ESKİ geçerli satırlara
 *    `valid_until = now() + grace` yazılır (**iptal edilmez**). Grace boyunca
 *    iki anahtar da geçerlidir; operatör üç servisin env'ini bu pencerede
 *    günceller.
 * 2. **`--revoke-after-grace`** — AYRI ve SONRAKİ koşum: `valid_until`
 *    geçmiş satırlara `revoked_at` yazar.
 *
 * ⚠️ Grace penceresi **çalışan ajanı etkilemez** (onlar JWT refresh ile akar);
 * yalnız **yeniden kaydı** sınırlar. Sessiz ölüm kipi: env'i güncellenmemiş
 * bir servisin grace SONRASI ilk restart'ı → 401 → o yazıcı susar. Bu yüzden
 * kabul kanıtı 200 yanıtı değil, **DB'den okunan `registration_key_id`**dir:
 *
 *   SELECT device_fingerprint, registration_key_id, last_seen_at
 *   FROM agents WHERE tenant_id = $1 AND revoked_at IS NULL;
 *
 * Üç satırın üçünde de YENİ anahtarın id'si görünmelidir (ADR-044 K7 Dalga D).
 *
 * ## Sır disiplini
 *
 * Üretilen anahtar **yalnız stdout'a bir kez** basılır. Log'a, `audit_logs`'a,
 * Sentry'ye, dosyaya, hata mesajına **ASLA** yazılmaz; DB'ye yalnız bcrypt
 * cost-12 hash'i girer. Audit payload'ı anahtarın **id**'sini taşır, kendisini
 * ya da herhangi bir parçasını değil.
 *
 * ## Kullanım
 *
 *   DATABASE_URL='postgresql://…' \
 *     ./node_modules/.bin/tsx scripts/rotate-agent-key.ts \
 *     --tenant-id <uuid> --actor <admin e-postası> [--grace-days 7] [--dry-run]
 *
 *   # grace dolduktan SONRA, ayrı koşum:
 *   … --tenant-id <uuid> --actor <admin e-postası> --revoke-after-grace
 */
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Kysely } from 'kysely';
import { createPool, createKysely, withTenant, type DB } from '@restoran-pos/db';
import { writeAudit } from '../src/audit/writeAudit.js';
import { generateAgentRegistrationKey } from '../src/routes/print-jobs.js';

/** Register akışıyla AYNI maliyet — fixture'lar da `BCRYPT_COST` kullanır. */
const BCRYPT_COST = 12;

/** ADR-044 K10-1 — ürün sahibi kararı: varsayılan **7 gün**. */
const DEFAULT_GRACE_DAYS = 7;
/**
 * 🔴 **0 = ACİL İPTAL** (security-reviewer M3, 2026-11-07). İlk hâlde alt sınır
 * 1 gündü; sızan bir anahtar en az 24 saat geçerli kalıyordu ve tek çare elle
 * SQL'di. Sömürü somut: uydurma bir `deviceFingerprint` ile kaydolan saldırgan
 * tenant-kapsamlı bir agent JWT'si alır, `print_jobs` payload'larındaki ad /
 * telefon / adres bilgisine erişir (KVKK) ve işleri `success` işaretleyerek
 * fişi çaldırabilir. `--grace-days 0` eski anahtarı ANINDA geçersiz kılar
 * (`valid_until = now()`), bedeli üç servisin aynı anda yeniden kaydolamaması.
 */
const MIN_GRACE_DAYS = 0;
const MAX_GRACE_DAYS = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 🔴 Actor çözülemezse **koşum reddedilir** (ADR-044 K2).
 *
 * ADR-004 Amd14 K4'te elle SQL ile yapılan iptalin `audit_logs`'ta karşılığı
 * olmamıştı; o boşluk burada tekrarlanmıyor. "Kim döndürdü" sorusunun cevabı
 * yoksa rotasyon **yapılmaz**.
 */
/**
 * Hata mesajına ham `--actor` basmak, bayrak karıştırıldığında (`--actor
 * <anahtar>`) sırrı terminale ve hata raporuna düşürür (security-reviewer M4).
 */
function maskActor(actor: string): string {
  const trimmed = actor.trim();
  return `${trimmed.slice(0, 3)}…(${String(trimmed.length)} karakter)`;
}

export class ActorUnresolvedError extends Error {
  constructor(actor: string) {
    super(
      `ADR-044 K2 — REDDEDİLDİ: "${maskActor(actor)}" bu tenant'ta aktif bir admin ` +
        `kullanıcıya çözülemedi. Rotasyon denetim izi bırakmadan koşamaz; ` +
        `--actor değerini kontrol edin (e-posta, rol admin, silinmemiş).`,
    );
    this.name = 'ActorUnresolvedError';
  }
}

export class InvalidRotateArgsError extends Error {
  constructor(message: string) {
    super(`ADR-044 K2 — geçersiz argüman: ${message}`);
    this.name = 'InvalidRotateArgsError';
  }
}

export interface RotateAgentKeyOptions {
  /** Hedef tenant — **açıkça** verilir, env'den türetilmez. */
  tenantId: string;
  /** Rotasyonu yapan admin (e-posta). Çözülemezse koşum reddedilir. */
  actor: string;
  graceDays?: number;
  dryRun?: boolean;
  /** AYRI koşum: grace'i dolmuş anahtarları iptal eder, yeni anahtar üretmez. */
  revokeAfterGrace?: boolean;
}

export interface RotateAgentKeyResult {
  mode: 'rotate' | 'revoke-after-grace';
  dryRun: boolean;
  /** Yeni anahtar satırının id'si (audit payload'ına giren değer). */
  newKeyId: string | null;
  /**
   * 🔴 Üretilen SIR. Yalnız çağırana döner ki **stdout'a bir kez** bassın.
   * Log'a/audit'e/dosyaya yazılması YASAK. `--dry-run` ve revoke koşumunda
   * `null`.
   */
  plaintextKey: string | null;
  graceUntil: Date | null;
  /** `valid_until` yazılan eski satır sayısı. */
  affectedKeyCount: number;
  /** `--revoke-after-grace` koşumunda iptal edilen satır sayısı. */
  revokedCount: number;
}

function assertValidOptions(opts: RotateAgentKeyOptions): number {
  if (!UUID_RE.test(opts.tenantId)) {
    throw new InvalidRotateArgsError('--tenant-id geçerli bir UUID olmalı');
  }
  if (opts.actor.trim() === '') {
    throw new InvalidRotateArgsError('--actor zorunlu');
  }
  const graceDays = opts.graceDays ?? DEFAULT_GRACE_DAYS;
  if (
    !Number.isInteger(graceDays) ||
    graceDays < MIN_GRACE_DAYS ||
    graceDays > MAX_GRACE_DAYS
  ) {
    throw new InvalidRotateArgsError(
      `--grace-days ${MIN_GRACE_DAYS}-${MAX_GRACE_DAYS} arası tam sayı olmalı (varsayılan ${DEFAULT_GRACE_DAYS})`,
    );
  }
  return graceDays;
}

/**
 * Actor'ü gerçek bir admin kullanıcıya çözer. `withTenant` İÇİNDE çağrılır:
 * `users` force-RLS altındadır (mig 065) ve context'siz sorgu **sessiz 0
 * satır** döner — o yüzden çağıran sarımı atlamamalıdır.
 */
async function resolveActorUserId(
  trx: Kysely<DB>,
  tenantId: string,
  actor: string,
): Promise<string> {
  // ⚠️ `users` tablosunda soft-delete kolonu **YOK** (şemadan doğrulandı:
  // created_at · email · id · password_hash · role · tenant_id · updated_at ·
  // username) — o yüzden `deleted_at` filtresi de yok. Eşleşme e-posta VEYA
  // kullanıcı adı üzerinden: operatör ikisinden hangisini biliyorsa onu verir.
  const needle = actor.trim();
  const row = await trx
    .selectFrom('users')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('role', '=', 'admin')
    .where((eb) =>
      eb.or([
        eb('username', '=', needle),
        eb('email', '=', needle.toLocaleLowerCase('en')),
      ]),
    )
    .executeTakeFirst();
  if (row === undefined) {
    throw new ActorUnresolvedError(actor);
  }
  return row.id;
}

export async function rotateAgentKey(
  db: Kysely<DB>,
  opts: RotateAgentKeyOptions,
): Promise<RotateAgentKeyResult> {
  const graceDays = assertValidOptions(opts);
  const dryRun = opts.dryRun === true;
  const { tenantId } = opts;

  if (opts.revokeAfterGrace === true) {
    return withTenant(db, tenantId, async (trx) => {
      // Actor burada da çözülür: koşum denetim izi bırakmayacaksa bile
      // "kim koştu" sorusunun cevabı olmadan yazma yapılmaz.
      await resolveActorUserId(trx as unknown as Kysely<DB>, tenantId, opts.actor);
      const stale = await trx
        .selectFrom('agent_registration_keys')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('revoked_at', 'is', null)
        .where('valid_until', 'is not', null)
        .where('valid_until', '<=', new Date())
        .execute();
      if (stale.length > 0 && !dryRun) {
        await trx
          .updateTable('agent_registration_keys')
          .set({ revoked_at: new Date(), revoke_reason: 'rotated' })
          .where('tenant_id', '=', tenantId)
          .where(
            'id',
            'in',
            stale.map((r) => r.id),
          )
          .execute();
      }
      // Bu adım AYRI bir audit olayı YAZMAZ, bilinçli: iz tablonun kendisinde
      // kalıcıdır (`revoked_at` + `revoke_reason`) ve rotasyon olayı zaten
      // `grace_until`'i kaydetmişti. Yeni bir olay adı, yeni bir enum +
      // allow-list girdisi demekti; kazanç yok.
      return {
        mode: 'revoke-after-grace',
        dryRun,
        newKeyId: null,
        plaintextKey: null,
        graceUntil: null,
        affectedKeyCount: 0,
        revokedCount: stale.length,
      };
    });
  }

  const plaintextKey = generateAgentRegistrationKey(tenantId);
  const keyHash = await bcrypt.hash(plaintextKey, BCRYPT_COST);
  const newKeyId = randomUUID();
  const graceUntil = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000);

  const affectedKeyCount = await withTenant(db, tenantId, async (trx) => {
    const actorUserId = await resolveActorUserId(
      trx as unknown as Kysely<DB>,
      tenantId,
      opts.actor,
    );

    // Eski geçerli satırlar: `valid_until` ya boş ya da grace bitişinden
    // SONRA. İkincisi önemli — daha uzun bir pencereyi kısaltmak da
    // rotasyonun işidir, yoksa iki rotasyon üst üste gelince eski anahtar
    // beklenenden uzun yaşar.
    const old = await trx
      .selectFrom('agent_registration_keys')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('revoked_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('valid_until', 'is', null),
          eb('valid_until', '>', graceUntil),
        ]),
      )
      .execute();

    if (dryRun) {
      return old.length;
    }

    if (old.length > 0) {
      await trx
        .updateTable('agent_registration_keys')
        .set({ valid_until: graceUntil })
        .where('tenant_id', '=', tenantId)
        .where(
          'id',
          'in',
          old.map((r) => r.id),
        )
        .execute();
    }

    await trx
      .insertInto('agent_registration_keys')
      .values({
        id: newKeyId,
        tenant_id: tenantId,
        key_hash: keyHash,
        created_by_user_id: actorUserId,
      })
      .execute();

    // 🔴 Payload: yalnız id + pencere + sayı. Anahtarın kendisi ASLA.
    await writeAudit(trx, {
      tenantId,
      eventType: 'printer.registration_key_rotated',
      actorUserId,
      entityType: 'agent_registration_key',
      entityId: newKeyId,
      rawPayload: {
        registration_key_id: newKeyId,
        grace_until: graceUntil.toISOString(),
        affected_key_count: old.length,
      },
    });

    return old.length;
  });

  return {
    mode: 'rotate',
    dryRun,
    newKeyId: dryRun ? null : newKeyId,
    plaintextKey: dryRun ? null : plaintextKey,
    graceUntil,
    affectedKeyCount,
    revokedCount: 0,
  };
}

interface CliArgs extends RotateAgentKeyOptions {
  tenantId: string;
  actor: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new InvalidRotateArgsError(`${flag} bir değer bekliyor`);
    }
    return value;
  };
  const tenantId = get('--tenant-id');
  const actor = get('--actor');
  if (tenantId === undefined || actor === undefined) {
    throw new InvalidRotateArgsError('--tenant-id ve --actor zorunlu');
  }
  const graceRaw = get('--grace-days');
  // `exactOptionalPropertyTypes: true` — opsiyonel alana açıkça `undefined`
  // atanamaz, alan ya VAR ya YOK.
  return {
    tenantId,
    actor,
    ...(graceRaw === undefined ? {} : { graceDays: Number(graceRaw) }),
    dryRun: argv.includes('--dry-run'),
    revokeAfterGrace: argv.includes('--revoke-after-grace'),
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  // `app_tenant` tercih edilir (NOBYPASSRLS → `withTenant` context'i gerçekten
  // ısırır). `seed-demo-tenant.ts` ile aynı gerekçe: `migrator` BYPASSRLS'tir
  // ve o bağlantıda force-RLS hiçbir şey korumaz.
  const connectionString =
    process.env.DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL;
  if (connectionString === undefined) {
    console.error(
      '[rotate-agent-key] missing env: DATABASE_URL (tercih edilen) veya MIGRATOR_DATABASE_URL',
    );
    process.exit(1);
  }

  const pool = createPool({ connectionString });
  const db = createKysely(pool);
  try {
    const result = await rotateAgentKey(db, args);
    if (result.mode === 'revoke-after-grace') {
      console.log(
        `[rotate-agent-key] grace'i dolmuş ${String(result.revokedCount)} anahtar iptal edildi${result.dryRun ? ' (DRY-RUN, yazılmadı)' : ''}.`,
      );
      return;
    }
    if (result.dryRun) {
      console.log(
        `[rotate-agent-key] DRY-RUN: ${String(result.affectedKeyCount)} eski anahtara ` +
          `valid_until=${result.graceUntil?.toISOString() ?? '-'} yazılacaktı, yeni anahtar üretilmedi.`,
      );
      return;
    }
    // 🔴 SIR BURADA, BİR KEZ. Bu satırın çıktısı hiçbir yere kopyalanmamalı;
    // üç servisin nssm env'ine yazıldıktan sonra terminal geçmişi temizlenir.
    console.log('');
    console.log('=== YENİ KAYIT ANAHTARI (BİR KEZ GÖSTERİLİR) ===');
    console.log(result.plaintextKey ?? '');
    console.log('================================================');
    console.log('');
    console.log(
      `[rotate-agent-key] anahtar id=${result.newKeyId ?? '-'} · ` +
        `eski anahtar sayısı=${String(result.affectedKeyCount)} · ` +
        `grace bitişi=${result.graceUntil?.toISOString() ?? '-'}`,
    );
    console.log(
      '[rotate-agent-key] SIRADAKİ: üç servisin nssm env\'ini sırayla güncelle + restart, ' +
        'sonra DB\'den doğrula: SELECT device_fingerprint, registration_key_id FROM agents ' +
        'WHERE tenant_id = … AND revoked_at IS NULL; — ÜÇ satırda da YENİ id görünmeli.',
    );
  } finally {
    await db.destroy();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('rotate-agent-key.ts') === true) {
  main().catch((err: unknown) => {
    console.error(
      `[rotate-agent-key] HATA: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
