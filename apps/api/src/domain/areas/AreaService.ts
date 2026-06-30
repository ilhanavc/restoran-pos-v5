import type { Kysely } from 'kysely';
import {
  createAreasRepository,
  type DB,
  type AreaRow,
} from '@restoran-pos/db';
import { writeAudit } from '../../audit/writeAudit.js';
import { AuthError, AUTH_MESSAGE_KEYS, domainError } from '../../errors.js';

/**
 * ADR-009 Domain service (authoritative pattern, ADR-003 §10.2.3).
 *
 * Hard delete davranışı (Karar 5 — Session 53b Amendment 2026-05-05):
 * areas hard delete edildiğinde önce tables.area_id referansları **manuel
 * NULL'a düşürülür** (cascade NULL pattern KORUNUR), sonra `DELETE FROM areas`
 * çalıştırılır. Hepsi tek transaction. Trigger gereksiz.
 *
 * Atomicity (ADR-002 §10.4 + §10.7):
 *   1. SELECT target areas (tenant-scoped) — yok/cross-tenant → 404 AREA_NOT_FOUND
 *   2. GUARD: aktif-siparişli masa varsa → 409 AREA_HAS_ACTIVE_TABLES (Karar C(a))
 *   3. UPDATE tables SET area_id = NULL WHERE area_id = $1
 *   4. DELETE FROM areas WHERE id = $1
 *   5. INSERT audit_logs (area.deleted, tables_unlinked_count) — AYNI transaction
 *      (entity_id artık DB'de yok ama forensic kanıt için audit_logs satırı kalır,
 *       ADR-002 §10.7).
 *
 * Aktif-sipariş guard (ADR-009 Amendment 2026-06-30 Karar C(a)): cascade NULL
 * KORUNUR, ancak bölgede aktif-siparişli (Karar B: status NOT IN paid/cancelled/
 * void) masa varsa silme ENGELLENİR (409 AREA_HAS_ACTIVE_TABLES). Aksi halde o
 * masanın açık adisyonu `area_id=NULL`'a düşer ve board orphan filtresinden
 * dolayı tahtadan kaybolurdu (veri kaybı görünümü). Boş masalar yine cascade
 * NULL ile "Bölgesiz" grubuna düşer; admin oradan yeniden atayabilir.
 */
export class AreaService {
  constructor(private readonly db: Kysely<DB>) {}

  /**
   * Tek transaction içinde cascade NULL + hard delete + audit. Cross-tenant /
   * bilinmeyen id → AuthError(404 AREA_NOT_FOUND). `actorUserId` audit yazımı
   * için zorunlu (handler request'ten geçirir).
   */
  async hardDelete(params: {
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

      // 1. Karar C(a) guard — cascade NULL'dan ÖNCE: aktif-siparişli masa
      // varsa silme engellenir (409). Açık adisyonun bölgesiz orphan'a düşüp
      // tahtadan kaybolmasını önler (masa-silme guard'ı ile simetrik).
      const hasActive = await repo.hasActiveOrderTables(tenantId, areaId);
      if (hasActive) {
        throw domainError('AREA_HAS_ACTIVE_TABLES', 409);
      }

      // 2. Karar 5 cascade NULL — bağlı tables.area_id referansları
      // (DELETE öncesinde — sonra olursa FK violation olabilirdi).
      const unlinkedCount = await repo.unlinkTablesFromArea(tenantId, areaId);

      // 3. Hard delete bölgenin kendisi
      await repo.hardDelete(tenantId, areaId);

      // 4. Audit (whitelist 'area.deleted': area_id, tables_unlinked_count —
      //    soft_delete alanı Session 53b ile çıkarıldı). Bölge adı snapshot
      //    kuralı (§7) gereği serbest metin payload'a yazılmaz.
      await writeAudit(trx, {
        tenantId,
        eventType: 'area.deleted',
        actorUserId,
        entityType: 'area',
        entityId: areaId,
        rawPayload: {
          area_id: areaId,
          tables_unlinked_count: unlinkedCount,
        },
      });
    });
  }
}
