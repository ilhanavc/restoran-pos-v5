import { sql, type Kysely, type Selectable } from 'kysely';
import type {
  DB,
  Payments,
  PaymentScope,
  PaymentType,
} from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';

export type PaymentRow = Selectable<Payments>;

export interface CreatePaymentParams {
  id: string;
  orderId: string;
  paymentType: PaymentType;
  paymentScope: PaymentScope;
  amountCents: number;
  idempotencyKey: string;
  createdByUserId: string;
  /** payment_items junction (yalnız scope='item'). */
  orderItemIds?: string[];
  /** ADR-014 Karar 6 — *_close ise atomik order status='paid' transition. */
  closeOrder?: boolean;
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
          .select(['id', 'status', 'tenant_id'])
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

        // 4. payment_items (scope='item')
        if (
          params.paymentScope === 'item' &&
          params.orderItemIds !== undefined &&
          params.orderItemIds.length > 0
        ) {
          // Order_items'in bu siparişe ait olduğunu doğrula
          const validItems = await trx
            .selectFrom('order_items')
            .select(['id'])
            .where('tenant_id', '=', tenantId)
            .where('order_id', '=', params.orderId)
            .where('id', 'in', params.orderItemIds)
            .execute();
          if (validItems.length !== params.orderItemIds.length) {
            throw new RepositoryError(
              'foreign_key',
              'ORDER_ITEM_NOT_FOUND',
              'order_item_ids contain invalid id(s) for this order',
            );
          }
          try {
            await trx
              .insertInto('payment_items')
              .values(
                params.orderItemIds.map((oid) => ({
                  payment_id: inserted.id,
                  order_item_id: oid,
                  tenant_id: tenantId,
                })),
              )
              .execute();
          } catch (err) {
            const mapped = mapPgError(err);
            // DB trigger payment_items_block_comped_insert (§10.5.2 C1)
            if (mapped?.cause === 'check') {
              throw new RepositoryError(
                'check',
                'COMP_ITEM_IN_PAYMENT',
                mapped.detail,
              );
            }
            if (mapped?.cause === 'unique') {
              // order_item zaten başka payment'a bağlı (UNIQUE tenant_id, order_item_id)
              throw new RepositoryError(
                'unique',
                'ORDER_ITEM_ALREADY_PAID',
                mapped.detail,
              );
            }
            if (mapped !== null) throw mapped;
            throw err;
          }
        }

        // 5. Atomik close (operation=*_close)
        if (params.closeOrder === true) {
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
