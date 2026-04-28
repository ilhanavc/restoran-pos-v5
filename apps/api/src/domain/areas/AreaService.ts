import type { Kysely } from 'kysely';
import {
  createAreasRepository,
  type DB,
  type AreaRow,
} from '@restoran-pos/db';
import { writeAudit } from '../../audit/writeAudit.js';
import { AuthError, AUTH_MESSAGE_KEYS } from '../../errors.js';

/**
 * ADR-009 Domain service (authoritative pattern, ADR-003 §10.2.3).
 *
 * Soft delete davranışı (Karar 5): areas soft delete'inde tables.area_id
 * referansları **otomatik NULL'a düşer**. FK `ON DELETE SET NULL` soft
 * delete'te tetiklenmez; service tek transaction içinde manuel UPDATE yapar.
 * Trigger gereksiz; tek-yol service.
 *
 * Atomicity (ADR-002 §10.4 + §10.7):
 *   1. SELECT target areas (tenant-scoped) — yok/cross-tenant → 404 AREA_NOT_FOUND
 *   2. UPDATE areas SET deleted_at = now()
 *   3. UPDATE tables SET area_id = NULL WHERE area_id = $1 AND deleted_at IS NULL
 *   4. INSERT audit_logs (area.deleted, tables_unlinked_count) — AYNI transaction
 *
 * Areas için aktif tables guard (Görev 19/20 paterni) **uygulanmaz** — Karar 5
 * cascade NULL doğru davranış: bölge silindi diye masa silinmez.
 */
export class AreaService {
  constructor(private readonly db: Kysely<DB>) {}

  /**
   * Tek transaction içinde soft delete + cascade NULL + audit. Cross-tenant /
   * bilinmeyen id → AuthError(404 AREA_NOT_FOUND). `actorUserId` audit yazımı
   * için zorunlu (handler request'ten geçirir).
   */
  async softDelete(params: {
    tenantId: string;
    areaId: string;
    actorUserId: string;
  }): Promise<void> {
    const { tenantId, areaId, actorUserId } = params;

    await this.db.transaction().execute(async (trx) => {
      const repo = createAreasRepository(trx);
      const target: AreaRow | null = await repo.findById(tenantId, areaId);
      if (target === null) {
        throw new AuthError(
          'AREA_NOT_FOUND',
          AUTH_MESSAGE_KEYS['AREA_NOT_FOUND'] ?? 'error.internal',
          404,
        );
      }

      // 1. Soft delete bölgenin kendisi
      await repo.softDelete(tenantId, areaId);

      // 2. Karar 5 cascade NULL — aktif tables.area_id referansları
      const unlinkedCount = await repo.unlinkTablesFromArea(tenantId, areaId);

      // 3. Audit (whitelist 'area.deleted': area_id, soft_delete,
      //    tables_unlinked_count). Bölge adı snapshot kuralı (§7) gereği
      //    serbest metin payload'a yazılmaz.
      await writeAudit(trx, {
        tenantId,
        eventType: 'area.deleted',
        actorUserId,
        entityType: 'area',
        entityId: areaId,
        rawPayload: {
          area_id: areaId,
          soft_delete: true,
          tables_unlinked_count: unlinkedCount,
        },
      });
    });
  }
}
