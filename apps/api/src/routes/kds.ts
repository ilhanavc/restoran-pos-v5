import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { domainError } from '../errors.js';

export interface KdsRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * KDS (Kitchen Display System) endpoints — Sprint 12 PR-2 (ADR-020).
 *
 * RBAC matrix (ADR-020 K7 + permissions.ts `kds.read`):
 *   - GET /kds/orders: admin + kitchen (cashier/waiter 403 noise filter)
 *
 * Routing kuralı (ADR-020 K2): yalnız `categories.kitchen_print=true`
 * kategori altındaki kalemler. İçecek/sıcak içecek (kitchen_print=false)
 * KDS'e düşmez — bar/kasa hattı.
 *
 * State machine (ADR-020 K3, ayrı handler `PATCH /orders/:o/items/:i/status`
 * orders.ts'de): sent → preparing → ready. KDS GET filtresi bu üç status.
 *
 * Sıralama (ADR-020 K4): FIFO — `orders.created_at ASC`. UI'da "en eski sipariş
 * üstte" pattern'i.
 */
export function kdsRouter(deps: KdsRouterDeps): ExpressRouter {
  const router = Router();

  /**
   * GET /kds/orders — aktif (`status='open'`) sipariş + kitchen-routed
   * kalemleri (`order_items.status IN ('sent','preparing','ready')`,
   * `categories.kitchen_print=true`).
   *
   * Response shape:
   *   {
   *     data: {
   *       orders: [
   *         {
   *           id, orderNo, tableId, orderType, takeawayStage,
   *           tableCodeSnapshot, areaNameSnapshot, customerName,
   *           createdAt, items: [
   *             { id, productId, productName, quantity, status,
   *               note, variantNameSnapshot, createdAt }
   *           ]
   *         }
   *       ]
   *     }
   *   }
   *
   * NOT: Yalnız KDS-relevant kalem alanları döner (snapshot fiyatlar,
   * is_comped, vs. KDS işine yaramaz; UI noise azaltır). Kitchen-routed
   * kalemi olmayan order'lar response'tan filtrelenir (örn. tüm kalemler
   * içecek → KDS'e düşmez).
   */
  router.get(
    '/orders',
    authenticate(deps.accessSecret),
    authorize(['admin', 'kitchen']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;

        // 1) Açık siparişleri FIFO al — `status='open'` (paid/cancelled hariç).
        //    `customer_id` LEFT JOIN ile customer.full_name çekilir (takeaway
        //    için UI ipucu); dine_in'de NULL.
        const orders = await deps.db
          .selectFrom('orders')
          .leftJoin('customers', (join) =>
            join
              .onRef('customers.id', '=', 'orders.customer_id')
              .onRef('customers.tenant_id', '=', 'orders.tenant_id'),
          )
          .select([
            'orders.id as id',
            'orders.order_no as order_no',
            'orders.table_id as table_id',
            'orders.order_type as order_type',
            'orders.takeaway_stage as takeaway_stage',
            'orders.table_code_snapshot as table_code_snapshot',
            'orders.area_name_snapshot as area_name_snapshot',
            'orders.created_at as created_at',
            'customers.full_name as customer_name',
          ])
          .where('orders.tenant_id', '=', tenantId)
          .where('orders.status', '=', 'open')
          .orderBy('orders.created_at', 'asc')
          .execute();

        if (orders.length === 0) {
          res.status(200).json({ data: { orders: [] } });
          return;
        }

        // 2) Tüm açık siparişlerin kitchen-routed kalemlerini TEK sorguda batch
        //    fetch et (N+1 önleme). Filter:
        //      - order_id IN (...)
        //      - status IN ('sent','preparing','ready')
        //      - JOIN products → categories.kitchen_print = true
        //    NOT: order_items.product_id NULLABLE (ürün sonradan silinmiş
        //    olabilir, snapshot text korunur). product_id NULL ise category
        //    JOIN'i match etmez → kalem listede görünmez. KDS'te "ne
        //    pişireceğim" sorusu için `kitchen_print` bilinemez bir kalem
        //    güvenli default olarak gizlenir (ürün silindi ise mutfağa zaten
        //    gönderildi, KDS'te durum güncellemesi `PATCH .../status`
        //    üzerinden devam edebilir; ancak kalemin gözükmesi için aktif
        //    product gerekiyor — bu bilinçli tradeoff, ADR-020 K2 dipnotu
        //    "soft-deleted ürünler" için yan kayıt yok, raporlama kapsamı
        //    dışı).
        const orderIds = orders.map((o) => o.id);
        const items = await deps.db
          .selectFrom('order_items')
          .innerJoin('products', (join) =>
            join
              .onRef('products.id', '=', 'order_items.product_id')
              .onRef('products.tenant_id', '=', 'order_items.tenant_id'),
          )
          .innerJoin('categories', (join) =>
            join
              .onRef('categories.id', '=', 'products.category_id')
              .onRef('categories.tenant_id', '=', 'products.tenant_id'),
          )
          .select([
            'order_items.id as id',
            'order_items.order_id as order_id',
            'order_items.product_id as product_id',
            'order_items.product_name as product_name',
            'order_items.quantity as quantity',
            'order_items.status as status',
            'order_items.note as note',
            'order_items.variant_name_snapshot as variant_name_snapshot',
            'order_items.created_at as created_at',
          ])
          .where('order_items.tenant_id', '=', tenantId)
          .where('order_items.order_id', 'in', orderIds)
          .where('order_items.status', 'in', ['sent', 'preparing', 'ready'])
          .where('categories.kitchen_print', '=', true)
          .orderBy('order_items.created_at', 'asc')
          .execute();

        // 3) Items'ı order_id'ye göre grupla.
        const itemsByOrderId = new Map<
          string,
          Array<{
            id: string;
            productId: string | null;
            productName: string;
            quantity: number;
            status: string;
            note: string | null;
            variantNameSnapshot: string | null;
            createdAt: string;
          }>
        >();
        for (const it of items) {
          const list = itemsByOrderId.get(it.order_id) ?? [];
          list.push({
            id: it.id,
            productId: it.product_id,
            productName: it.product_name,
            quantity: it.quantity,
            status: it.status,
            note: it.note,
            variantNameSnapshot: it.variant_name_snapshot,
            createdAt: it.created_at.toISOString(),
          });
          itemsByOrderId.set(it.order_id, list);
        }

        // 4) Hiç kitchen-routed kalemi olmayan order'ları filtrele (örn.
        //    tüm kalemler içecek). KDS noise azaltma.
        const result = orders.flatMap((o) => {
          const orderItems = itemsByOrderId.get(o.id);
          if (orderItems === undefined || orderItems.length === 0) return [];
          return [
            {
              id: o.id,
              orderNo: o.order_no,
              tableId: o.table_id,
              orderType: o.order_type,
              takeawayStage: o.takeaway_stage,
              tableCodeSnapshot: o.table_code_snapshot,
              areaNameSnapshot: o.area_name_snapshot,
              customerName: o.customer_name,
              createdAt: o.created_at.toISOString(),
              items: orderItems,
            },
          ];
        });

        res.status(200).json({ data: { orders: result } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  // Defansive: bilinmeyen path'lerde 404 RESOURCE_NOT_FOUND (errorHandler'a
  // domainError ile düş). Test'ler bu davranışı assert edebilir.
  router.use((_req, _res, next) => {
    return next(domainError('RESOURCE_NOT_FOUND', 404));
  });

  return router;
}
