import { sql, type Kysely } from 'kysely';
import type { DB } from '../generated.js';
import type { DbExecutor } from './users.js';
import { mapPgError, RepositoryError } from '../errors.js';
import { TERMINAL_ORDER_STATUSES } from './order-status.js';

/**
 * Türetilmiş masa durumu. `tables` tablosunda `status` kolonu yok —
 * açık siparişi olan masa = 'occupied', diğerleri = 'available'.
 */
export type DerivedTableStatus = 'available' | 'occupied';

export interface TableWithStatus {
  id: string;
  tenant_id: string;
  code: string;
  capacity: number | null;
  area_id: string | null;
  /**
   * Kalıcı per-bölge görüntü numarası (ADR-009 Amendment 2026-06-30 Karar A).
   * NULL = bölgesiz (orphan) → etiket ham `code`'a düşer. Silme/sync ile KAYMAZ.
   */
  display_no: number | null;
  status: DerivedTableStatus;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** Aktif siparişin id'si (var ise) — derived occupied state için. */
  active_order_id: string | null;
  /** Aktif siparişin total_cents değeri (recalc-edilmiş, comp/cancel hariç). */
  active_order_total_cents: number | null;
  /** ADR-014 §11 — kısmi ödeme yapıldıysa SUM(payments.amount_cents). */
  active_order_paid_total_cents: number | null;
  /** Aktif siparişin created_at'i — TableCard süre hesabı için. */
  active_order_started_at: Date | null;
  /** Garson kullanıcı adı (aktif siparişin waiter_user_id → users.username). */
  active_waiter_name: string | null;
}

export interface CreateTableParams {
  id: string;
  code: string;
  capacity?: number | null;
}

export interface UpdateTableParams {
  code?: string;
  capacity?: number | null;
}

export interface TablesRepository {
  findAll(tenantId: string): Promise<TableWithStatus[]>;
  findById(tenantId: string, id: string): Promise<TableWithStatus | null>;
  findByStatus(
    tenantId: string,
    status: DerivedTableStatus,
  ): Promise<TableWithStatus[]>;
  create(tenantId: string, params: CreateTableParams): Promise<TableWithStatus>;
  /** Partial update; en az bir alan dolu olmalı (handler'da garanti edilir). */
  update(
    tenantId: string,
    id: string,
    params: UpdateTableParams,
  ): Promise<TableWithStatus | null>;
  /**
   * Hard delete (Session 53b — ADR-003 + ADR-009 Amendment 2026-05-05).
   * `DELETE FROM tables WHERE tenant_id = $1 AND id = $2`. Tenant-scoped,
   * idempotent (yoksa 0 satır siler). Veri korunması: `orders.table_id`
   * `ON DELETE SET NULL` (Migration 030) + `orders.table_code_snapshot` /
   * `area_name_snapshot` snapshot kolonları geçmiş raporu korur.
   *
   * Caller (DELETE handler) önce `hasActiveOrders` ile aktif sipariş guard'ını
   * çalıştırır; varsa 409 ORDER_INVARIANT_VIOLATED döner — silme atlanır.
   */
  hardDelete(tenantId: string, id: string): Promise<void>;
  /**
   * DELETE guard (Sprint 4 Görev 19 Seçenek A): masa açık (open) bir siparişe
   * bağlıysa silinemez. ADR-003 §14.2.B `NOT IN ('paid','cancelled')` semantiği
   * şu an repository içindeki literal `status='open'` kuralıyla uyumlu —
   * Görev 12+ orders semantiği netleştiğinde tek noktadan güncellenir.
   */
  hasActiveOrders(tenantId: string, id: string): Promise<boolean>;
  /**
   * Sprint 5 Görev 23 — `PATCH /tables/:id/area` (ADR-009). Composite FK
   * `(area_id, tenant_id) → areas (id, tenant_id)` tenant scope'u DB seviyesinde
   * de zorlar; handler `areaId !== null` ise önce areas.findById ile var olduğunu
   * doğrular (404 AREA_NOT_FOUND erken). `areaId = null` → unassign (bölgeden çıkar).
   * Hiçbir satır eşleşmezse `null` döner — handler 404 TABLE_NOT_FOUND fırlatır.
   */
  updateAreaId(
    tenantId: string,
    id: string,
    areaId: string | null,
  ): Promise<TableWithStatus | null>;

  /**
   * Sprint 8c PR-C — POST /areas/:id/sync-tables (ADR-009 Amendment 2026-04-30).
   * Bu bölgedeki aktif (deleted_at IS NULL) masaları derived status ile birlikte
   * döner. Sıralama indirgemede (sort by code numeric desc) handler tarafında
   * yapılır.
   */
  findByAreaId(tenantId: string, areaId: string): Promise<TableWithStatus[]>;

  /**
   * Tenant'taki tüm aktif masalar arasında numerik code'ların maksimumunu döner.
   * Non-numerik kodlar görmezden gelinir. Hiç numerik kod yoksa 0 döner.
   * Sync artışında otomatik kod ataması için kullanılır.
   */
  findMaxCodeNumber(tenantId: string): Promise<number>;

  /**
   * Toplu INSERT — sync artışı için. Tek INSERT INTO ... VALUES (...),(...)
   * çağrısı. capacity NULL atanır. Boş dizi no-op.
   */
  createMany(
    tenantId: string,
    rows: { id: string; code: string; areaId: string }[],
  ): Promise<void>;

  /**
   * Toplu hard delete — sync azaltması için (ADR-009 sync-tables Amendment).
   * Tenant-scoped; boş dizi no-op. Session 53b ile soft → hard.
   */
  hardDeleteMany(tenantId: string, ids: string[]): Promise<void>;
}

/**
 * Tables repository. Status `orders.status='open'` JOIN'i ile türetilir.
 * Açık sipariş tanımı: status NOT IN ('paid','cancelled') §14.2.B ile uyumlu
 * olmasa da bu repo şimdilik literal 'open' kullanır — Görev 12+ siparişlere
 * geçildiğinde semantiği netleştir.
 *
 * Transaction-aware: `db` parametresi `Kysely<DB>` veya `Transaction<DB>` olabilir.
 * `softDelete + hasActiveOrders + writeAudit` çağrıları DELETE handler'ında
 * tek transaction içinde çağrılır (ADR-002 §10.4 atomicity kontratı).
 */
export function createTablesRepository(db: DbExecutor): TablesRepository {
  /**
   * baseQuery — masa list/detail için tek query yapısı.
   *
   * Aktif sipariş subquery'si: ADR-013 §1+§9.1 aktif statusler =
   * NOT IN TERMINAL_ORDER_STATUSES ('paid','cancelled','void','merged';
   * ADR-029 `merged` kaynak masayı DOLU göstermemeli). Bir masada en fazla 1 aktif
   * sipariş olabilir (DB invariant); subquery `DISTINCT ON (table_id)`
   * yerine sade SELECT yeterli, ama defansif olarak ORDER BY created_at DESC
   * + LIMIT 1 yerine sub-aggregation kullanmıyoruz çünkü 1-N invariant
   * already ensured. LEFT JOIN sonrası max 1 satır.
   *
   * users left join: waiter_user_id NULL ise (eski kayıt) waiter_name NULL
   * döner (ON DELETE SET NULL ADR-002 §10.10 paritesi).
   */
  function baseQuery(tenantId: string) {
    return db
      .selectFrom('tables')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('orders')
            .select((s) => [
              'orders.id as id',
              'orders.table_id as table_id',
              'orders.total_cents as total_cents',
              'orders.created_at as created_at',
              'orders.waiter_user_id as waiter_user_id',
              sql<DerivedTableStatus>`'occupied'`.as('derived_status'),
            ])
            .where('orders.tenant_id', '=', tenantId)
            .where('orders.status', 'not in', [...TERMINAL_ORDER_STATUSES])
            .as('active_orders'),
        (join) => join.onRef('active_orders.table_id', '=', 'tables.id'),
      )
      // ADR-014 §11 — active order için ödenen toplam (v3 paritesi:
      // order_paid_total). payments.amount_cents SUM. Masa kartında kısmi
      // ödeme "₺2.100,00 / ₺350,00" yeşil slash gösterimi için projection.
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('payments')
            .select((s) => [
              'payments.order_id as order_id',
              s.fn.sum<number>('payments.amount_cents').as('paid_total_cents'),
            ])
            .where('payments.tenant_id', '=', tenantId)
            // ADR-033 SUM fan-out — masa kartı kısmi-ödeme toplamı void'lenmiş
            // ödemeyi SAYMAZ (aksi halde "₺X / ₺Y" bayat gösterir).
            .where('payments.voided_at', 'is', null)
            .groupBy('payments.order_id')
            .as('order_payments'),
        (join) => join.onRef('order_payments.order_id', '=', 'active_orders.id'),
      )
      .leftJoin(
        'users',
        (join) =>
          join
            .onRef('users.id', '=', 'active_orders.waiter_user_id')
            .onRef('users.tenant_id', '=', 'tables.tenant_id'),
      )
      .select([
        'tables.id',
        'tables.tenant_id',
        'tables.code',
        'tables.capacity',
        'tables.area_id',
        'tables.display_no',
        'tables.deleted_at',
        'tables.created_at',
        'tables.updated_at',
        sql<DerivedTableStatus>`COALESCE(active_orders.derived_status, 'available')`.as(
          'status',
        ),
        sql<string | null>`active_orders.id`.as('active_order_id'),
        sql<number | null>`active_orders.total_cents`.as(
          'active_order_total_cents',
        ),
        sql<number | null>`COALESCE(order_payments.paid_total_cents, 0)::int`.as(
          'active_order_paid_total_cents',
        ),
        sql<Date | null>`active_orders.created_at`.as('active_order_started_at'),
        sql<string | null>`users.username`.as('active_waiter_name'),
      ])
      .where('tables.tenant_id', '=', tenantId)
      .where('tables.deleted_at', 'is', null);
  }

  /**
   * Bir bölgedeki mevcut MAX(display_no) (deleted_at NULL); yoksa 0. Yeni masa
   * atamada +1 ile kullanılır — gap-preserving (silme sonrası yeniden numaralama
   * YOK; ADR-009 Amendment 2026-06-30 Karar A). findMaxCodeNumber ile aynı
   * non-atomic pattern (tek-tenant düşük trafik; sync yarışı #13 v5.1).
   */
  async function maxDisplayNoInArea(
    tenantId: string,
    areaId: string,
  ): Promise<number> {
    const row = await db
      .selectFrom('tables')
      .select(sql<number>`COALESCE(MAX(display_no), 0)`.as('max_no'))
      .where('tenant_id', '=', tenantId)
      .where('area_id', '=', areaId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(row.max_no);
  }

  return {
    async findAll(tenantId) {
      const rows = await baseQuery(tenantId).execute();
      return rows as TableWithStatus[];
    },

    async findById(tenantId, id) {
      const row = await baseQuery(tenantId)
        .where('tables.id', '=', id)
        .executeTakeFirst();
      return (row ?? null) as TableWithStatus | null;
    },

    async findByStatus(tenantId, status) {
      // GROUP BY yok; HAVING yerine WHERE'in COALESCE üzerinde çalışması için
      // raw SQL fragment kullanıyoruz. Kysely 0.27'de bu en temiz yaklaşım.
      const rows = await baseQuery(tenantId)
        .where(
          sql<DerivedTableStatus>`COALESCE(active_orders.derived_status, 'available')`,
          '=',
          status,
        )
        .execute();
      return rows as TableWithStatus[];
    },

    async create(tenantId, params) {
      try {
        await db
          .insertInto('tables')
          .values({
            id: params.id,
            tenant_id: tenantId,
            code: params.code,
            capacity: params.capacity ?? null,
          })
          .execute();
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError('unique', 'TABLE_ALREADY_EXISTS', mapped.detail);
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
      const row = await baseQuery(tenantId)
        .where('tables.id', '=', params.id)
        .executeTakeFirstOrThrow();
      return row as TableWithStatus;
    },

    async update(tenantId, id, params) {
      const patch: Partial<{ code: string; capacity: number | null }> = {};
      if (params.code !== undefined) patch.code = params.code;
      if (params.capacity !== undefined) patch.capacity = params.capacity;

      try {
        const updated = await db
          .updateTable('tables')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n) return null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError('unique', 'TABLE_ALREADY_EXISTS', mapped.detail);
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
      // Final state'i derived status ile birlikte oku.
      const row = await baseQuery(tenantId)
        .where('tables.id', '=', id)
        .executeTakeFirst();
      return (row ?? null) as TableWithStatus | null;
    },

    async hardDelete(tenantId, id) {
      // Session 53b: hard delete. orders.table_id FK ON DELETE SET NULL
      // (Migration 030) → geçmiş siparişler kaybolmaz, table_id NULL'a düşer
      // ve orders.table_code_snapshot / area_name_snapshot rapor için kalır.
      await db
        .deleteFrom('tables')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .execute();
    },

    async hasActiveOrders(tenantId, id) {
      // ADR-009 Amendment 2026-06-30 Karar B: aktif-sipariş tanımı tek kaynağa
      // hizalandı = baseQuery projection + DB unique index ile birebir
      // `status NOT IN TERMINAL_ORDER_STATUSES` ('paid','cancelled','void','merged';
      // ADR-029 `merged` masayı silinebilir bırakmalı — eski literal 'open' drift'i;
      // sent_to_kitchen/served/billed masalar da artık silinemez). EXISTS: tek
      // satır yeter.
      const row = await db
        .selectFrom('orders')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('table_id', '=', id)
        .where('status', 'not in', [...TERMINAL_ORDER_STATUSES])
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },

    async updateAreaId(tenantId, id, areaId) {
      // ADR-009 Amendment 2026-06-30 Karar A: bölge değişiminde display_no
      // yeniden atanır — yeni bölgede max+1; bölgesiz (unassign, null) →
      // display_no NULL (etiket ham code'a düşer).
      const displayNo =
        areaId === null ? null : (await maxDisplayNoInArea(tenantId, areaId)) + 1;
      // Composite FK violation (area_id, tenant_id) → 23503 foreign_key.
      // Handler genelde önce areas.findById ile guard ediyor, ama defansif
      // catch: cross-tenant area_id veya yarış ile silinmiş area_id durumunda
      // RepositoryError 'foreign_key' fırlatılır → handler AREA_NOT_FOUND'a
      // map edebilir.
      try {
        const updated = await db
          .updateTable('tables')
          .set({ area_id: areaId, display_no: displayNo })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n) return null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
      }
      const row = await baseQuery(tenantId)
        .where('tables.id', '=', id)
        .executeTakeFirst();
      return (row ?? null) as TableWithStatus | null;
    },

    async findByAreaId(tenantId, areaId) {
      const rows = await baseQuery(tenantId)
        .where('tables.area_id', '=', areaId)
        .execute();
      return rows as TableWithStatus[];
    },

    async findMaxCodeNumber(tenantId) {
      const row = await db
        .selectFrom('tables')
        .select(
          sql<number>`COALESCE(MAX(CASE WHEN code ~ '^[0-9]+$' THEN code::int ELSE NULL END), 0)`.as(
            'max_num',
          ),
        )
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      // Postgres MAX over int dönüşü string olabilir; defansif Number().
      return Number(row.max_num);
    },

    async createMany(tenantId, rows) {
      if (rows.length === 0) return;
      // ADR-009 Amendment 2026-06-30 Karar A: yeni masalara bölge-içi display_no
      // ata (max+1, sıralı). Sync tek bölge için çağrılır ama defansif: areaId'ye
      // göre her grupta mevcut max'tan devam et.
      const nextByArea = new Map<string, number>();
      const values: {
        id: string;
        tenant_id: string;
        code: string;
        capacity: null;
        area_id: string;
        display_no: number;
      }[] = [];
      for (const r of rows) {
        let next = nextByArea.get(r.areaId);
        if (next === undefined) {
          next = (await maxDisplayNoInArea(tenantId, r.areaId)) + 1;
        }
        values.push({
          id: r.id,
          tenant_id: tenantId,
          code: r.code,
          capacity: null,
          area_id: r.areaId,
          display_no: next,
        });
        nextByArea.set(r.areaId, next + 1);
      }
      await db.insertInto('tables').values(values).execute();
    },

    async hardDeleteMany(tenantId, ids) {
      if (ids.length === 0) return;
      // Session 53b: sync-tables azaltma akışında batch hard delete.
      await db
        .deleteFrom('tables')
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', ids)
        .execute();
    },
  };
}
