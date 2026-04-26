import { sql, type Kysely, type Selectable } from 'kysely';
import type { DB, Orders, OrderStatus, OrderType } from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';

export type OrderRow = Selectable<Orders>;

export interface CreateOrderParams {
  id: string;
  tableId: string | null;
  orderType: OrderType;
  note?: string | null;
  customerId?: string | null;
  storeDate: Date;
}

export interface OrderListFilters {
  status?: OrderStatus;
  tableId?: string;
  storeDate?: Date;
  orderType?: OrderType;
}

export interface OrdersRepository {
  create(tenantId: string, params: CreateOrderParams): Promise<OrderRow>;
  findMany(tenantId: string, filters?: OrderListFilters): Promise<OrderRow[]>;
}

export function createOrdersRepository(db: Kysely<DB>): OrdersRepository {
  return {
    /**
     * storeDate: Çağıran (route handler) UTC midnight olarak hesaplayıp geçirmeli.
     * Örnek: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
     */
    async create(tenantId, params) {
      return db.transaction().execute(async (trx) => {
        // dine_in için masa rezervasyon kontrolü (transaction içinde)
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

        // Atomik order_no counter — INSERT ... ON CONFLICT DO UPDATE
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

        try {
          return await trx
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
      });
    },

    /**
     * Filtreli sipariş listesi. Tenant-scoped + DESC sıra + 500 hard cap.
     * MVP: pagination yok; default storeDate filtresi route handler'da uygulanır.
     */
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

      return query.orderBy('created_at', 'desc').limit(500).execute();
    },
  };
}
