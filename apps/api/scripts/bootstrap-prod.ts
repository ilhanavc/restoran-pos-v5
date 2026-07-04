/**
 * Prod tenant bootstrap — ADR-031 K4.
 *
 * Oluşturur (idempotent): tenant (name = fiş başlığında basılan işletme adı)
 * + tenant_settings (yalnız timezone — Migration 026 sonrası tek kolon)
 * + admin kullanıcı (bcrypt cost 12)
 * + ilk `agents` satırı (Print Agent auth — Manager UI yok, ADR-004 Amendment 2;
 *   bu satır olmadan /agent/register 401 döner, yazıcı bağlanamaz).
 *
 * İdempotency: sabit UUID KULLANMAZ (prod!). Doğal anahtarlar üzerinden
 * select-then-insert: tenants.slug (UNIQUE) → users(tenant_id, username)
 * → agents(tenant_id, device_fingerprint='bootstrap-initial').
 * Tekrar koşumda hiçbir satır değişmez; agent API key YENİDEN ÜRETİLMEZ
 * (plaintext yalnız ilk üretimde BİR KEZ basılır).
 *
 * `seed.ts` DEĞİL: seed dev-only'dir (sabit UUID + demo veri + dev şifreler).
 *
 * Kullanım (sunucuda, /opt/restoran-pos/apps/api içinden):
 *   ADMIN_PASSWORD='...' ./node_modules/.bin/tsx scripts/bootstrap-prod.ts \
 *     --tenant-name "Restoran Adı" --slug restoran-adi \
 *     --admin-email admin@example.com [--admin-username admin] \
 *     [--timezone Europe/Istanbul] [--dry-run]
 *
 * Bağlantı: MIGRATOR_DATABASE_URL ?? DATABASE_URL (seed.ts ile aynı öncelik).
 * Çıktıdaki TENANT_ID değeri /etc/restoran-pos/api.env'e eklenir (ADR-031 K4
 * DoD: env TENANT_ID = bootstrap tenant UUID eşleşmesi).
 */

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import bcrypt from 'bcryptjs';
import { createPool, createKysely } from '@restoran-pos/db';
import {
  generateAgentApiKey,
  hashAgentApiKey,
} from '../src/routes/print-jobs.js';

type Db = ReturnType<typeof createKysely>;

/** Bootstrap'in yarattığı ilk agents satırının sabit fingerprint'i.
 *  Gerçek Print Agent kendi cihaz fingerprint'iyle register olur ve register
 *  flow'u api_key_hash'i bu satırdan kopyalayarak YENİ satır ekler. */
export const BOOTSTRAP_FINGERPRINT = 'bootstrap-initial';

// bcrypt cost 12 — apps/api auth ile aynı (seed.ts yorumu + BCRYPT_COST).
const BCRYPT_COST = 12;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface CliArgs {
  tenantName: string;
  slug: string;
  adminEmail: string;
  adminUsername: string;
  timezone: string;
  dryRun: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      throw new Error(`${flag} bir değer bekliyor`);
    }
    return v;
  };

  const tenantName = get('--tenant-name');
  if (tenantName === undefined || tenantName.trim() === '') {
    throw new Error('--tenant-name zorunlu (fiş başlığında basılan işletme adı)');
  }
  const slug = get('--slug');
  if (slug === undefined || !SLUG_RE.test(slug)) {
    throw new Error(
      '--slug zorunlu; yalnız küçük harf/rakam/tire, tire ile başlayıp bitemez (ör. pide-lokantasi)',
    );
  }
  const adminEmail = get('--admin-email');
  if (adminEmail === undefined || !adminEmail.includes('@')) {
    throw new Error('--admin-email zorunlu ve geçerli bir e-posta olmalı');
  }

  return {
    tenantName: tenantName.trim(),
    slug,
    adminEmail: adminEmail.trim().toLowerCase(),
    adminUsername: get('--admin-username') ?? 'admin',
    timezone: get('--timezone') ?? 'Europe/Istanbul',
    dryRun: argv.includes('--dry-run'),
  };
}

export interface BootstrapOptions extends CliArgs {
  /** Admin INSERT gerekiyorsa zorunlu (min 8 karakter); mevcut admin varsa kullanılmaz. */
  adminPassword?: string;
}

export interface BootstrapResult {
  tenantId: string;
  created: { tenant: boolean; settings: boolean; admin: boolean; agent: boolean };
  /** Yalnız agents satırı BU koşumda oluşturulduysa döner — bir kez göster. */
  agentApiKey?: string;
}

/** dry-run transaction rollback sentinel'i. */
class DryRunRollback extends Error {
  readonly result: BootstrapResult;
  constructor(result: BootstrapResult) {
    super('dry-run rollback');
    this.result = result;
  }
}

export async function bootstrapProd(
  db: Db,
  opts: BootstrapOptions,
): Promise<BootstrapResult> {
  let result: BootstrapResult | undefined;

  try {
    await db.transaction().execute(async (trx) => {
      // 1) tenant — doğal anahtar: slug (UNIQUE)
      const existingTenant = await trx
        .selectFrom('tenants')
        .select(['id'])
        .where('slug', '=', opts.slug)
        .executeTakeFirst();

      const tenantId = existingTenant?.id ?? randomUUID();
      const createdTenant = existingTenant === undefined;
      if (createdTenant) {
        await trx
          .insertInto('tenants')
          .values({ id: tenantId, name: opts.tenantName, slug: opts.slug })
          .execute();
      }

      // 2) tenant_settings — yalnız timezone (business_day_cutoff_hour
      //    Migration 026'da DROP edildi; ADR-031 K4).
      const settingsInsert = await trx
        .insertInto('tenant_settings')
        .values({ tenant_id: tenantId, timezone: opts.timezone })
        .onConflict((oc) => oc.column('tenant_id').doNothing())
        .executeTakeFirst();
      const createdSettings =
        Number(settingsInsert.numInsertedOrUpdatedRows ?? 0n) > 0;

      // 3) admin kullanıcı — doğal anahtar: (tenant_id, username)
      const existingAdmin = await trx
        .selectFrom('users')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('username', '=', opts.adminUsername)
        .executeTakeFirst();

      let createdAdmin = false;
      if (existingAdmin === undefined) {
        if (opts.adminPassword === undefined || opts.adminPassword.length < 8) {
          throw new Error(
            'ADMIN_PASSWORD env zorunlu (min 8 karakter) — admin kullanıcı bu koşumda oluşturulacak',
          );
        }
        await trx
          .insertInto('users')
          .values({
            id: randomUUID(),
            tenant_id: tenantId,
            role: 'admin',
            username: opts.adminUsername,
            email: opts.adminEmail,
            password_hash: await bcrypt.hash(opts.adminPassword, BCRYPT_COST),
          })
          .execute();
        createdAdmin = true;
      }

      // 4) ilk agents satırı — doğal anahtar: (tenant_id, BOOTSTRAP_FINGERPRINT).
      //    Var ise API key YENİDEN ÜRETİLMEZ (plaintext geri getirilemez;
      //    kayıpsa satır revoke edilip script yeniden koşulur).
      const existingAgent = await trx
        .selectFrom('agents')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('device_fingerprint', '=', BOOTSTRAP_FINGERPRINT)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();

      let agentApiKey: string | undefined;
      let createdAgent = false;
      if (existingAgent === undefined) {
        agentApiKey = generateAgentApiKey(tenantId);
        await trx
          .insertInto('agents')
          .values({
            id: randomUUID(),
            tenant_id: tenantId,
            device_fingerprint: BOOTSTRAP_FINGERPRINT,
            api_key_hash: await hashAgentApiKey(agentApiKey),
          })
          .execute();
        createdAgent = true;
      }

      const r: BootstrapResult = {
        tenantId,
        created: {
          tenant: createdTenant,
          settings: createdSettings,
          admin: createdAdmin,
          agent: createdAgent,
        },
        ...(agentApiKey === undefined ? {} : { agentApiKey }),
      };

      if (opts.dryRun) {
        throw new DryRunRollback(r);
      }
      result = r;
    });
  } catch (err) {
    if (err instanceof DryRunRollback) {
      result = err.result;
    } else {
      throw err;
    }
  }

  if (result === undefined) {
    throw new Error('bootstrap sonucu üretilemedi (beklenmedik durum)');
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  const connectionString =
    process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
  if (connectionString === undefined) {
    console.error('[bootstrap] missing env: MIGRATOR_DATABASE_URL veya DATABASE_URL set edilmeli');
    process.exit(1);
  }

  const pool = createPool({ connectionString });
  const db = createKysely(pool);

  try {
    const result = await bootstrapProd(db, {
      ...args,
      ...(process.env.ADMIN_PASSWORD === undefined
        ? {}
        : { adminPassword: process.env.ADMIN_PASSWORD }),
    });

    const mode = args.dryRun ? ' (DRY-RUN — hiçbir şey yazılmadı)' : '';
    console.log(`[bootstrap] tamam${mode}.`);
    console.log(
      `[bootstrap] tenant: ${result.created.tenant ? 'OLUŞTURULDU' : 'mevcut'} · ` +
        `settings: ${result.created.settings ? 'OLUŞTURULDU' : 'mevcut'} · ` +
        `admin: ${result.created.admin ? 'OLUŞTURULDU' : 'mevcut'} · ` +
        `agent: ${result.created.agent ? 'OLUŞTURULDU' : 'mevcut'}`,
    );
    console.log('');
    console.log(`TENANT_ID=${result.tenantId}`);
    console.log('  → /etc/restoran-pos/api.env dosyasına ekle, sonra: pm2 restart pos-api');

    if (result.agentApiKey !== undefined) {
      console.log('');
      console.log('=== PRINT AGENT API KEY — YALNIZ BU KOŞUMDA GÖSTERİLİR ===');
      console.log(result.agentApiKey);
      console.log('  → Print Agent config (%PROGRAMDATA%\\restoran-pos\\print-agent.json) apiKey alanına gir.');
      console.log('  → Kaybedersen: agents satırını revoke et + script\'i yeniden koş (yeni key üretilir).');
    }
  } finally {
    // Kysely.destroy() pool'u kapatır; ayrıca pool.end() çağırma (seed.ts notu).
    await db.destroy();
  }
}

// Test import'unda main koşmasın (vitest bu dosyayı import eder).
const isDirectRun = process.argv[1]?.endsWith('bootstrap-prod.ts') === true;
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error('[bootstrap] fatal:', err);
    process.exit(1);
  });
}
