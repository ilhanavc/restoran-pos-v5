import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { createOrdersRepository } from '@restoran-pos/db';
import { computeDailyCloseAggregate } from '../routes/reports/daily-close-aggregate';

/**
 * ADR-015 Amendment 5 (R7-TZ-12 + R7-TZ-13) — gün-sınırı regresyon kilidi.
 *
 * R7-TZ-12: daily-close (Z) penceresi `orders.store_date` tek-kaynak; gece
 * yarısından sonra ödenen adisyonun ödemesi SİPARİŞİNİN iş-gününe düşer →
 * `SUM(revenue) == SUM(paymentBreakdown)` invariantı gün-sınırında korunur.
 * Fix'siz-kırmızı kanıtı: fix stash'lenirse (a) motor eski `startUtc/endUtc`
 * imzasına döner (bu suite derlenmez = kırmızı), (b) eski davranışta 23:50
 * siparişi gelire girer ama 00:10 ödemesi dökümde YOKTUR (invariant kırık).
 *
 * R7-TZ-13: `order_no_counters.business_date` artık tx-içi SQL
 * `store_date(now(),0,tz)` — satırın trigger-hesapladığı `store_date` ile
 * yapısal aynı an. Ekstrem-TZ tenant'ları (UTC+14 / UTC-12) herhangi bir koşum
 * anında en az birinde yerel-gün ≠ UTC-gün garantiler → UTC'ye kaçan bir
 * regresyon deterministik yakalanır.
 *
 * Koşum: yalnız lokal pos_test (DATABASE_URL yoksa skip).
 */

const DB_URL = process.env['DATABASE_URL'];

const TENANT_TR = randomUUID(); // Europe/Istanbul (UTC+3)
const TENANT_KI = randomUUID(); // Pacific/Kiritimati (UTC+14)
const TENANT_PP = randomUUID(); // Etc/GMT+12 (UTC-12)
const ALL_TENANTS = [TENANT_TR, TENANT_KI, TENANT_PP];

// Sabit geçmiş gün D (Istanbul) — koşum-zamanından bağımsız determinizm.
// D = 2026-07-01. Istanbul UTC+3 (yaz): 23:50 yerel = 20:50Z; ertesi 00:10
// yerel = 21:10Z AYNI UTC günü. Eski pencere [30 Haz 21:00Z, 1 Tem 21:00Z).
// businessDay penceresi STRING alır (gate SQL-TZ-01 — pg Date serializasyonu
// süreç-TZ-bağımlı); Date sabiti yalnız NOT NULL insert doldurması için.
const DAY_D_STR = '2026-07-01';
const DAY_D = new Date(Date.UTC(2026, 6, 1)); // store_date DATE karşılığı
const ORDER_AT_2350_LOCAL = new Date('2026-07-01T20:50:00Z');
const PAYMENT_AT_0010_NEXT_LOCAL = new Date('2026-07-01T21:10:00Z');
const OLD_WINDOW_START = new Date('2026-06-30T21:00:00Z');
const OLD_WINDOW_END = new Date('2026-07-01T21:00:00Z');

const ORDER_TOTAL = 50_000; // 500 TL

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-015 Amd5 — rapor gün-sınırı (R7-TZ-12/13)',
  () => {
    let pool: Pool;
    let db: Kysely<DB>;

    beforeAll(async () => {
      pool = createPool({ connectionString: DB_URL! });
      db = createKysely(pool);

      const tzOf: Record<string, string> = {
        [TENANT_TR]: 'Europe/Istanbul',
        [TENANT_KI]: 'Pacific/Kiritimati',
        [TENANT_PP]: 'Etc/GMT+12',
      };
      for (const tid of ALL_TENANTS) {
        await db
          .insertInto('tenants')
          .values({
            id: tid,
            name: `tz-test-${tid.slice(0, 8)}`,
            slug: `tz-test-${tid.slice(0, 8)}`,
          })
          .execute();
        await db
          .insertInto('tenant_settings')
          .values({ tenant_id: tid, timezone: tzOf[tid]! })
          .execute();
      }

      // R7-TZ-12 seed (TENANT_TR): D günü 23:50'de açılıp ödenen, ödemesi
      // ertesi yerel-gün 00:10'a düşen adisyon. created_at explicit INSERT —
      // trigger store_date'i created_at'ten hesaplar (append-only guard
      // UPDATE'i engeller, INSERT serbest).
      const orderId = randomUUID();
      await db
        .insertInto('orders')
        .values({
          id: orderId,
          tenant_id: TENANT_TR,
          table_id: null,
          order_type: 'dine_in',
          status: 'paid',
          order_no: 9001,
          store_date: DAY_D, // trigger override eder; NOT NULL tatmini
          total_cents: ORDER_TOTAL,
          created_at: ORDER_AT_2350_LOCAL,
        })
        .execute();
      await db
        .insertInto('payments')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_TR,
          order_id: orderId,
          payment_type: 'cash',
          payment_scope: 'full',
          amount_cents: ORDER_TOTAL,
          cash_received_cents: ORDER_TOTAL,
          change_amount_cents: 0,
          created_at: PAYMENT_AT_0010_NEXT_LOCAL,
          created_by_user_id: null,
          idempotency_key: randomUUID(),
        })
        .execute();
    });

    afterAll(async () => {
      for (const tid of ALL_TENANTS) {
        await db.deleteFrom('payments').where('tenant_id', '=', tid).execute();
        await db
          .deleteFrom('order_items')
          .where('tenant_id', '=', tid)
          .execute();
        await db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
        await db
          .deleteFrom('order_no_counters')
          .where('tenant_id', '=', tid)
          .execute();
        await db
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', tid)
          .execute();
        await db.deleteFrom('tenants').where('id', '=', tid).execute();
      }
      await pool.end();
    });

    // ── R7-TZ-12 ────────────────────────────────────────────────────────────
    it('Z-raporu (businessDay): gece-yarısı-sarkan ödeme siparişinin gününe düşer — SUM(revenue)==SUM(payments)', async () => {
      const agg = await computeDailyCloseAggregate({
        db,
        tenantId: TENANT_TR,
        tz: 'Europe/Istanbul',
        window: { kind: 'businessDay', date: DAY_D_STR },
      });

      expect(agg.totalRevenueCents).toBe(ORDER_TOTAL);
      const paymentSum = agg.paymentBreakdown.reduce(
        (s, r) => s + r.amountCents,
        0,
      );
      // Amd5 K1 invariantı — fix öncesi eski davranış: gelir 50000, döküm 0.
      expect(paymentSum).toBe(agg.totalRevenueCents);
      // Ödeme yerel 00:10'da → K5: D gününün hour=0 kovasında görünür.
      const hour0 = agg.hourlyBuckets.find((b) => b.hour === 0);
      expect(hour0?.revenueCents).toBe(ORDER_TOTAL);
    });

    it('X-raporu (timeRange): zaman-kesiti semantiği DEĞİŞMEDİ — pencere-dışı ödeme dökümde yok (Amd5 K2)', async () => {
      const agg = await computeDailyCloseAggregate({
        db,
        tenantId: TENANT_TR,
        tz: 'Europe/Istanbul',
        window: {
          kind: 'timeRange',
          startUtc: OLD_WINDOW_START,
          endUtc: OLD_WINDOW_END,
        },
      });
      // Sipariş kesit içinde (gelire girer), ödeme kesit dışında (dökümde yok):
      // X-raporunun "şu ana kadar" doğası — bilinçli, belgelenmiş davranış.
      expect(agg.totalRevenueCents).toBe(ORDER_TOTAL);
      const paymentSum = agg.paymentBreakdown.reduce(
        (s, r) => s + r.amountCents,
        0,
      );
      expect(paymentSum).toBe(0);
    });

    // ── R7-TZ-13 ────────────────────────────────────────────────────────────
    it.each([
      ['Pacific/Kiritimati (UTC+14)', TENANT_KI],
      ['Etc/GMT+12 (UTC-12)', TENANT_PP],
    ])(
      'order_no sayacı satırın store_date\'iyle aynı güne yazar — %s',
      async (_label, tenantId) => {
        const repo = createOrdersRepository(db);
        const created = await repo.create(tenantId, {
          id: randomUUID(),
          tableId: null,
          orderType: 'dine_in',
        });

        // Satırın trigger-hesapladığı iş-günü:
        const row = await db
          .selectFrom('orders')
          .select(['store_date', 'order_no'])
          .where('id', '=', created.id)
          .executeTakeFirstOrThrow();

        // Sayaç TAM o güne yazılmış olmalı (Amd5 K3 tek-kaynak):
        const counters = await db
          .selectFrom('order_no_counters')
          .select(['business_date', 'last_no'])
          .where('tenant_id', '=', tenantId)
          .execute();
        expect(counters).toHaveLength(1);
        expect(new Date(counters[0]!.business_date).toISOString()).toBe(
          new Date(row.store_date).toISOString(),
        );
        expect(counters[0]!.last_no).toBe(row.order_no);

        // Çapraz doğrulama: DB'nin kendi store_date(now(),0,tz) hesabı da aynı
        // günü vermeli (UTC'ye kaçan regresyon ekstrem TZ'de anında kırmızı).
        const tzRow = await db
          .selectFrom('tenant_settings')
          .select(['timezone'])
          .where('tenant_id', '=', tenantId)
          .executeTakeFirstOrThrow();
        const sqlDay = await db
          .selectNoFrom((eb) =>
            eb
              .fn<Date>('store_date', [
                sql`now()`,
                sql`0::smallint`,
                sql`${tzRow.timezone}::text`,
              ])
              .as('d'),
          )
          .executeTakeFirstOrThrow();
        expect(new Date(row.store_date).toISOString()).toBe(
          new Date(sqlDay.d as unknown as Date).toISOString(),
        );
      },
    );

    it('aynı iş-gününde ikinci sipariş sayacı artırır (order_no ardışık)', async () => {
      const repo = createOrdersRepository(db);
      const second = await repo.create(TENANT_KI, {
        id: randomUUID(),
        tableId: null,
        orderType: 'dine_in',
      });
      const row = await db
        .selectFrom('orders')
        .select(['order_no'])
        .where('id', '=', second.id)
        .executeTakeFirstOrThrow();
      expect(row.order_no).toBe(2);
    });
  },
);
