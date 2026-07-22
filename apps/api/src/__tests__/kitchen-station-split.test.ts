/**
 * ADR-032 Amendment 3 K1 — istasyon bölünmesi TÜM sipariş türlerinde.
 *
 * NEDEN BU DOSYA VAR: Amd1 bölünmeyi `order_type === 'dine_in'` ile
 * sınırlamıştı (K4b) ve bu koşulun **enqueue seviyesinde hiç testi yoktu**.
 * 2026-07-21'de canlıda görüldü ki paket siparişteki ızgara kalemleri FIRIN'dan
 * çıkıyor, IZGARA hiç görmüyor — ızgarada KDS de olmadığı için kalem hiçbir
 * kâğıtta ve hiçbir ekranda yok. Koşul kaldırıldı; bu testler onun geri
 * gelmesini engeller.
 *
 * `renderKitchenReceipt` raster (bitmap) ürettiği için fiş İÇERİĞİ bayt
 * seviyesinde okunamaz → bu dosya **yönlendirmeyi** doğrular (kaç job, hangi
 * `payload.kind`, hangi grup). İçerik kararları (K3 fiyatsızlık, K7 istasyon
 * etiketi) render-smoke testlerinde kapsanır.
 */
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DB } from '@restoran-pos/db';
import { enqueueKitchenJob } from '../print/enqueue-kitchen-job.js';
import { enqueuePackingJob } from '../print/enqueue-packing-job.js';

const DB_URL = process.env['DATABASE_URL'];
const TENANT_ID = randomUUID();

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
}
const ctx: Partial<TestCtx> = {};

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-032 Amd3 K1 — istasyon bölünmesi sipariş türünden bağımsızdır',
  () => {
    let kitchenCat: string;
    let grillCat: string;
    let kitchenProduct: string;
    let grillProduct: string;
    let customerId: string;

    beforeAll(async () => {
      ctx.pool = new Pool({ connectionString: DB_URL });
      ctx.db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: ctx.pool }) });

      await ctx.db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Split Test',
          slug: `split-test-${TENANT_ID.slice(0, 8)}`,
        })
        .execute();

      // orders insert'i tenant_settings satırı olmadan DB tarafında reddediliyor
      // (trigger: store_date hesabı timezone'a bağlı — ADR-015 Amd5).
      await ctx.db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID, timezone: 'Europe/Istanbul' })
        .execute();

      kitchenCat = randomUUID();
      grillCat = randomUUID();
      await ctx.db
        .insertInto('categories')
        .values([
          {
            id: kitchenCat,
            tenant_id: TENANT_ID,
            name: 'PIDELER-test',
            kitchen_print: true,
            print_station: null, // taban istasyon → 'kitchen'
          },
          {
            id: grillCat,
            tenant_id: TENANT_ID,
            name: 'IZGARA-test',
            kitchen_print: true,
            print_station: 'grill',
          },
        ])
        .execute();

      // DB CHECK `orders_takeaway_customer_when_takeaway`: takeaway siparişte
      // customer_id ZORUNLU.
      customerId = randomUUID();
      await ctx.db
        .insertInto('customers')
        .values({ id: customerId, tenant_id: TENANT_ID, full_name: 'Test Müşteri' })
        .execute();

      kitchenProduct = randomUUID();
      grillProduct = randomUUID();
      await ctx.db
        .insertInto('products')
        .values([
          {
            id: kitchenProduct,
            tenant_id: TENANT_ID,
            category_id: kitchenCat,
            name: 'Kıymalı Pide',
            price_cents: 20000,
          },
          {
            id: grillProduct,
            tenant_id: TENANT_ID,
            category_id: grillCat,
            name: 'Adana Şiş',
            price_cents: 30000,
          },
        ])
        .execute();
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('customer_addresses').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('customers').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
    });

    /** İki istasyondan birer kalemi olan, `status='sent'` bir sipariş kurar. */
    let orderNoSeq = 900;

    async function seedOrder(orderType: 'dine_in' | 'takeaway'): Promise<string> {
      const orderId = randomUUID();
      await ctx.db!
        .insertInto('orders')
        .values({
          id: orderId,
          tenant_id: TENANT_ID,
          order_no: ++orderNoSeq,
          store_date: '2026-07-21',
          order_type: orderType,
          status: 'open',
          total_cents: 50000,
          customer_id: customerId,
          ...(orderType === 'takeaway' ? { takeaway_stage: 'preparing' as const } : {}),
        })
        .execute();

      for (const [productId, name, price] of [
        [kitchenProduct, 'Kıymalı Pide', 20000],
        [grillProduct, 'Adana Şiş', 30000],
      ] as const) {
        await ctx.db!
          .insertInto('order_items')
          .values({
            id: randomUUID(),
            tenant_id: TENANT_ID,
            order_id: orderId,
            product_id: productId,
            product_name: name,
            category_name_snapshot: name === 'Adana Şiş' ? 'IZGARA-test' : 'PIDELER-test',
            quantity: 1,
            unit_price_cents: price,
            total_cents: price,
            status: 'sent',
          })
          .execute();
      }
      return orderId;
    }

    /** Siparişin (opsiyonel: belirli durumdaki) kalem id'leri. */
    async function itemIdsOf(
      orderId: string,
      status?: 'new' | 'sent',
    ): Promise<string[]> {
      let q = ctx
        .db!.selectFrom('order_items')
        .select(['id'])
        .where('order_id', '=', orderId)
        .where('tenant_id', '=', TENANT_ID);
      if (status !== undefined) q = q.where('status', '=', status);
      const rows = await q.execute();
      return rows.map((r) => r.id);
    }

    async function kindsFor(orderId: string): Promise<string[]> {
      const rows = await ctx.db!
        .selectFrom('print_jobs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      return rows
        .map((r) => r.payload as { kind: string; meta?: { orderId?: string } })
        .filter((p) => p.meta?.orderId === orderId)
        .map((p) => p.kind)
        .sort();
    }

    it('PAKET sipariş iki istasyona bölünür (K4b geri alındı)', async () => {
      const orderId = await seedOrder('takeaway');
      await enqueueKitchenJob(ctx.db!, {
        orderId,
        tenantId: TENANT_ID,
        orderNo: 1,
        tableCodeSnapshot: null,
        areaNameSnapshot: null,
        waiterUserId: null,
        itemIds: await itemIdsOf(orderId),
      });
      // Bu satır fix'ten önce ['kitchen'] döner (tek job, üç kalem birlikte).
      expect(await kindsFor(orderId)).toEqual(['grill', 'kitchen']);
    });

    it('MASA siparişi aynı şekilde bölünür (regresyon yok)', async () => {
      const orderId = await seedOrder('dine_in');
      await enqueueKitchenJob(ctx.db!, {
        orderId,
        tenantId: TENANT_ID,
        orderNo: 2,
        tableCodeSnapshot: 'Masa 1',
        areaNameSnapshot: null,
        waiterUserId: null,
        itemIds: await itemIdsOf(orderId),
      });
      expect(await kindsFor(orderId)).toEqual(['grill', 'kitchen']);
    });

    it('kalem eklenince YALNIZ yeni kalem basılır — önceki istasyon tekrar basmaz', async () => {
      // S103 CANLI BUG: ürün sahibi paket siparişte ızgara kalemini düzeltti;
      // fırın da aynı kalemi İKİNCİ KEZ bastı (aşçı için "yeni sipariş" =
      // çift pişirme riski). Kök neden: enqueue yalnız `status='sent'`
      // filtreliyordu, `sent` ise kalıcı bir durum.
      const orderId = await seedOrder('takeaway');
      await enqueueKitchenJob(ctx.db!, {
        orderId,
        tenantId: TENANT_ID,
        orderNo: 3,
        tableCodeSnapshot: null,
        areaNameSnapshot: null,
        waiterUserId: null,
        itemIds: await itemIdsOf(orderId),
      });
      expect(await kindsFor(orderId)).toEqual(['grill', 'kitchen']);

      // Sonradan TEK bir ızgara kalemi eklenir (fırın tarafı değişmez).
      const newItemId = randomUUID();
      await ctx
        .db!.insertInto('order_items')
        .values({
          id: newItemId,
          tenant_id: TENANT_ID,
          order_id: orderId,
          product_id: grillProduct,
          product_name: 'Adana Şiş',
          category_name_snapshot: 'IZGARA-test',
          quantity: 1,
          unit_price_cents: 20000,
          total_cents: 20000,
          status: 'sent',
        })
        .execute();

      await enqueueKitchenJob(ctx.db!, {
        orderId,
        tenantId: TENANT_ID,
        orderNo: 3,
        tableCodeSnapshot: null,
        areaNameSnapshot: null,
        waiterUserId: null,
        itemIds: [newItemId],
      });

      // Fix'siz: ['grill','grill','kitchen','kitchen'] (fırın ikinci kez basar).
      expect(await kindsFor(orderId)).toEqual(['grill', 'grill', 'kitchen']);
    });

    // ── ADR-032 Amd3 K4/K6 — kasa paket fişi ──────────────────────────────
    it('paket fişi kind=bill + meta.variant=packing ile kuyruğa girer', async () => {
      const orderId = await seedOrder('takeaway');
      const ok = await enqueuePackingJob(ctx.db!, {
        orderId,
        tenantId: TENANT_ID,
        actorUserId: null,
      });
      expect(ok).toBe(true);

      const rows = await ctx.db!
        .selectFrom('print_jobs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      const packing = rows
        .map((r) => r.payload as {
          kind: string;
          meta?: { orderId?: string; variant?: string; itemCount?: number };
        })
        .filter((p) => p.meta?.orderId === orderId && p.meta?.variant === 'packing');

      expect(packing).toHaveLength(1);
      // Kasa agent'ı `jobKinds:['bill']` claim ediyor — yeni enum YOK (K4).
      expect(packing[0]?.kind).toBe('bill');
      expect(packing[0]?.meta?.itemCount).toBe(2);
    });

    it('paket fişi meta PII taşımaz (ADR-024)', async () => {
      const orderId = await seedOrder('takeaway');
      await enqueuePackingJob(ctx.db!, {
        orderId,
        tenantId: TENANT_ID,
        actorUserId: null,
      });
      const rows = await ctx.db!
        .selectFrom('print_jobs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      const meta = rows
        .map((r) => r.payload as { meta?: Record<string, unknown> })
        .filter((p) => p.meta?.['orderId'] === orderId && p.meta?.['variant'] === 'packing')[0]?.meta;

      // Müşteri adı/telefon/adres YALNIZ bytesBase64 içinde olmalı.
      expect(JSON.stringify(meta)).not.toContain('Test Müşteri');
      expect(Object.keys(meta ?? {}).sort()).toEqual([
        'actorUserId',
        'itemCount',
        'orderId',
        'orderNo',
        'renderedAt',
        'totalCents',
        'variant',
      ]);
    });

    it('sipariş anında adres seçilmemişse KAYITLI adres basılır', async () => {
      // Canlı bulgu: `delivery_address_snapshot` yalnız `customerAddressId`
      // geçildiyse doluyor; kasiyer adres seçmeden paket girince fişte adres
      // satırı hiç çıkmıyordu ve kurye adressiz kâğıtla yola çıkıyordu.
      await ctx.db!
        .insertInto('customer_addresses')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          customer_id: customerId,
          title: 'Ev',
          address_line: 'Test Sokak No 1',
          neighborhood: 'Merkez',
          district: 'Şarköy',
          is_default: true,
        })
        .execute();

      const orderId = await seedOrder('takeaway'); // snapshot NULL
      expect(
        await enqueuePackingJob(ctx.db!, {
          orderId,
          tenantId: TENANT_ID,
          actorUserId: null,
        }),
      ).toBe(true);

      // Adres fişin İÇİNDE (bytesBase64) — meta'ya girmemeli (ADR-024).
      const rows = await ctx.db!
        .selectFrom('print_jobs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      const job = rows
        .map((r) => r.payload as { bytesBase64: string; meta?: Record<string, unknown> })
        .filter((p) => p.meta?.['orderId'] === orderId && p.meta?.['variant'] === 'packing')[0];
      expect(job).toBeDefined();
      expect(JSON.stringify(job?.meta)).not.toContain('Test Sokak');
      // Raster bitmap → metin okunamaz; kanıt: adressiz render'dan DAHA UZUN.
      expect(job!.bytesBase64.length).toBeGreaterThan(1000);
    });

    it('kalemi olmayan sipariş için paket fişi BASILMAZ (false döner)', async () => {
      const orderId = randomUUID();
      await ctx.db!
        .insertInto('orders')
        .values({
          id: orderId,
          tenant_id: TENANT_ID,
          order_no: ++orderNoSeq,
          store_date: '2026-07-21',
          order_type: 'takeaway',
          status: 'open',
          total_cents: 0,
          customer_id: customerId,
          takeaway_stage: 'preparing',
        })
        .execute();
      expect(
        await enqueuePackingJob(ctx.db!, {
          orderId,
          tenantId: TENANT_ID,
          actorUserId: null,
        }),
      ).toBe(false);
    });

    it('tek istasyona düşen PAKET sipariş TEK job üretir (bölünme regresyonu yok)', async () => {
      const orderId = randomUUID();
      await ctx.db!
        .insertInto('orders')
        .values({
          id: orderId,
          tenant_id: TENANT_ID,
          order_no: ++orderNoSeq,
          store_date: '2026-07-21',
          order_type: 'takeaway',
          status: 'open',
          total_cents: 20000,
          customer_id: customerId,
          takeaway_stage: 'preparing',
        })
        .execute();
      await ctx.db!
        .insertInto('order_items')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          order_id: orderId,
          product_id: kitchenProduct,
          product_name: 'Kıymalı Pide',
          category_name_snapshot: 'PIDELER-test',
          quantity: 1,
          unit_price_cents: 20000,
          total_cents: 20000,
          status: 'sent',
        })
        .execute();

      await enqueueKitchenJob(ctx.db!, {
        orderId,
        tenantId: TENANT_ID,
        orderNo: 3,
        tableCodeSnapshot: null,
        areaNameSnapshot: null,
        waiterUserId: null,
        itemIds: await itemIdsOf(orderId),
      });
      expect(await kindsFor(orderId)).toEqual(['kitchen']);
    });
  },
);
