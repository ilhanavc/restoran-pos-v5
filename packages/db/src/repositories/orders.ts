import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type {
  DB,
  Orders,
  OrderItems,
  OrderItemAttributes,
  OrderStatus,
  OrderType,
} from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';

export type OrderRow = Selectable<Orders>;
export type OrderItemAttributeRow = Selectable<OrderItemAttributes>;
/** ADR-013 §10 + §11: persisted satır + nested attribute snapshot. */
export type OrderItemRow = Selectable<OrderItems> & {
  attributes: OrderItemAttributeRow[];
};

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
 * order_item_attributes insert payload — handler/service katmanında DB'den
 * resolve edilip repo'ya hazır olarak verilir (ADR-013 §10 Karar 10.5,
 * Migration 017). `id` pre-generated UUID; FK doğrudan DB'ye yazılır,
 * isim + fiyat snapshot'lar audit izi için (ADR-003 §7).
 */
export interface OrderItemAttributeSnapshot {
  id: string;
  attributeGroupId: string;
  attributeOptionId: string;
  groupNameSnapshot: string;
  optionNameSnapshot: string;
  extraPriceCentsSnapshot: number;
}

/**
 * order_items insert payload — handler katmanında products repo + categories
 * lookup ile snapshot resolve edilip repo'ya **hazır** olarak verilir.
 * Repo iş kuralı bilmez (price hesabı, vat_rate vs. handler/service sorumluluğu).
 *
 * `id` her satır için pre-generated UUID. `totalCents` = unit_price_cents × qty
 * (UI'dan değil server hesabından gelmeli — ADR-013 §2 snapshot kuralı).
 *
 * `attributes` (PR-6 / ADR-013 §10): order_item_attributes nested insert için
 * hazır snapshot listesi; boş array özellik seçilmediği anlamına gelir.
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
  attributes?: OrderItemAttributeSnapshot[];
  /** ADR-013 §11 — porsiyon snapshot (Migration 021). */
  variantIdSnapshot?: string | null;
  variantNameSnapshot?: string | null;
  variantPriceDeltaCentsSnapshot?: number | null;
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

export interface UpdateOrderItemParams {
  note?: string | null;
  /** Yalnız 'cancelled' MVP'de — diğer FSM geçişleri Phase 3. */
  status?: 'cancelled';
  isComped?: boolean;
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
  /**
   * Persisted kalem partial update (ADR-013 §6 + §9.2). Atomik transaction:
   *   1. SELECT item + order JOIN (status kontrolü)
   *   2. UPDATE order_items (note/status/is_comped)
   *   3. status='cancelled' veya is_comped değişimi → orders.total_cents recalc
   *
   * status='cancelled' kalemler total_cents hesabından düşer (`is_comped=true`
   * de aynı mantıkla — comp_amount kolonu yok, ADR-013 §9.3).
   *
   * Hatalar:
   *   - ITEM_NOT_FOUND (handler'da 404)
   *   - ORDER_INVARIANT_VIOLATED (handler'da 409): closed/cancelled order
   */
  updateItem(
    tenantId: string,
    orderId: string,
    itemId: string,
    params: UpdateOrderItemParams,
  ): Promise<OrderWithItems>;
  findMany(tenantId: string, filters?: OrderListFilters): Promise<OrderRow[]>;
  findByIdWithItems(
    tenantId: string,
    orderId: string,
  ): Promise<OrderWithItems | null>;
  /**
   * ADR-014 §9 Karar 9.6 — sipariş iptali (3-nokta menü "Siparişi İptal Et").
   * Atomik transaction:
   *   1. SELECT order FOR UPDATE — terminal status (paid/cancelled/void) reddi
   *   2. UPDATE orders SET status='cancelled', updated_at=now()
   *   3. UPDATE order_items SET status='cancelled' WHERE order_id=? (kalemleri de cancel)
   *   4. orders.total_cents = 0 recalc (tüm kalemler cancelled)
   *
   * NOT: payments yatırılmış sipariş iptal edilirse `paid` status olamaz; bu
   * durumda 409 ORDER_INVARIANT_VIOLATED. Refund akışı v5.1+.
   */
  cancelOrder(
    tenantId: string,
    orderId: string,
  ): Promise<OrderWithItems>;

  /**
   * ADR-014 §10 Karar 10.4 — Mod B "Masayı Kapat" (zaten tamamen ödenmiş
   * sipariş close). Atomik transaction:
   *   1. SELECT order FOR UPDATE — terminal reddi
   *   2. SUM(payments.amount_cents) >= orders.total_cents kontrol
   *      → eksikse PAYMENT_INSUFFICIENT_FOR_CLOSE
   *   3. UPDATE orders SET status='paid', updated_at=now()
   */
  payOrder(tenantId: string, orderId: string): Promise<OrderWithItems>;
}

/**
 * Bu repo SADECE `Kysely<DB>` alır (Transaction<DB> değil), çünkü tüm
 * mutation metodları `db.transaction().execute(...)` çağırıyor —
 * Transaction<DB> üzerinde `.transaction()` yasak. Caller-owned transaction
 * pattern'ine geçiş ayrı ADR + PR.
 */
export function createOrdersRepository(db: Kysely<DB>): OrdersRepository {
  /**
   * order_items + nested order_item_attributes batch fetch (caller'a ait
   * transaction context). findByIdWithItems / addItems / updateItem üç noktada
   * aynı şekilde yapıştırma için helper.
   */
  async function fetchItemsWithAttributes(
    exec: Kysely<DB> | Transaction<DB>,
    tenantId: string,
    orderId: string,
  ): Promise<OrderItemRow[]> {
    const items = await exec
      .selectFrom('order_items')
      .selectAll()
      .where('order_id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .execute();
    if (items.length === 0) return [];
    const itemIds = items.map((i) => i.id);
    const attrRows = await exec
      .selectFrom('order_item_attributes')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('order_item_id', 'in', itemIds)
      .orderBy('created_at', 'asc')
      .execute();
    const attrsByItem = new Map<string, OrderItemAttributeRow[]>();
    for (const a of attrRows) {
      const list = attrsByItem.get(a.order_item_id);
      if (list === undefined)
        attrsByItem.set(a.order_item_id, [a as OrderItemAttributeRow]);
      else list.push(a as OrderItemAttributeRow);
    }
    return items.map((it) => ({
      ...it,
      attributes: attrsByItem.get(it.id) ?? [],
    })) as OrderItemRow[];
  }

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
          variant_id_snapshot: it.variantIdSnapshot ?? null,
          variant_name_snapshot: it.variantNameSnapshot ?? null,
          variant_price_delta_cents_snapshot:
            it.variantPriceDeltaCentsSnapshot ?? null,
        })),
      )
      .execute();

    // PR-6 (ADR-013 §10 Karar 10.5): nested attribute snapshot insert,
    // aynı transaction. Boş özellik listesine sahip kalemler atlanır.
    const attributeRows = items.flatMap((it) =>
      (it.attributes ?? []).map((a) => ({
        id: a.id,
        tenant_id: tenantId,
        order_item_id: it.id,
        attribute_group_id: a.attributeGroupId,
        attribute_option_id: a.attributeOptionId,
        group_name_snapshot: a.groupNameSnapshot,
        option_name_snapshot: a.optionNameSnapshot,
        extra_price_cents_snapshot: a.extraPriceCentsSnapshot,
      })),
    );
    if (attributeRows.length > 0) {
      await trx.insertInto('order_item_attributes').values(attributeRows).execute();
    }

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

        const itemRows = await fetchItemsWithAttributes(trx, tenantId, orderId);

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
      const items = await fetchItemsWithAttributes(db, tenantId, orderId);
      return { order, items };
    },

    async updateItem(tenantId, orderId, itemId, params) {
      return db.transaction().execute(async (trx) => {
        // Order + item lookup (tenant-scoped, cross-tenant 404)
        const order = await trx
          .selectFrom('orders')
          .selectAll()
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        if (order === undefined) {
          throw new RepositoryError('not_found', 'ORDER_NOT_FOUND');
        }
        if (
          order.status === 'paid' ||
          order.status === 'cancelled' ||
          order.status === 'void'
        ) {
          throw new RepositoryError(
            'check',
            'ORDER_INVARIANT_VIOLATED',
            `status=${order.status}`,
          );
        }

        const item = await trx
          .selectFrom('order_items')
          .selectAll()
          .where('id', '=', itemId)
          .where('order_id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        if (item === undefined) {
          throw new RepositoryError('not_found', 'ORDER_ITEM_NOT_FOUND');
        }

        // Partial update — note her zaman güncellenebilir; status='cancelled'
        // yalnız aktif satırda anlamlı; is_comped toggle (handler RBAC).
        const patch: Partial<OrderItemRow> = {};
        if (params.note !== undefined) patch.note = params.note;
        if (params.status !== undefined) patch.status = params.status;
        if (params.isComped !== undefined) patch.is_comped = params.isComped;

        if (Object.keys(patch).length === 0) {
          // Schema empty_body refine yakalamış olmalı; defansif.
          throw new RepositoryError('check', 'ORDER_INVARIANT_VIOLATED', 'empty patch');
        }

        await trx
          .updateTable('order_items')
          .set(patch)
          .where('id', '=', itemId)
          .where('tenant_id', '=', tenantId)
          .execute();

        // total_cents recalc — cancelled/comped item'lar dışlanır.
        // Comp için ayrı `comped_amount_cents` kolonu yok (ADR-013 §9.3 v5.1 backlog);
        // total_cents direkt aktif+ödenecek tutarı yansıtır.
        const needsRecalc =
          params.status !== undefined || params.isComped !== undefined;
        if (needsRecalc) {
          await trx
            .updateTable('orders')
            .set({
              total_cents: sql<number>`(
                SELECT COALESCE(SUM(total_cents), 0)
                FROM order_items
                WHERE order_id = ${orderId}
                  AND tenant_id = ${tenantId}
                  AND status != 'cancelled'
                  AND is_comped = false
              )`,
              updated_at: new Date(),
            })
            .where('id', '=', orderId)
            .where('tenant_id', '=', tenantId)
            .execute();
        }

        const refreshed = await trx
          .selectFrom('orders')
          .selectAll()
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirstOrThrow();

        const itemRows = await fetchItemsWithAttributes(trx, tenantId, orderId);

        return { order: refreshed, items: itemRows };
      });
    },

    async payOrder(tenantId, orderId) {
      return db.transaction().execute(async (trx) => {
        const order = await trx
          .selectFrom('orders')
          .selectAll()
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (order === undefined) {
          throw new RepositoryError('not_found', 'ORDER_NOT_FOUND');
        }
        if (
          order.status === 'paid' ||
          order.status === 'cancelled' ||
          order.status === 'void'
        ) {
          throw new RepositoryError(
            'check',
            'ORDER_INVARIANT_VIOLATED',
            `status=${order.status}`,
          );
        }

        // SUM(payments.amount_cents) kontrolü
        const paid = await trx
          .selectFrom('payments')
          .select((eb) =>
            eb.fn.coalesce(eb.fn.sum<number>('amount_cents'), eb.lit(0)).as(
              'paid_total',
            ),
          )
          .where('tenant_id', '=', tenantId)
          .where('order_id', '=', orderId)
          .executeTakeFirstOrThrow();
        const paidTotal = Number(paid.paid_total ?? 0);
        if (paidTotal < order.total_cents) {
          throw new RepositoryError(
            'check',
            'PAYMENT_INSUFFICIENT_FOR_CLOSE',
            `paid=${paidTotal} required=${order.total_cents}`,
          );
        }

        await trx
          .updateTable('orders')
          .set({ status: 'paid', updated_at: new Date() })
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .execute();

        const refreshed = await trx
          .selectFrom('orders')
          .selectAll()
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirstOrThrow();
        const itemRows = await fetchItemsWithAttributes(trx, tenantId, orderId);
        return { order: refreshed, items: itemRows };
      });
    },

    async cancelOrder(tenantId, orderId) {
      return db.transaction().execute(async (trx) => {
        const order = await trx
          .selectFrom('orders')
          .selectAll()
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (order === undefined) {
          throw new RepositoryError('not_found', 'ORDER_NOT_FOUND');
        }
        if (
          order.status === 'paid' ||
          order.status === 'cancelled' ||
          order.status === 'void'
        ) {
          throw new RepositoryError(
            'check',
            'ORDER_CANCEL_NOT_ALLOWED',
            `status=${order.status}`,
          );
        }

        // Sipariş iptali — order_items hepsi cancelled
        await trx
          .updateTable('order_items')
          .set({ status: 'cancelled' })
          .where('order_id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .where('status', '!=', 'cancelled')
          .execute();

        await trx
          .updateTable('orders')
          .set({
            status: 'cancelled',
            total_cents: 0,
            updated_at: new Date(),
          })
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .execute();

        const refreshed = await trx
          .selectFrom('orders')
          .selectAll()
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirstOrThrow();
        const itemRows = await fetchItemsWithAttributes(trx, tenantId, orderId);
        return { order: refreshed, items: itemRows };
      });
    },
  };
}
