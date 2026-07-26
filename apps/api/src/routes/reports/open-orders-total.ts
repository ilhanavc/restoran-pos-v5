import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { OpenOrdersTotalResponseSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';

/**
 * ADR-026 Amendment 5 K6 — GET /reports/kpi/open-orders-total
 *
 * Açık adisyonların KALAN tutarı: `Σ max(0, orders.total_cents − Σ aktif
 * payments.amount_cents)` over `orders WHERE tenant_id=? AND status='open'`.
 *
 * Semantik kaynağı (yeniden icat EDİLMEDİ): masa kartı / web dashboard
 * "Masalarda Tahsil Edilecek" göstergesiyle birebir aynı —
 * `packages/db/src/repositories/tables.ts` `order_payments` subquery'si
 * (`voided_at IS NULL` + `GROUP BY order_id`) + `shared-domain` `openTabTotalCents`
 * (`Σ max(0, total − paid)`). Fark yalnız KAPSAM: burada masa projeksiyonu
 * yerine doğrudan `orders` taranır → **paket (takeaway) siparişler de dahildir**
 * (`order_type` filtresi YOK — K6). Web KPI'sına DOKUNULMAZ (taşıma v5.1).
 *
 * Void'lenmiş ödeme kalanı azaltmaz (ADR-033): iptal edilen ödeme kalanı geri
 * büyütür, tahsil edilmiş sayılmaz.
 *
 * `status='open'` — K6 birebir. KDS (`kds.ts`) ve `GET /orders?status=open` ile
 * aynı küme; `merged`/`cancelled`/`paid` terminal statüler doğal olarak dışarıda.
 *
 * Pencere parametresi YOK: bu bir "şu an" göstergesidir (ADR-015 range ailesinin
 * üyesi DEĞİL). Aynı sebeple `?format=csv` de desteklenmez — anlık bir sayının
 * dosya export'u anlamsızdır (mevcut rapor CSV'leri pencere-bağlıdır).
 *
 * RBAC: `authorize(['admin','cashier'])` — reports ailesi politikası
 * (`reports.read`) ve Amd5 K1 "Satış sekmesi" rol matrisi ile aynı.
 */
export function openOrdersTotalRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/kpi/open-orders-total',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;

        const row = await deps.db
          .selectFrom('orders')
          // Sipariş başına AKTİF ödeme toplamı (void'ler hariç). LEFT JOIN →
          // hiç ödeme almamış sipariş NULL döner, COALESCE ile 0'a iner.
          .leftJoin(
            (eb) =>
              eb
                .selectFrom('payments')
                .select((s) => [
                  'payments.order_id as order_id',
                  s.fn
                    .sum<number>('payments.amount_cents')
                    .as('paid_total_cents'),
                ])
                .where('payments.tenant_id', '=', tenantId)
                // ADR-033 SUM fan-out kuralı — void'lenmiş ödeme sayılmaz.
                .where('payments.voided_at', 'is', null)
                .groupBy('payments.order_id')
                .as('order_payments'),
            (join) => join.onRef('order_payments.order_id', '=', 'orders.id'),
          )
          .select((eb) => [
            // GREATEST(..., 0) = `Math.max(0, total − paid)` clamp'i (openTabTotalCents
            // paritesi). Fazla tahsilat ADR-014 Amd3 ile artık oluşamaz, ama
            // gösterge savunmalı kalır. `::int` → PG numeric/bigint → JS number.
            sql<number>`COALESCE(SUM(GREATEST(orders.total_cents - COALESCE(order_payments.paid_total_cents, 0), 0)), 0)::int`.as(
              'open_total',
            ),
            eb.fn.countAll<number>().as('open_orders'),
          ])
          .where('orders.tenant_id', '=', tenantId)
          .where('orders.status', '=', 'open')
          .executeTakeFirstOrThrow();

        const data = OpenOrdersTotalResponseSchema.parse({
          openTotalCents: Number(row.open_total),
          openOrderCount: Number(row.open_orders),
          asOf: new Date().toISOString(),
        });

        res.status(200).json({ data });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
