/**
 * Demo tenant tohumlama — ADR-043 (v5.1 Faz 2).
 *
 * `bootstrap-prod.ts` tenant iskeletini kurar (tenant + tenant_settings +
 * admin + ilk `agents` satırı) ama **içerik yaratmaz**: bölge, masa, kategori,
 * ürün hepsi boş kalır ve yalnız `admin` açılır. Bu script o boşluğu doldurur:
 * demo tenant'a gerçekçi-ama-küçük bir katalog + bir `waiter` hesabı ekler.
 *
 * Çıktısı Play Console *App access* / App Store Connect *Sign-In Required*
 * alanlarına girilecek inceleme hesabıdır — incelemeci masa listesini görmeli,
 * adisyon açabilmeli, sipariş oluşturabilmelidir (ADR-031 Amd4 K8'in inceleme
 * notunda söz verilen akış).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 🔴 ADR-043 K5 — CANLI TENANT BARİYERİ
 *
 * Hedef tenant, `TENANT_ID` env'indeki **canlı** tenant'a eşitse script
 * hiçbir şey yazmadan hata ile çıkar. Bu işin tek gerçek yıkıcı senaryosu
 * demo ürünlerinin / masalarının gerçek restorana tohumlanmasıdır; sonucu
 * yoğun saatte garsonun gördüğü sahte masalar ve canlı menüde olmayan
 * ürünlerdir. K4 gereği script hiçbir şey silmediği için temizliği **elle**
 * yapmak gerekirdi. Bariyer bu yüzden koda gömülüdür, operatörün dikkatine
 * bırakılmaz. `--force` bayrağı **bilerek YOKTUR** (ADR-043 K5).
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ADR-043 K4 — yalnız-ekler: `TRUNCATE`/`DELETE`/`DROP` bu dosyada **geçmez**.
 * `apps/web/e2e/fixtures/seed.ts`'in `TRUNCATE … CASCADE` deseni prod yoluna
 * yaklaştırılmaz. İdempotency doğal anahtar üzerinden select-then-insert'tir;
 * sabit UUID **kullanılmaz** (prod!) — `packages/db/src/seed.ts` dev-only'dir.
 *
 * ⚠️ İdempotency sorguları prod'daki **gerçek** UNIQUE kısıtlarına göre yazıldı
 * (2026-10-16'da `pg_index`'ten okundu), TS tiplerine göre değil:
 *   · `areas`      UNIQUE (tenant_id, lower(trim(name))) WHERE deleted_at IS NULL
 *   · `categories` UNIQUE (tenant_id, lower(name))       WHERE deleted_at IS NULL
 *   · `tables`     UNIQUE (tenant_id, code) — **KISMİ DEĞİL**: soft-delete
 *     edilmiş bir masa kodu da INSERT'i bloklar, bu yüzden masa aramasında
 *     `deleted_at` filtresi **yoktur** (olsaydı 23505 alırdık).
 *   · `products`   doğal UNIQUE **yok** → arama (tenant_id, category_id,
 *     lower(name)) üzerinden yapılır.
 *   · `users`      UNIQUE (tenant_id, lower(username))
 *
 * Kullanım (sunucuda, /opt/restoran-pos/apps/api içinden):
 *   DEMO_WAITER_PASSWORD='...' ./node_modules/.bin/tsx scripts/seed-demo-tenant.ts \
 *     --slug demo [--waiter-username demo-garson] [--dry-run]
 *
 * Bağlantı: MIGRATOR_DATABASE_URL ?? DATABASE_URL (bootstrap-prod.ts ile aynı).
 */

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import bcrypt from 'bcryptjs';
import { createPool, createKysely, withTenant } from '@restoran-pos/db';

type Db = ReturnType<typeof createKysely>;

/** bcrypt cost 12 — bootstrap-prod.ts ve apps/api auth ile aynı. */
const BCRYPT_COST = 12;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * ADR-043 K4.2 — demo katalogu **JENERİKTİR**, canlı menüden türetilmez.
 * Ürün sahibine üç seçenek sunuldu; "canlı menünün kopyası" seçilmedi. Menü ve
 * fiyatlar işletmenin ticari bilgisidir ve mağaza incelemecisine açılır.
 * Fiyatlar **kuruş** (integer minor unit — CLAUDE.md: float yasak).
 */
const DEMO_AREAS = ['İç Salon', 'Bahçe'] as const;

/** `[kod, bölge adı, kapasite]` — 10 masa, 6 iç / 4 bahçe. */
const DEMO_TABLES: readonly (readonly [string, string, number])[] = [
  ['1', 'İç Salon', 4],
  ['2', 'İç Salon', 4],
  ['3', 'İç Salon', 2],
  ['4', 'İç Salon', 6],
  ['5', 'İç Salon', 4],
  ['6', 'İç Salon', 2],
  ['7', 'Bahçe', 4],
  ['8', 'Bahçe', 4],
  ['9', 'Bahçe', 6],
  ['10', 'Bahçe', 2],
];

/** `[kategori, ürün, kuruş]` — 4 kategori, 15 ürün. */
const DEMO_PRODUCTS: readonly (readonly [string, string, number])[] = [
  ['Pideler', 'Kıymalı Pide', 18_000],
  ['Pideler', 'Kaşarlı Pide', 19_000],
  ['Pideler', 'Kuşbaşılı Pide', 22_000],
  ['Pideler', 'Karışık Pide', 24_000],
  ['Pideler', 'Sucuklu Pide', 20_000],
  ['Çorbalar', 'Mercimek Çorbası', 7_000],
  ['Çorbalar', 'Ezogelin Çorbası', 7_500],
  ['Çorbalar', 'Yayla Çorbası', 7_500],
  ['İçecekler', 'Ayran', 3_500],
  ['İçecekler', 'Şalgam', 4_000],
  ['İçecekler', 'Soda', 3_000],
  ['İçecekler', 'Su', 1_500],
  ['İçecekler', 'Çay', 2_000],
  ['Tatlılar', 'Künefe', 15_000],
  ['Tatlılar', 'Sütlaç', 9_000],
];

export interface CliArgs {
  slug: string;
  waiterUsername: string;
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

  const slug = get('--slug');
  if (slug === undefined || !SLUG_RE.test(slug)) {
    throw new Error(
      '--slug zorunlu; yalnız küçük harf/rakam/tire, tire ile başlayıp bitemez (ör. demo)',
    );
  }

  return {
    slug,
    waiterUsername: get('--waiter-username') ?? 'demo-garson',
    dryRun: argv.includes('--dry-run'),
  };
}

export interface SeedOptions extends CliArgs {
  /** `waiter` INSERT gerekiyorsa zorunlu (min 8 karakter). */
  waiterPassword?: string;
  /** Canlı tenant id'si — bariyer bunun karşısında kontrol eder (K5). */
  liveTenantId?: string;
}

export interface SeedResult {
  tenantId: string;
  created: {
    areas: number;
    tables: number;
    categories: number;
    products: number;
    waiter: boolean;
  };
  /** Kodu zaten var olan (muhtemelen soft-delete edilmiş) masalar — bilgi. */
  skippedTableCodes: string[];
}

/** dry-run transaction rollback sentinel'i (bootstrap-prod.ts deseni). */
class DryRunRollback extends Error {
  readonly result: SeedResult;
  constructor(result: SeedResult) {
    super('dry-run rollback');
    this.result = result;
  }
}

export class LiveTenantBarrierError extends Error {
  constructor(tenantId: string) {
    super(
      `ADR-043 K5 — REDDEDİLDİ: hedef tenant (${tenantId}) TENANT_ID env'indeki CANLI tenant. ` +
        'Demo verisi gerçek restorana tohumlanamaz. Hiçbir şey yazılmadı.',
    );
    this.name = 'LiveTenantBarrierError';
  }
}

export async function seedDemoTenant(
  db: Db,
  opts: SeedOptions,
): Promise<SeedResult> {
  // 1) Tenant'ı slug'dan çöz — `tenants` RLS dışıdır, context gerekmez.
  const tenant = await db
    .selectFrom('tenants')
    .select(['id'])
    .where('slug', '=', opts.slug)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (tenant === undefined) {
    throw new Error(
      `tenant bulunamadı (slug='${opts.slug}') — önce bootstrap-prod.ts koşulmalı`,
    );
  }

  // 2) 🔴 K5 bariyeri — HER TÜRLÜ YAZMADAN ÖNCE.
  if (opts.liveTenantId !== undefined && tenant.id === opts.liveTenantId) {
    throw new LiveTenantBarrierError(tenant.id);
  }

  let result: SeedResult | undefined;

  try {
    await withTenant(db, tenant.id, async (trx) => {
      const r: SeedResult = {
        tenantId: tenant.id,
        created: {
          areas: 0,
          tables: 0,
          categories: 0,
          products: 0,
          waiter: false,
        },
        skippedTableCodes: [],
      };

      // ── Bölgeler — UNIQUE (tenant_id, lower(trim(name))) WHERE deleted_at IS NULL
      const areaIdByName = new Map<string, string>();
      for (const name of DEMO_AREAS) {
        const existing = await trx
          .selectFrom('areas')
          .select(['id'])
          .where('tenant_id', '=', tenant.id)
          // ⚠️ Küçültme İKİ TARAFTA DA Postgres'te yapılır. JS'te
          // `'İ'.toLowerCase()` → `i` + birleşik nokta (U+0307) üretir,
          // Postgres'in `lower()`'ı locale'e bağlıdır — iki taraf farklı
          // küçültülürse eşleşme kaçar ve ikinci koşum 23505 alır
          // (ADR-042 S1'in İ/I tuzağı; burada "İç Salon"da ampirik yaşandı).
          .where((eb) =>
            eb(
              eb.fn('lower', [eb.fn('trim', ['name'])]),
              '=',
              eb.fn('lower', [eb.fn('trim', [eb.val(name)])]),
            ),
          )
          .where('deleted_at', 'is', null)
          .executeTakeFirst();

        if (existing !== undefined) {
          areaIdByName.set(name, existing.id);
          continue;
        }
        const id = randomUUID();
        await trx
          .insertInto('areas')
          .values({ id, tenant_id: tenant.id, name })
          .execute();
        areaIdByName.set(name, id);
        r.created.areas += 1;
      }

      // ── Masalar — UNIQUE (tenant_id, code) **kısmi DEĞİL** → deleted_at
      //    filtresi YOK; soft-delete edilmiş kod da INSERT'i bloklar.
      for (const [code, areaName, capacity] of DEMO_TABLES) {
        const existing = await trx
          .selectFrom('tables')
          .select(['id', 'deleted_at'])
          .where('tenant_id', '=', tenant.id)
          .where('code', '=', code)
          .executeTakeFirst();

        if (existing !== undefined) {
          // Soft-delete edilmişse DİRİLTİLMEZ (K4: yalnız-ekler) — bildirilir.
          if (existing.deleted_at !== null) r.skippedTableCodes.push(code);
          continue;
        }
        const areaId = areaIdByName.get(areaName);
        await trx
          .insertInto('tables')
          .values({
            id: randomUUID(),
            tenant_id: tenant.id,
            code,
            capacity,
            ...(areaId === undefined ? {} : { area_id: areaId }),
          })
          .execute();
        r.created.tables += 1;
      }

      // ── Kategoriler — UNIQUE (tenant_id, lower(name)) WHERE deleted_at IS NULL
      const categoryIdByName = new Map<string, string>();
      const categoryNames = [...new Set(DEMO_PRODUCTS.map(([c]) => c))];
      for (const name of categoryNames) {
        const existing = await trx
          .selectFrom('categories')
          .select(['id'])
          .where('tenant_id', '=', tenant.id)
          // Küçültme iki tarafta da SQL'de (İ/I tuzağı — yukarıdaki nota bak).
          .where((eb) =>
            eb(eb.fn('lower', ['name']), '=', eb.fn('lower', [eb.val(name)])),
          )
          .where('deleted_at', 'is', null)
          .executeTakeFirst();

        if (existing !== undefined) {
          categoryIdByName.set(name, existing.id);
          continue;
        }
        const id = randomUUID();
        await trx
          .insertInto('categories')
          .values({ id, tenant_id: tenant.id, name })
          .execute();
        categoryIdByName.set(name, id);
        r.created.categories += 1;
      }

      // ── Ürünler — doğal UNIQUE YOK → (tenant_id, category_id, lower(name))
      //    `products.category_id` NOT NULL: kategori sırası bağlayıcı.
      for (const [categoryName, name, priceCents] of DEMO_PRODUCTS) {
        const categoryId = categoryIdByName.get(categoryName);
        if (categoryId === undefined) {
          throw new Error(`kategori çözülemedi: ${categoryName}`);
        }
        const existing = await trx
          .selectFrom('products')
          .select(['id'])
          .where('tenant_id', '=', tenant.id)
          .where('category_id', '=', categoryId)
          .where((eb) =>
            eb(eb.fn('lower', ['name']), '=', eb.fn('lower', [eb.val(name)])),
          )
          .where('deleted_at', 'is', null)
          .executeTakeFirst();

        if (existing !== undefined) continue;
        await trx
          .insertInto('products')
          .values({
            id: randomUUID(),
            tenant_id: tenant.id,
            category_id: categoryId,
            name,
            price_cents: priceCents,
          })
          .execute();
        r.created.products += 1;
      }

      // ── `waiter` hesabı — UNIQUE (tenant_id, lower(username))
      const existingWaiter = await trx
        .selectFrom('users')
        .select(['id'])
        .where('tenant_id', '=', tenant.id)
        .where((eb) =>
          eb(
            eb.fn('lower', ['username']),
            '=',
            eb.fn('lower', [eb.val(opts.waiterUsername)]),
          ),
        )
        .executeTakeFirst();

      if (existingWaiter === undefined) {
        if (opts.waiterPassword === undefined || opts.waiterPassword.length < 8) {
          throw new Error(
            'DEMO_WAITER_PASSWORD env zorunlu (min 8 karakter) — waiter bu koşumda oluşturulacak',
          );
        }
        await trx
          .insertInto('users')
          .values({
            id: randomUUID(),
            tenant_id: tenant.id,
            role: 'waiter',
            username: opts.waiterUsername,
            email: `${opts.waiterUsername}@${opts.slug}.local`,
            password_hash: await bcrypt.hash(opts.waiterPassword, BCRYPT_COST),
          })
          .execute();
        r.created.waiter = true;
      }

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
    throw new Error('tohumlama sonucu üretilemedi (beklenmedik durum)');
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  const connectionString =
    process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
  if (connectionString === undefined) {
    console.error(
      '[seed-demo] missing env: MIGRATOR_DATABASE_URL veya DATABASE_URL set edilmeli',
    );
    process.exit(1);
  }

  const pool = createPool({ connectionString });
  const db = createKysely(pool);

  try {
    const result = await seedDemoTenant(db, {
      ...args,
      ...(process.env.DEMO_WAITER_PASSWORD === undefined
        ? {}
        : { waiterPassword: process.env.DEMO_WAITER_PASSWORD }),
      ...(process.env.TENANT_ID === undefined
        ? {}
        : { liveTenantId: process.env.TENANT_ID }),
    });

    const mode = args.dryRun ? ' (DRY-RUN — hiçbir şey yazılmadı)' : '';
    console.log(`[seed-demo] tamam${mode}. tenant: ${result.tenantId}`);
    console.log(
      `[seed-demo] eklendi → bölge: ${result.created.areas} · ` +
        `masa: ${result.created.tables} · kategori: ${result.created.categories} · ` +
        `ürün: ${result.created.products} · waiter: ${result.created.waiter ? 'EVET' : 'mevcut'}`,
    );
    if (result.skippedTableCodes.length > 0) {
      console.log(
        `[seed-demo] ⚠️ soft-delete edilmiş masa kodları atlandı (diriltilmez): ` +
          result.skippedTableCodes.join(', '),
      );
    }
  } catch (err) {
    if (err instanceof LiveTenantBarrierError) {
      console.error(`[seed-demo] ${err.message}`);
      process.exit(2);
    }
    console.error(
      `[seed-demo] HATA: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

// tsx ile doğrudan koşulduğunda çalışsın; test import'unda çalışmasın.
if (process.argv[1]?.endsWith('seed-demo-tenant.ts') === true) {
  await main();
}
