/**
 * bootstrap-prod.ts testleri — ADR-031 K4.
 *
 * Unit: parseCliArgs sözleşmesi.
 * Entegrasyon (DATABASE_URL gerekli — lokal pos_test / CI service container):
 * fresh koşum, idempotent tekrar, dry-run rollback, parola guard'ı,
 * üretilen API key'in register kontratıyla uyumu (bcrypt.compare + pk_ prefix).
 *
 * Temizlik: yalnız bu testin ürettiği slug'lı tenant'lar silinir
 * (DELETE FROM tenants YAPILMAZ — diğer test dosyalarına saygı).
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { createPool, createKysely } from '@restoran-pos/db';
import {
  parseCliArgs,
  bootstrapProd,
  BOOTSTRAP_FINGERPRINT,
  type BootstrapOptions,
} from './bootstrap-prod.js';

describe('parseCliArgs', () => {
  const BASE = [
    '--tenant-name',
    'Test Restoran',
    '--slug',
    'test-restoran',
    '--admin-email',
    'a@b.co',
  ];

  it('zorunlu argümanları parse eder + default\'ları uygular', () => {
    const args = parseCliArgs(BASE);
    expect(args).toEqual({
      tenantName: 'Test Restoran',
      slug: 'test-restoran',
      adminEmail: 'a@b.co',
      adminUsername: 'admin',
      timezone: 'Europe/Istanbul',
      dryRun: false,
    });
  });

  it('opsiyonelleri ve --dry-run\'ı alır', () => {
    const args = parseCliArgs([
      ...BASE,
      '--admin-username',
      'patron',
      '--timezone',
      'Europe/Berlin',
      '--dry-run',
    ]);
    expect(args.adminUsername).toBe('patron');
    expect(args.timezone).toBe('Europe/Berlin');
    expect(args.dryRun).toBe(true);
  });

  it('--tenant-name yoksa hata fırlatır', () => {
    expect(() => parseCliArgs(BASE.slice(2))).toThrow('--tenant-name');
  });

  it('geçersiz slug\'ı reddeder (büyük harf / tire ile bitiş)', () => {
    expect(() =>
      parseCliArgs(['--tenant-name', 'X', '--slug', 'Büyük', '--admin-email', 'a@b.co']),
    ).toThrow('--slug');
    expect(() =>
      parseCliArgs(['--tenant-name', 'X', '--slug', 'biten-', '--admin-email', 'a@b.co']),
    ).toThrow('--slug');
  });

  it('geçersiz e-postayı reddeder + e-postayı küçük harfe çevirir', () => {
    expect(() =>
      parseCliArgs(['--tenant-name', 'X', '--slug', 'x', '--admin-email', 'yok']),
    ).toThrow('--admin-email');
    expect(
      parseCliArgs(['--tenant-name', 'X', '--slug', 'x', '--admin-email', 'A@B.CO']).adminEmail,
    ).toBe('a@b.co');
  });
});

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined)('bootstrapProd (entegrasyon)', () => {
   
  const pool = createPool({ connectionString: DATABASE_URL! });
  const db = createKysely(pool);

  const RUN_ID = randomUUID().slice(0, 8);
  const SLUG = `bootstrap-vitest-${RUN_ID}`;
  const SLUG_DRY = `bootstrap-vitest-dry-${RUN_ID}`;

  const OPTS: BootstrapOptions = {
    tenantName: 'Vitest Pide Salonu',
    slug: SLUG,
    adminEmail: 'patron@vitest.test',
    adminUsername: 'admin',
    timezone: 'Europe/Istanbul',
    dryRun: false,
    adminPassword: 'cok-gizli-parola',
  };

  afterAll(async () => {
    // Yalnız kendi tenant'larımız — çocuklardan başlayarak.
    const tenants = await db
      .selectFrom('tenants')
      .select(['id'])
      .where('slug', 'like', `bootstrap-vitest-%${RUN_ID}%`)
      .execute();
    const ids = tenants.map((t) => t.id);
    if (ids.length > 0) {
      await db.deleteFrom('agents').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('users').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', 'in', ids).execute();
      await db.deleteFrom('tenants').where('id', 'in', ids).execute();
    }
    await db.destroy();
  });

  it('fresh koşum: tenant + settings + admin + agent oluşturur, key döner', async () => {
    const r = await bootstrapProd(db, OPTS);

    expect(r.created).toEqual({ tenant: true, settings: true, admin: true, agent: true });
    expect(r.agentApiKey).toBeDefined();

    // API key register kontratı: pk_<tenantIdShort8>_... + bcrypt.compare true
    const short = r.tenantId.replace(/-/g, '').slice(0, 8);
    expect(r.agentApiKey).toMatch(new RegExp(`^pk_${short}_`));

    const agent = await db
      .selectFrom('agents')
      .select(['api_key_hash', 'device_fingerprint'])
      .where('tenant_id', '=', r.tenantId)
      .executeTakeFirstOrThrow();
    expect(agent.device_fingerprint).toBe(BOOTSTRAP_FINGERPRINT);
     
    expect(await bcrypt.compare(r.agentApiKey!, agent.api_key_hash)).toBe(true);

    const admin = await db
      .selectFrom('users')
      .select(['role', 'email', 'password_hash'])
      .where('tenant_id', '=', r.tenantId)
      .where('username', '=', 'admin')
      .executeTakeFirstOrThrow();
    expect(admin.role).toBe('admin');
    expect(admin.email).toBe('patron@vitest.test');
    expect(await bcrypt.compare('cok-gizli-parola', admin.password_hash)).toBe(true);

    const settings = await db
      .selectFrom('tenant_settings')
      .select(['timezone'])
      .where('tenant_id', '=', r.tenantId)
      .executeTakeFirstOrThrow();
    expect(settings.timezone).toBe('Europe/Istanbul');
  });

  it('idempotent tekrar: hiçbir şey oluşturmaz, key YENİDEN ÜRETMEZ, parola istemez', async () => {
    // adminPassword bilinçli verilmiyor — mevcut admin varken gerekmemeli.
    const { adminPassword: _omit, ...rest } = OPTS;
    const r = await bootstrapProd(db, rest);

    expect(r.created).toEqual({ tenant: false, settings: false, admin: false, agent: false });
    expect(r.agentApiKey).toBeUndefined();

    const agentCount = await db
      .selectFrom('agents')
      .select(db.fn.countAll().as('n'))
      .where('tenant_id', '=', r.tenantId)
      .executeTakeFirstOrThrow();
    expect(Number(agentCount.n)).toBe(1);
  });

  it('dry-run: sonucu raporlar ama DB\'ye yazmaz', async () => {
    const r = await bootstrapProd(db, { ...OPTS, slug: SLUG_DRY, dryRun: true });

    expect(r.created.tenant).toBe(true); // "oluşturulACAKtı"
    const inDb = await db
      .selectFrom('tenants')
      .select(['id'])
      .where('slug', '=', SLUG_DRY)
      .executeTakeFirst();
    expect(inDb).toBeUndefined();
  });

  it('admin oluşturulacaksa parola zorunlu (min 8)', async () => {
    const { adminPassword: _pw, ...noPw } = OPTS;
    await expect(
      bootstrapProd(db, {
        ...noPw,
        slug: `bootstrap-vitest-pw-${RUN_ID}`,
      }),
    ).rejects.toThrow('ADMIN_PASSWORD');
    await expect(
      bootstrapProd(db, {
        ...OPTS,
        slug: `bootstrap-vitest-pw-${RUN_ID}`,
        adminPassword: 'kisa',
      }),
    ).rejects.toThrow('ADMIN_PASSWORD');
  });
});
