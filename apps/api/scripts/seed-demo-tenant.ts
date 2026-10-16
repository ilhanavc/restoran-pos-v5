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
 *     lower(name)) üzerinden yapılır. ⚠️ Arama `deleted_at IS NULL` filtreli
 *     olduğu için bir demo ürünü soft-delete edilirse sonraki koşum onu
 *     **yeniden ekler** (sessiz duplicate, 23505 değil — doğal UNIQUE yok).
 *     Demo tenant'ta bu **istenen** davranıştır: tazelemenin yolu script'i
 *     yeniden koşmaktır (ADR-043 K4.3) ve silinen ürün geri gelmelidir.
 *   · `users`      UNIQUE (tenant_id, lower(username)) **ve**
 *                  UNIQUE (tenant_id, lower(email)) — ikisi de kısmi değil.
 *                  E-posta username'den türetildiği için ikisi birlikte tutar.
 *                  (`users`'ta `deleted_at` kolonu YOK — mig 018 hard-delete.)
 *
 * Kullanım (sunucuda, /opt/restoran-pos/apps/api içinden):
 *
 *   set -a; . /etc/restoran-pos/api.env; set +a
 *    DEMO_WAITER_PASSWORD='...' ./node_modules/.bin/tsx scripts/seed-demo-tenant.ts \
 *      --slug demo [--waiter-username demo-garson] [--dry-run]
 *
 * Tek `source` iki savunmayı birden getirir: `TENANT_ID` (K5 bariyerinin
 * dayanağı — yoksa script koşmaz) ve `DATABASE_URL` (`app_tenant`, RLS'li).
 *
 * ⚠️ İkinci satır **boşlukla başlıyor**: `HISTCONTROL=ignorespace` ayarlıysa
 * komut kabuk geçmişine yazılmaz. Şifre argüman değil env prefix'i olduğu için
 * `ps`/argv'de görünmez, ama `~/.bash_history` prod kutusunda kalıcı düz
 * metindir. Alternatif: `read -rs DEMO_WAITER_PASSWORD`.
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

/**
 * `[kod, bölge adı, kapasite, display_no]` — 10 masa, 6 iç / 4 bahçe.
 *
 * ⚠️ `display_no` BOŞ BIRAKILMAZ. `tableLabel` (shared-domain/table.ts:62)
 * `display_no` NULL ise ham `code`'a düşer → incelemeci "Masa 1" yerine "1"
 * görür. Ayrıca uygulamanın kendi masa-ekleme yolu bölge içinde MAX+1 atar;
 * NULL bıraksaydık UI'dan açılan ilk masa `display_no=1` alıp etiketi
 * çakıştırırdı. Numaralar **bölge içinde** 1'den başlar (ADR-009 Amd2:
 * kalıcı per-bölge görüntü numarası), `code` ise tenant genelinde tekildir.
 */
const DEMO_TABLES: readonly (readonly [string, string, number, number])[] = [
  ['1', 'İç Salon', 4, 1],
  ['2', 'İç Salon', 4, 2],
  ['3', 'İç Salon', 2, 3],
  ['4', 'İç Salon', 6, 4],
  ['5', 'İç Salon', 4, 5],
  ['6', 'İç Salon', 2, 6],
  ['7', 'Bahçe', 4, 1],
  ['8', 'Bahçe', 4, 2],
  ['9', 'Bahçe', 6, 3],
  ['10', 'Bahçe', 2, 4],
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
  /**
   * Canlı tenant id'si — K5 bariyeri bunun karşısında kontrol eder.
   *
   * 🔴 **ZORUNLU, opsiyonel DEĞİL.** İlk hâlinde `?` ile opsiyoneldi ve
   * `main()` yalnız `TENANT_ID` env'i varsa geçiriyordu → env yazılmamışsa
   * bariyer **sessizce kapanıyordu** (fail-open). Güvenlik kapısı BLOCKER
   * olarak yakaladı ve iki dayanağı prod'da doğrulandı:
   *   · `MIGRATOR_DATABASE_URL` kalıcı env'e yazılmaz, deploy anında satır
   *     başında verilir (`docs/ops/deploy.md`) → o kabukta `TENANT_ID` YOK.
   *   · `migrator` rolü **BYPASSRLS** (prod'da `pg_roles` ile sayıldı) → o
   *     bağlantıda 26/26 force-RLS hiçbir şey korumaz; canlı tenant'a
   *     yazmaya karşı tek savunma bu bariyer ve açık `tenant_id` literal'i.
   * ADR-043 K5'in lafzı "bariyer koda gömülür, operatörün dikkatine
   * bırakılmaz" — env'in varlığına bağlı bariyer tam olarak dikkate
   * bırakılmış bariyerdir. Tip zorunlu yapıldı ki her çağrı yeri derleme
   * zamanında bunu vermek zorunda kalsın.
   */
  liveTenantId: string;
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

  // 2) 🔴 K5 bariyeri — HER TÜRLÜ YAZMADAN ÖNCE, KOŞULSUZ.
  //    Boş/eksik değer "bariyer yok" anlamına GELMEZ; fail-closed davranır.
  if (opts.liveTenantId.trim() === '') {
    throw new Error(
      'ADR-043 K5 — liveTenantId boş: canlı tenant bilinmeden tohumlama yapılamaz (fail-closed).',
    );
  }
  if (tenant.id === opts.liveTenantId) {
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
      for (const [code, areaName, capacity, displayNo] of DEMO_TABLES) {
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
            display_no: displayNo,
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

  // ⚠️ Öncelik `bootstrap-prod.ts`'in TERSİ ve bu bilinçli.
  //
  // bootstrap şema-öncesi iş yaptığı için `migrator` ister. Bu script ise
  // yalnız satır ekler ve `app_tenant`'ın beş tabloda da INSERT yetkisi var
  // (prod'da `role_table_grants` ile doğrulandı). `migrator` **BYPASSRLS**
  // (prod'da `pg_roles` ile doğrulandı) → o bağlantıda force-RLS hiçbir şey
  // korumaz ve yanlış tenant'a yazmaya karşı tek savunma K5 bariyeri kalır.
  // `app_tenant` NOBYPASSRLS olduğu için `withTenant` context'i gerçekten
  // ısırır: bariyer atlansa bile DB ikinci ağ olur.
  const connectionString =
    process.env.DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL;
  if (connectionString === undefined) {
    console.error(
      '[seed-demo] missing env: DATABASE_URL (tercih edilen) veya MIGRATOR_DATABASE_URL set edilmeli',
    );
    process.exit(1);
  }

  // 🔴 K5 fail-closed: TENANT_ID olmadan KOŞMAYIZ.
  //
  // Bu env uygulamanın kalıcı env'inde (`/etc/restoran-pos/api.env`) durur ama
  // script tipik olarak satır başında verilen MIGRATOR_DATABASE_URL ile
  // koşulur — o kabukta TENANT_ID olmayabilir. Eksikse bariyerin dayanağı
  // kalmaz; "bariyersiz devam et" seçeneği YOKTUR.
  const liveTenantId = process.env.TENANT_ID;
  if (liveTenantId === undefined || liveTenantId.trim() === '') {
    console.error(
      '[seed-demo] REDDEDİLDİ: TENANT_ID env yok. ADR-043 K5 bariyeri canlı ' +
        'tenant id\'sini bilmeden koşamaz; bariyersiz tohumlama yapılmaz. ' +
        'Koşum satırına canlı tenant id\'sini ekleyin: TENANT_ID=<uuid> …',
    );
    process.exit(2);
  }

  const pool = createPool({ connectionString });
  const db = createKysely(pool);

  try {
    const result = await seedDemoTenant(db, {
      ...args,
      liveTenantId,
      ...(process.env.DEMO_WAITER_PASSWORD === undefined
        ? {}
        : { waiterPassword: process.env.DEMO_WAITER_PASSWORD }),
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
