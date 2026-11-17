/**
 * ADR-045 PR-1 — fiş metni ve paket otomatik baskı anahtarı, GERÇEK DB'de.
 *
 * Enqueue'lar uygulamanın kendi rolüyle (`app_tenant`, NOBYPASSRLS) ve
 * `withTenant` içinde koşar — `tenant_settings` force-RLS'lidir (mig 061);
 * context eksikse sorgu hata VERMEZ, satırı görmez ([[feedback_rls_test_harness_app_tenant_role]]).
 * Tohumlama/temizlik süper kullanıcı havuzuyla yapılır.
 *
 * Fişin metni bitmap olduğu için okunamaz; çizilen metin `ReceiptCanvas`
 * çağrıları dinlenerek görülür (bkz. `print/templates/receipt-golden.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTenant, type DB } from '@restoran-pos/db';
import { enqueueBillJob } from '../print/enqueue-bill-job.js';
import { enqueuePackingJob } from '../print/enqueue-packing-job.js';
import { ReceiptCanvas } from '../print/raster/canvas-render.js';
import { logger } from '../logger.js';
import { createAppTenantPool } from './helpers/appTenantPool';

const DB_URL = process.env['DATABASE_URL'];
const TENANT_ID = randomUUID();
const ACTOR = null;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  appPool: Pool;
  appDb: Kysely<DB>;
}
const ctx: Partial<TestCtx> = {};
const originalSwitch = process.env['RECEIPT_TEXT_ENABLED'];

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-045 PR-1 — fiş metni + paket otomatik baskı anahtarı (gerçek DB, app_tenant)',
  () => {
    let customerId: string;
    let orderNoSeq = 700;

    beforeAll(async () => {
      ctx.pool = new Pool({ connectionString: DB_URL });
      ctx.db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: ctx.pool }) });
      ctx.appPool = createAppTenantPool(DB_URL ?? '');
      ctx.appDb = new Kysely<DB>({ dialect: new PostgresDialect({ pool: ctx.appPool }) });

      await ctx.db
        .insertInto('tenants')
        .values({ id: TENANT_ID, name: 'Fiş Metni Test', slug: `receipt-text-${TENANT_ID.slice(0, 8)}` })
        .execute();
      await ctx.db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID, timezone: 'Europe/Istanbul' })
        .execute();
      customerId = randomUUID();
      await ctx.db
        .insertInto('customers')
        .values({ id: customerId, tenant_id: TENANT_ID, full_name: 'Test Müşteri' })
        .execute();
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('customers').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
      await ctx.appDb?.destroy();
    });

    beforeEach(async () => {
      // Her test bugünkü duruma döner: metin NULL, anahtar açık.
      await ctx.db!
        .updateTable('tenant_settings')
        .set({ receipt_header_lines: null, receipt_footer_lines: null, packing_auto_print_enabled: true })
        .where('tenant_id', '=', TENANT_ID)
        .execute();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (originalSwitch === undefined) delete process.env['RECEIPT_TEXT_ENABLED'];
      else process.env['RECEIPT_TEXT_ENABLED'] = originalSwitch;
    });

    async function seedOrder(orderType: 'dine_in' | 'takeaway'): Promise<string> {
      const orderId = randomUUID();
      await ctx.db!
        .insertInto('orders')
        .values({
          id: orderId,
          tenant_id: TENANT_ID,
          order_no: ++orderNoSeq,
          store_date: '2026-11-17',
          order_type: orderType,
          status: 'open',
          total_cents: 20000,
          customer_id: customerId,
          ...(orderType === 'takeaway' ? { takeaway_stage: 'preparing' as const } : {}),
        })
        .execute();
      await ctx.db!
        .insertInto('order_items')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          order_id: orderId,
          product_name: 'Kıymalı Pide',
          category_name_snapshot: 'PIDELER',
          quantity: 1,
          unit_price_cents: 20000,
          total_cents: 20000,
          status: 'sent',
        })
        .execute();
      return orderId;
    }

    async function jobsFor(orderId: string): Promise<number> {
      const rows = await ctx.db!
        .selectFrom('print_jobs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      return rows.filter(
        (r) => (r.payload as { meta?: { orderId?: string } }).meta?.orderId === orderId,
      ).length;
    }

    function captureCentered(): string[] {
      const texts: string[] = [];
      const original = ReceiptCanvas.prototype.centered;
      vi.spyOn(ReceiptCanvas.prototype, 'centered').mockImplementation(function (
        this: ReceiptCanvas,
        text: string,
        opts: { size: number; bold?: boolean },
      ) {
        texts.push(text);
        return original.call(this, text, opts);
      });
      return texts;
    }

    async function setSettings(values: {
      receipt_header_lines?: string[] | null;
      receipt_footer_lines?: string[] | null;
      packing_auto_print_enabled?: boolean;
    }): Promise<void> {
      await ctx.db!.updateTable('tenant_settings').set(values).where('tenant_id', '=', TENANT_ID).execute();
    }

    it('harness gerçekten app_tenant rolüyle koşuyor (sessiz-0 tuzağına karşı)', async () => {
      const who = await withTenant(ctx.appDb!, TENANT_ID, (trx) =>
        sql<{ current_user: string }>`select current_user`.execute(trx),
      );
      expect(who.rows[0]?.current_user).toBe('app_tenant');
    });

    it('kasa fişi: işletmenin üst ve alt satırları withTenant altında okunup basılır', async () => {
      await setSettings({
        receipt_header_lines: ['Tel: 0212 555 44 33'],
        receipt_footer_lines: ['Yine bekleriz'],
      });
      const orderId = await seedOrder('dine_in');
      const texts = captureCentered();

      const ok = await withTenant(ctx.appDb!, TENANT_ID, (trx) =>
        enqueueBillJob(trx, { orderId, tenantId: TENANT_ID, actorUserId: 'test' }),
      );

      expect(ok).toBe(true);
      expect(await jobsFor(orderId)).toBe(1);
      expect(texts[0]).toBe('Fiş Metni Test');
      expect(texts[1]).toBe('Tel: 0212 555 44 33');
      expect(texts.at(-1)).toBe('Yine bekleriz');
      expect(texts).not.toContain('Afiyet olsun');
    });

    it('kolonlar NULL → kasa fişi bugünkü gibi (gömülü kapanış)', async () => {
      const orderId = await seedOrder('dine_in');
      const texts = captureCentered();
      await withTenant(ctx.appDb!, TENANT_ID, (trx) =>
        enqueueBillJob(trx, { orderId, tenantId: TENANT_ID, actorUserId: 'test' }),
      );
      expect(texts.slice(-2)).toEqual(['Afiyet olsun', 'Teşekkür ederiz']);
    });

    it('🔴 withTenant SÖKÜLÜRSE app_tenant hiçbir şey göremez → fiş yazılmaz (context şart)', async () => {
      await setSettings({ receipt_header_lines: ['Tel: 0212 555 44 33'] });
      const orderId = await seedOrder('dine_in');
      const ok = await enqueueBillJob(ctx.appDb!, {
        orderId,
        tenantId: TENANT_ID,
        actorUserId: 'test',
      });
      expect(ok).toBe(false);
      expect(await jobsFor(orderId)).toBe(0);
    });

    it('🔴 FAIL-OPEN: elle SQL ile bozulmuş metin → fiş YİNE basılır (varsayılanla) + logger.error', async () => {
      await setSettings({ receipt_header_lines: ['kötü\u001b@'] });
      const orderId = await seedOrder('dine_in');
      const err = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
      const texts = captureCentered();

      const ok = await withTenant(ctx.appDb!, TENANT_ID, (trx) =>
        enqueueBillJob(trx, { orderId, tenantId: TENANT_ID, actorUserId: 'test' }),
      );

      expect(ok).toBe(true);
      expect(await jobsFor(orderId)).toBe(1);
      expect(texts.slice(-2)).toEqual(['Afiyet olsun', 'Teşekkür ederiz']);
      expect(err).toHaveBeenCalledWith(
        { tenantId: TENANT_ID, counter: 'receipt_text.invalid' },
        expect.any(String),
      );
    });

    describe('paket fişi otomatik baskı anahtarı (K5)', () => {
      it('anahtar AÇIK (varsayılan) → otomatik paket fişi basılır', async () => {
        const orderId = await seedOrder('takeaway');
        await withTenant(ctx.appDb!, TENANT_ID, (trx) =>
          enqueuePackingJob(trx, { orderId, tenantId: TENANT_ID, actorUserId: ACTOR, trigger: 'auto' }),
        );
        expect(await jobsFor(orderId)).toBe(1);
      });

      it('🔴 anahtar KAPALI → otomatik paket fişi YAZILMAZ + sayaç log\'u, dönüş true', async () => {
        await setSettings({ packing_auto_print_enabled: false });
        const orderId = await seedOrder('takeaway');
        const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined as never);

        const ok = await withTenant(ctx.appDb!, TENANT_ID, (trx) =>
          enqueuePackingJob(trx, { orderId, tenantId: TENANT_ID, actorUserId: ACTOR, trigger: 'auto' }),
        );

        expect(ok).toBe(true);
        expect(await jobsFor(orderId)).toBe(0);
        expect(info).toHaveBeenCalledWith(
          { tenantId: TENANT_ID, orderId, counter: 'packing_receipt.auto_suppressed' },
          expect.any(String),
        );
      });

      it('🔴 anahtar KAPALI iken "Yazdır" (manual) YİNE basar', async () => {
        await setSettings({ packing_auto_print_enabled: false });
        const orderId = await seedOrder('takeaway');
        const ok = await withTenant(ctx.appDb!, TENANT_ID, (trx) =>
          enqueuePackingJob(trx, { orderId, tenantId: TENANT_ID, actorUserId: ACTOR, trigger: 'manual' }),
        );
        expect(ok).toBe(true);
        expect(await jobsFor(orderId)).toBe(1);
      });

      it('kill-switch kapalı (RECEIPT_TEXT_ENABLED=false) → anahtar yok sayılır, otomatik basar', async () => {
        await setSettings({ packing_auto_print_enabled: false });
        process.env['RECEIPT_TEXT_ENABLED'] = 'false';
        const orderId = await seedOrder('takeaway');
        await withTenant(ctx.appDb!, TENANT_ID, (trx) =>
          enqueuePackingJob(trx, { orderId, tenantId: TENANT_ID, actorUserId: ACTOR, trigger: 'auto' }),
        );
        expect(await jobsFor(orderId)).toBe(1);
      });

      it('anahtar kasa fişini ETKİLEMEZ (kasa fişi hep basılır, K12-3)', async () => {
        await setSettings({ packing_auto_print_enabled: false });
        const orderId = await seedOrder('dine_in');
        await withTenant(ctx.appDb!, TENANT_ID, (trx) =>
          enqueueBillJob(trx, { orderId, tenantId: TENANT_ID, actorUserId: 'test' }),
        );
        expect(await jobsFor(orderId)).toBe(1);
      });

      it('paket fişi de işletme metnini basar', async () => {
        await setSettings({ receipt_header_lines: ['Tel: 0212 555 44 33'] });
        const orderId = await seedOrder('takeaway');
        const texts = captureCentered();
        await withTenant(ctx.appDb!, TENANT_ID, (trx) =>
          enqueuePackingJob(trx, { orderId, tenantId: TENANT_ID, actorUserId: ACTOR, trigger: 'auto' }),
        );
        expect(texts.slice(0, 3)).toEqual(['Fiş Metni Test', 'Tel: 0212 555 44 33', 'PAKET SİPARİŞ']);
      });
    });
  },
);
