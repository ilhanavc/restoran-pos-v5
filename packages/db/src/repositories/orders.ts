import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { DB, Orders, OrderItems, OrderStatus, OrderType } from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';

export type OrderRow = Selectable<Orders>;
export type OrderItemRow = Selectable<OrderItems>;

export interface CreateOrderParams {
  id: string;
  tableId: string | null;
  orderType: OrderType;
  note?: string | null;
  customerId?: string | null;
  storeDate: Date;
  waiterUserId?: string | null;
}

/**
 * order_items insert payload — handler katmanında products repo + categories
 * lookup ile snapshot resolve edilip repo'ya **hazır** olarak verilir.
 * Repo iş kuralı bilmez (price hesabı, vat_rate vs. handler/service sorumluluğu).
 *
 * `id` her satır için pre-generated UUID. `totalCents` = unit_price_cents × qty
 * (UI'dan değil server hesabından gelmeli — ADR-013 §2 snapshot kuralı).
 */
export interface OrderItemSnapshot {
  id: string;
  productId: string | null;
  productName: string;
  categoryNameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  totalCents: number;
  note?: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
}

export interface OrderListFilters {
  status?: OrderStatus;
  tableId?: string;
  storeDate?: Date;
  orderType?: OrderType;
  /**
   * ABAC waiter scope filter (ADR-008 §1/§2). Repo role-agnostic; karar
   * route handler'da verilir. SQL three-valued logic gereği `=` operatörü
   * NULL `waiter_user_id` satırları otomatik dışlar.
   */
  waiterUserId?: string;
}

export interface OrderWithItems {
  order: OrderRow;
  items: OrderItemRow[];
}

export interface OrdersRepository {
  /**
   * Atomic order create — items array verilirse aynı transaction'da
   * order + order_items insert + orders.total_cents recalc (ADR-013 §1).
   * items boş/yok ise header-only insert (PR-1 davranışı geriye uyumluluk).
   */
  create(
    tenantId: string,
    params: CreateOrderParams,
    items?: OrderItemSnapshot[],
  ): Promise<OrderRow>;
  /**
   * Mevcut siparişe kalem ekleme — atomik transaction.
   * order.status closed/cancelled ise reddeder (handler 409).
   */
  addItems(
    tenantId: string,
    orderId: string,
    items: OrderItemSnapshot[],
  ): Promise<OrderWithItems>;
  findMany(tenantId: string, filters?: OrderListFilters): Promise<OrderRow[]>;
  findByIdWithItems(
    tenantId: string,
    orderId: string,
  ): Promise<OrderWithItems | null>;
}

/**
 * Bu repo SADECE `Kysely<DB>` alır (Transaction<DB> değil), çünkü tüm
 * mutation metodları `db.transaction().execute(...)` çağırıyor —
 * Transaction<DB> üzerinde `.transaction()` yasak. Caller-owned transaction
 * pattern'ine geçiş ayrı ADR + PR.
 */
export function createOrdersRepository(db: Kysely<DB>): OrdersRepository {
  /**
   * INSERT order_items batch + orders.total_cents recalc — ortak yardımcı.
   * Caller (create / addItems) zaten transaction context'i sağlar (trx).
   * Boş items dizisi no-op döner.
   */
  async function insertItemsAndRecalc(
    trx: Transaction<DB>,
    tenantId: string,
    orderId: string,
    items: OrderItemSnapshot[],
  ): Promise<void> {
    if (items.length === 0) return;

    await trx
      .insertInto('order_items')
      .values(
        items.map((it) => ({
          id: it.id,
          tenant_id: tenantId,
          order_id: orderId,
          product_id: it.productId,
          product_name: it.productName,
          category_name_snapshot: it.categoryNameSnapshot,
          unit_price_cents: it.unitPriceCents,
          quantity: it.quantity,
          total_cents: it.totalCents,
          note: it.note ?? null,
          created_by_user_id: it.createdByUserId,
          created_by_name: it.createdByName,
        })),
      )
      .execute();

    // orders.total_cents = SUM(order_items.total_cents WHERE order_id = $1)
    // Tek UPDATE ile recalc — race-free (transaction içinde).
    await trx
      .updateTable('orders')
      .set({
        total_cents: sql<number>`(SELECT COALESCE(SUM(total_cents), 0)
                                   FROM order_items
                                   WHERE order_id = ${orderId}
                                     AND tenant_id = ${tenantId})`,
        updated_at: new Date(),
      })
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  return {
    /**
     * storeDate: caller UTC midnight hesaplar (Date(UTC(y,m,d))).
     * items? verilirse aynı transaction'da nested insert.
     */
    async create(tenantId, params, items = []) {
      return db.transaction().execute(async (trx) => {
        // dine_in için masa rezervasyon kontrolü
        if (params.orderType === 'dine_in' && params.tableId !== null) {
          const existing = await trx
            .selectFrom('orders')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('table_id', '=', params.tableId)
            .where('status', 'not in', ['paid', 'cancelled', 'void'])
            .executeTakeFirst();
          if (existing !== undefined) {
            throw new RepositoryError('unique', 'TABLE_ALREADY_OCCUPIED');
          }
        }

        // Atomik order_no counter
        const counter = await trx
          .insertInto('order_no_counters')
          .values({
            tenant_id: tenantId,
            business_date: params.storeDate,
            last_no: 1,
          })
          .onConflict((oc) =>
            oc
              .columns(['tenant_id', 'business_date'])
              .doUpdateSet({
                last_no: sql<number>`order_no_counters.last_no + 1`,
              }),
          )
          .returning('last_no')
          .executeTakeFirstOrThrow();

        let inserted: OrderRow;
        try {
          inserted = await trx
            .insertInto('orders')
            .values({
              id: params.id,
              tenant_id: tenantId,
              table_id: params.tableId,
              order_type: params.orderType,
              order_no: counter.last_no,
              store_date: params.storeDate,
              customer_id: params.customerId ?? null,
              note: params.note ?? null,
              waiter_user_id: params.waiterUserId ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        } catch (err) {
          const mapped = mapPgError(err);
          if (mapped?.cause === 'check') {
            throw new RepositoryError('check', 'ORDER_INVARIANT_VIOLATED', mapped.detail);
          }
          if (mapped?.cause === 'foreign_key') {
            const detail = mapped.detail ?? '';
            if (detail.includes('table_id')) {
              throw new RepositoryError('foreign_key', 'TABLE_NOT_FOUND', mapped.detail);
            }
            if (detail.includes('customer_id')) {
              throw new RepositoryError('foreign_key', 'CUSTOMER_NOT_FOUND', mapped.detail);
            }
            throw err;
          }
          if (mapped !== null) throw mapped;
          throw err;
        }

        // Nested items insert + total_cents recalc
        if (items.length > 0) {
          await insertItemsAndRecalc(trx, tenantId, inserted.id, items);
          // Recalc sonrası taze order satırını döndür (total_cents güncel olsun).
          const refreshed = await trx
            .selectFrom('orders')
            .selectAll()
            .where('id', '=', inserted.id)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirstOrThrow();
          return refreshed;
        }

        return inserted;
      });
    },

    async addItems(tenantId, orderId, items) {
      return db.transaction().execute(async (trx) => {
        const order = await trx
          .selectFrom('orders')
          .selectAll()
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        if (order === undefined) {
          throw new RepositoryError('not_found', 'ORDER_NOT_FOUND');
        }
        // Closed/cancelled siparişe kalem eklenemez (ADR-013 §6 + v3 paritesi).
        if (
          order.status === 'paid' ||
          order.status === 'cancelled' ||
          order.status === 'void'
        ) {
          throw new RepositoryError('check', 'ORDER_INVARIANT_VIOLATED', `status=${order.status}`);
        }

        await insertItemsAndRecalc(trx, tenantId, orderId, items);

        const refreshed = await trx
          .selectFrom('orders')
          .selectAll()
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirstOrThrow();

        const itemRows = await trx
          .selectFrom('order_items')
          .selectAll()
          .where('order_id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .orderBy('created_at', 'asc')
          .execute();

        return { order: refreshed, items: itemRows };
      });
    },

    async findMany(tenantId, filters = {}) {
      let query = db
        .selectFrom('orders')
        .selectAll()
        .where('tenant_id', '=', tenantId);

      if (filters.status !== undefined) {
        query = query.where('status', '=', filters.status);
      }
      if (filters.tableId !== undefined) {
        query = query.where('table_id', '=', filters.tableId);
      }
      if (filters.storeDate !== undefined) {
        query = query.where('store_date', '=', filters.storeDate);
      }
      if (filters.orderType !== undefined) {
        query = query.where('order_type', '=', filters.orderType);
      }
      if (filters.waiterUserId !== undefined) {
        query = query.where('waiter_user_id', '=', filters.waiterUserId);
      }

      return query.orderBy('created_at', 'desc').limit(500).execute();
    },

    async findByIdWithItems(tenantId, orderId) {
      const order = await db
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (order === undefined) return null;

      const items = await db
        .selectFrom('order_items')
        .selectAll()
        .where('order_id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .orderBy('created_at', 'asc')
        .execute();

      return { order, items };
    },
  };
}
