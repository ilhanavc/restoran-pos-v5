import { sql, type Kysely, type Selectable } from 'kysely';
import type {
  DB,
  Payments,
  PaymentScope,
  PaymentType,
} from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';
import { canCloseOrder } from '@restoran-pos/shared-domain';

export type PaymentRow = Selectable<Payments>;

export interface PaymentItemAllocation {
  orderItemId: string;
  quantity: number;
}

export interface CreatePaymentParams {
  id: string;
  orderId: string;
  paymentType: PaymentType;
  paymentScope: PaymentScope;
  amountCents: number;
  idempotencyKey: string;
  createdByUserId: string;
  /** payment_items junction (yalnız scope='item'). ADR-014 §9 Karar 9.4
   *  partial-qty allocations: aynı order_item_id N satırda olabilir,
   *  SUM(quantity) per item ≤ order_items.quantity. */
  itemAllocations?: PaymentItemAllocation[];
  /** ADR-014 Karar 6 — *_close ise atomik order status='paid' transition. */
  closeOrder?: boolean;
  /** ADR-014 §10 Karar 10.5 — Migration 024 yeni alanlar. */
  cashReceivedCents?: number;
  payerNo?: number;
  payerLabel?: string;
  note?: string;
  /** ADR-014 §11 Karar 11.3 — bahşiş Migration 025. */
  tipAmountCents?: number;
}

export interface PaymentsRepository {
  /**
   * Atomik ödeme akışı — ADR-014 §4 idempotency + §6 close transition.
   *
   * Akış:
   *   1. SELECT mevcut idempotency_key → varsa return (replay safety)
   *   2. SELECT order FOR UPDATE — terminal status reddi (paid/cancelled/void)
   *   3. INSERT payments
   *   4. (scope='item') INSERT payment_items batch — comped item DB trigger reddeder
   *   5. (closeOrder) UPDATE orders SET status='paid', closed_at=now()
   *
   * Hatalar (RepositoryError):
   *   - 'not_found' ORDER_NOT_FOUND
   *   - 'check' ORDER_INVARIANT_VIOLATED — closed/cancelled/void order
   *   - 'check' COMP_ITEM_IN_PAYMENT — DB trigger
   *   - 'foreign_key' ORDER_ITEM_NOT_FOUND — orderItemIds tenant/order eşleşmiyor
   */
  create(tenantId: string, params: CreatePaymentParams): Promise<PaymentRow>;

  /** Idempotency lookup — handler aynı key 2. kez geldiğinde replay döner. */
  findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<PaymentRow | null>;

  /** Sipariş için tüm payments — partial scope toplam takibi UI için. */
  findByOrderId(tenantId: string, orderId: string): Promise<PaymentRow[]>;
}

export function createPaymentsRepository(db: Kysely<DB>): PaymentsRepository {
  return {
    async findByIdempotencyKey(tenantId, idempotencyKey) {
      const row = await db
        .selectFrom('payments')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('idempotency_key', '=', idempotencyKey)
        .executeTakeFirst();
      return (row ?? null) as PaymentRow | null;
    },

    async findByOrderId(tenantId, orderId) {
      const rows = await db
        .selectFrom('payments')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('order_id', '=', orderId)
        .orderBy('created_at', 'asc')
        .execute();
      return rows as PaymentRow[];
    },

    async create(tenantId, params) {
      return db.transaction().execute(async (trx) => {
        // 1. Idempotency replay — transaction içinde tekrar kontrol
        const existing = await trx
          .selectFrom('payments')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('idempotency_key', '=', params.idempotencyKey)
          .executeTakeFirst();
        if (existing !== undefined) {
          return existing as PaymentRow;
        }

        // 2. Order lock + invariant
        const order = await trx
          .selectFrom('orders')
          .select(['id', 'status', 'tenant_id', 'total_cents', 'is_fully_comped'])
          .where('id', '=', params.orderId)
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

        // 3. INSERT payments
        let inserted: PaymentRow;
        try {
          // §10.5 — change auto-calc (cash mode'da)
          const cashReceived =
            params.paymentType === 'cash'
              ? (params.cashReceivedCents ?? params.amountCents)
              : null;
          const changeAmount =
            cashReceived !== null
              ? Math.max(0, cashReceived - params.amountCents)
              : null;

          inserted = (await trx
            .insertInto('payments')
            .values({
              id: params.id,
              tenant_id: tenantId,
              order_id: params.orderId,
              payment_type: params.paymentType,
              payment_scope: params.paymentScope,
              amount_cents: params.amountCents,
              idempotency_key: params.idempotencyKey,
              created_by_user_id: params.createdByUserId,
              payer_no: params.payerNo ?? null,
              payer_label: params.payerLabel ?? null,
              cash_received_cents: cashReceived,
              change_amount_cents: changeAmount,
              tip_amount_cents: params.tipAmountCents ?? null,
              note: params.note ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow()) as PaymentRow;
        } catch (err) {
          const mapped = mapPgError(err);
          if (mapped?.cause === 'unique') {
            // Idempotency race — paralel iki request: replay safety. Yeniden çek.
            const replay = await trx
              .selectFrom('payments')
              .selectAll()
              .where('tenant_id', '=', tenantId)
              .where('idempotency_key', '=', params.idempotencyKey)
              .executeTakeFirstOrThrow();
            return replay as PaymentRow;
          }
          if (mapped !== null) throw mapped;
          throw err;
        }

        // 4. payment_items (scope='item') — partial-qty allocations
        if (
          params.paymentScope === 'item' &&
          params.itemAllocations !== undefined &&
          params.itemAllocations.length > 0
        ) {
          // 4a. Order_items snapshot — unit_price + quantity için
          const itemIds = [
            ...new Set(params.itemAllocations.map((a) => a.orderItemId)),
          ];
          const orderItems = await trx
            .selectFrom('order_items')
            .select(['id', 'quantity', 'unit_price_cents'])
            .where('tenant_id', '=', tenantId)
            .where('order_id', '=', params.orderId)
            .where('id', 'in', itemIds)
            .execute();
          if (orderItems.length !== itemIds.length) {
            throw new RepositoryError(
              'foreign_key',
              'ORDER_ITEM_NOT_FOUND',
              'order_item_ids contain invalid id(s) for this order',
            );
          }
          const itemMap = new Map(orderItems.map((it) => [it.id, it]));

          // 4b. Cross-row qty validation: SUM(existing + new) ≤ order_items.quantity
          const existing = await trx
            .selectFrom('payment_items')
            .select(['order_item_id', 'quantity'])
            .where('tenant_id', '=', tenantId)
            .where('order_item_id', 'in', itemIds)
            .execute();
          const existingByItem = new Map<string, number>();
          for (const e of existing) {
            existingByItem.set(
              e.order_item_id,
              (existingByItem.get(e.order_item_id) ?? 0) + e.quantity,
            );
          }
          const newByItem = new Map<string, number>();
          for (const a of params.itemAllocations) {
            newByItem.set(
              a.orderItemId,
              (newByItem.get(a.orderItemId) ?? 0) + a.quantity,
            );
          }
          for (const [itemId, addQty] of newByItem.entries()) {
            const oi = itemMap.get(itemId)!;
            const totalAfter = (existingByItem.get(itemId) ?? 0) + addQty;
            if (totalAfter > oi.quantity) {
              throw new RepositoryError(
                'check',
                'PAYMENT_QTY_EXCEEDS_ORDER_ITEM',
                `order_item_id=${itemId} total_alloc=${totalAfter} > order_qty=${oi.quantity}`,
              );
            }
          }

          // 4c. INSERT batch (Migration 024 payer_no/label denormalize)
          try {
            await trx
              .insertInto('payment_items')
              .values(
                params.itemAllocations.map((a) => {
                  const oi = itemMap.get(a.orderItemId)!;
                  return {
                    payment_id: inserted.id,
                    order_item_id: a.orderItemId,
                    tenant_id: tenantId,
                    quantity: a.quantity,
                    unit_price_cents_snapshot: oi.unit_price_cents,
                    line_total_cents: a.quantity * oi.unit_price_cents,
                    payer_no: params.payerNo ?? null,
                    payer_label: params.payerLabel ?? null,
                  };
                }),
              )
              .execute();
          } catch (err) {
            const mapped = mapPgError(err);
            if (mapped?.cause === 'check') {
              // DB trigger payment_items_block_comped_insert (§10.5.2 C1)
              throw new RepositoryError(
                'check',
                'COMP_ITEM_IN_PAYMENT',
                mapped.detail,
              );
            }
            if (mapped !== null) throw mapped;
            throw err;
          }
        }

        // 5. Atomik close (operation=*_close)
        if (params.closeOrder === true) {
          // ADR-014 §12 — close invariant: SUM(payments.amount_cents) === payable.
          // total_cents zaten comped/cancelled kalemleri dışlar (= net payable,
          // ADR-013 §9.3 — ayrı comped_amount_cents kolonu yok). canCloseOrder
          // underpaid (<) ve overpaid (>) ikisini de reddeder; tx içinde, order
          // satırı FOR UPDATE kilitliyken → race-free.
          const paid = await trx
            .selectFrom('payments')
            .select((eb) => [
              eb.fn
                .coalesce(eb.fn.sum<number>('amount_cents'), eb.lit(0))
                .as('paid_total'),
              eb.fn.countAll<number>().as('cnt'),
            ])
            .where('tenant_id', '=', tenantId)
            .where('order_id', '=', params.orderId)
            .executeTakeFirstOrThrow();
          const closeCheck = canCloseOrder({
            isFullyComped: order.is_fully_comped,
            payableCents: order.total_cents,
            paymentsTotalCents: Number(paid.paid_total ?? 0),
            paymentsCount: Number(paid.cnt ?? 0),
          });
          if (!closeCheck.ok) {
            const code =
              closeCheck.reason === 'underpaid'
                ? 'PAYMENT_INSUFFICIENT_FOR_CLOSE'
                : closeCheck.reason === 'overpaid'
                  ? 'PAYMENT_EXCEEDS_TOTAL'
                  : 'ORDER_INVARIANT_VIOLATED';
            throw new RepositoryError(
              'check',
              code,
              `reason=${closeCheck.reason} paid=${Number(paid.paid_total ?? 0)} payable=${order.total_cents}`,
            );
          }

          await trx
            .updateTable('orders')
            .set({
              status: 'paid',
              updated_at: sql`now()`,
            })
            .where('id', '=', params.orderId)
            .where('tenant_id', '=', tenantId)
            .execute();
        }

        return inserted;
      });
    },
  };
}
