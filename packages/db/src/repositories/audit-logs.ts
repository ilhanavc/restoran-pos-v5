import type { DbExecutor } from './users.js';

/**
 * ADR-037 — `audit_logs` **salt-okuma** repository'si.
 *
 * Yazma yolu `apps/api/src/audit/writeAudit.ts`'tedir ve bu ADR ona
 * DOKUNMAZ (K10). Burada migration/index eklenmez; sorgular §14.3.B
 * "three-index lock" ile hizalıdır:
 *   - tarih penceresi          → `(tenant_id, created_at DESC)`
 *   - tek `eventType`          → `(tenant_id, event_type, created_at DESC)`
 *   - `entityType`+`entityId`  → `(tenant_id, entity_type, entity_id)`
 */

/** Repository dönüş satırı (snake_case DB → camelCase map route'ta yapılır). */
export interface AuditLogRow {
  id: string;
  created_at: Date;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_user_id: string | null;
  actor_username: string | null;
  actor_role: string | null;
  payload: unknown;
}

/** Keyset cursor konumu — `(created_at, id)` bileşik anahtarı (K2). */
export interface AuditLogCursor {
  createdAt: Date;
  id: string;
}

export interface AuditLogFilters {
  /** Alt sınır (dahil). Varsayılan pencere route katmanında hesaplanır (K4). */
  from?: Date;
  /** Üst sınır (dahil). */
  to?: Date;
  /** Bir veya daha çok olay türü; boş dizi filtre uygulanmaması demek DEĞİL. */
  eventTypes?: string[];
  /** `entityId` ile birlikte zorunlu (index leading kolonu). */
  entityType?: string;
  entityId?: string;
  /** Index'siz, pencere-içi süzgeç (K3 — 4. index bilinçli olarak açılmadı). */
  actorUserId?: string;
  /** Keyset konumu; verilmezse ilk sayfa. */
  cursor?: AuditLogCursor;
}

export interface AuditLogsRepository {
  /**
   * `ORDER BY created_at DESC, id DESC` sabittir. `limit` kadar satır
   * istenirse çağıran `limit + 1` geçer ve fazladan satırın varlığından
   * `hasMore` üretir (K2).
   *
   * `tenantId` **daima** parametreden gelir (JWT); `tenant_id IS NULL` yetim
   * satırlar eşitlik yüklemi gereği hiçbir zaman dönmez.
   */
  listAuditLogs(
    tenantId: string,
    filters: AuditLogFilters,
    limit: number,
  ): Promise<AuditLogRow[]>;
}

export function createAuditLogsRepository(db: DbExecutor): AuditLogsRepository {
  return {
    async listAuditLogs(tenantId, filters, limit) {
      let q = db
        .selectFrom('audit_logs as al')
        .leftJoin('users as u', 'u.id', 'al.actor_user_id')
        .select([
          'al.id',
          'al.created_at',
          'al.event_type',
          'al.entity_type',
          'al.entity_id',
          'al.actor_user_id',
          'u.username as actor_username',
          'u.role as actor_role',
          'al.payload',
        ])
        .where('al.tenant_id', '=', tenantId);

      if (filters.from !== undefined) {
        q = q.where('al.created_at', '>=', filters.from);
      }
      if (filters.to !== undefined) {
        q = q.where('al.created_at', '<=', filters.to);
      }
      if (filters.eventTypes !== undefined && filters.eventTypes.length > 0) {
        q =
          filters.eventTypes.length === 1
            ? q.where('al.event_type', '=', filters.eventTypes[0]!)
            : q.where('al.event_type', 'in', filters.eventTypes);
      }
      if (filters.entityType !== undefined) {
        q = q.where('al.entity_type', '=', filters.entityType);
      }
      if (filters.entityId !== undefined) {
        q = q.where('al.entity_id', '=', filters.entityId);
      }
      if (filters.actorUserId !== undefined) {
        q = q.where('al.actor_user_id', '=', filters.actorUserId);
      }

      if (filters.cursor !== undefined) {
        // (created_at, id) < (c.createdAt, c.id) — satır-değer karşılaştırması
        // Kysely'de doğrudan yok; eşdeğer OR açılımı aynı index'i sürer.
        const cursor = filters.cursor;
        q = q.where((eb) =>
          eb.or([
            eb('al.created_at', '<', cursor.createdAt),
            eb.and([
              eb('al.created_at', '=', cursor.createdAt),
              eb('al.id', '<', cursor.id),
            ]),
          ]),
        );
      }

      const rows = await q
        .orderBy('al.created_at', 'desc')
        .orderBy('al.id', 'desc')
        .limit(limit)
        .execute();

      return rows as AuditLogRow[];
    },
  };
}
