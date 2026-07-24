import { sql, type Selectable } from 'kysely';
import type { CallLogs } from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';
import type { DbExecutor } from './users.js';

export type CallLogRow = Selectable<CallLogs>;
export type CallLogStatus =
  | 'ringing'
  | 'dismissed'
  | 'opened_order'
  | 'completed';

export interface CreateCallLogParams {
  id: string;
  rawPhone: string | null;
  // ADR-016 §11: caller-id route normalize edilemeyen aramayı (boş string)
  // upstream reddeder; createCallLog'a yalnız geçerli normalized phone gelir.
  normalizedPhone: string;
  customerId: string | null;
  status: CallLogStatus;
  stationUserId: string | null;
}

/** Recent feed satırı — istasyon UI poll/socket reconciliation. */
export interface CallLogWithCustomer extends CallLogRow {
  customer_name: string | null;
  customer_is_blacklisted: boolean | null;
}

export interface CallLogsRepository {
  createCallLog(
    tenantId: string,
    params: CreateCallLogParams,
  ): Promise<CallLogRow>;

  /**
   * Son `withinSeconds` (default 5) içinde aynı normalized_phone için kayıt
   * varsa döner — Caller ID dedupe (modem hatlarda iki kez ringing event
   * tetikleyebilir, tek popup gösterilir).
   */
  findRecentDuplicate(
    tenantId: string,
    normalizedPhone: string,
    withinSeconds?: number,
  ): Promise<CallLogRow | null>;

  /**
   * ADR-016 §11 — istasyon socket'i yeniden bağlanınca kaçırılan popup
   * telafisi (S104): son `withinSeconds` içinde HÂLÂ `ringing` (cevapsız) EN
   * SON çağrı. Dismissed/opened_order olanlar dönmez (kullanıcı zaten gördü);
   * yoksa null.
   */
  findMostRecentRinging(
    tenantId: string,
    withinSeconds: number,
  ): Promise<CallLogRow | null>;

  /** Recent feed (DESC). Optional `since` cursor — istemci son aldığı zaman. */
  listCallLogs(
    tenantId: string,
    limit: number,
    since?: Date,
  ): Promise<CallLogWithCustomer[]>;

  updateCallLogStatus(
    tenantId: string,
    callLogId: string,
    status: CallLogStatus,
    openedOrderId?: string,
  ): Promise<CallLogRow | null>;

  /**
   * KVKK retention cron — TÜM tenant'lar üzerinde işler (global). `received_at
   * < NOW() - INTERVAL 'X days'`. Default 30 gün (ADR-016 §11.5).
   */
  deleteOlderThan(retentionDays?: number): Promise<{ deletedCount: number }>;
}

/**
 * Call logs repository. Tüm "tenant-scoped" sorgular tenant_id WHERE'i alır;
 * `deleteOlderThan` global retention için tenant_id'siz çalışır.
 */
export function createCallLogsRepository(db: DbExecutor): CallLogsRepository {
  return {
    async createCallLog(tenantId, params) {
      try {
        const row = await db
          .insertInto('call_logs')
          .values({
            id: params.id,
            tenant_id: tenantId,
            raw_phone: params.rawPhone,
            normalized_phone: params.normalizedPhone,
            customer_id: params.customerId,
            status: params.status,
            station_user_id: params.stationUserId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return row;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async findRecentDuplicate(tenantId, normalizedPhone, withinSeconds = 5) {
      const row = await db
        .selectFrom('call_logs')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('normalized_phone', '=', normalizedPhone)
        .where(
          'received_at',
          '>=',
          sql<Date>`now() - (${withinSeconds}::int * interval '1 second')`,
        )
        .orderBy('received_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row ?? null;
    },

    async findMostRecentRinging(tenantId, withinSeconds) {
      const row = await db
        .selectFrom('call_logs')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'ringing')
        .where(
          'received_at',
          '>=',
          sql<Date>`now() - (${withinSeconds}::int * interval '1 second')`,
        )
        .orderBy('received_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row ?? null;
    },

    async listCallLogs(tenantId, limit, since) {
      let q = db
        .selectFrom('call_logs as cl')
        .leftJoin('customers as c', (join) =>
          join
            .onRef('c.id', '=', 'cl.customer_id')
            .onRef('c.tenant_id', '=', 'cl.tenant_id'),
        )
        .select([
          'cl.id',
          'cl.tenant_id',
          'cl.raw_phone',
          'cl.normalized_phone',
          'cl.customer_id',
          'cl.status',
          'cl.opened_order_id',
          'cl.station_user_id',
          'cl.received_at',
          'c.full_name as customer_name',
          'c.is_blacklisted as customer_is_blacklisted',
        ])
        .where('cl.tenant_id', '=', tenantId)
        .orderBy('cl.received_at', 'desc')
        .limit(limit);

      if (since !== undefined) {
        q = q.where('cl.received_at', '>', since);
      }

      const rows = await q.execute();
      return rows as CallLogWithCustomer[];
    },

    async updateCallLogStatus(tenantId, callLogId, status, openedOrderId) {
      const patch: Partial<{
        status: CallLogStatus;
        opened_order_id: string | null;
      }> = { status };
      if (openedOrderId !== undefined) {
        patch.opened_order_id = openedOrderId;
      }

      try {
        const row = await db
          .updateTable('call_logs')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .where('id', '=', callLogId)
          .returningAll()
          .executeTakeFirst();
        return row ?? null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'check') {
          throw new RepositoryError(
            'check',
            'CALL_LOG_INVALID_STATUS',
            mapped.detail,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async deleteOlderThan(retentionDays = 30) {
      // Global cron — tenant_id WHERE yok. Tüm tenant'larda eski logları siler.
      const result = await db
        .deleteFrom('call_logs')
        .where(
          'received_at',
          '<',
          sql<Date>`now() - (${retentionDays}::int * interval '1 day')`,
        )
        .executeTakeFirst();
      return { deletedCount: Number(result.numDeletedRows) };
    },
  };
}
