import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '@restoran-pos/db';
import type { AuditEventType } from '@restoran-pos/shared-types';
import { sanitize, type AllowedPayload } from '@restoran-pos/shared-domain';
import { logger } from '../logger.js';

/**
 * Repository pattern paraleli — writeAudit hem outer `Kysely<DB>` hem de aktif
 * `Transaction<DB>` ile çağrılabilir. ADR-002 §10.4 step 5: domain mutation
 * INSERT'i ile audit INSERT'i AYNI BEGIN..COMMIT bloğunda olmalı, aksi halde
 * COMMIT sonrası audit yazımı patlarsa "kim yaptı kanıtı yok" — §10.7 ihlali.
 */
export type AuditExecutor = Kysely<DB> | Transaction<DB>;

export interface WriteAuditParams<T extends AuditEventType> {
  tenantId: string | null;
  eventType: T;
  actorUserId?: string | null;
  actor?: { user_agent?: string };
  entityType?: string;
  entityId?: string;
  rawPayload: Record<string, unknown>;
}

/**
 * ADR-003 §12.4 — single sanctioned entry point for `audit_logs` INSERTs.
 *
 * Never call `db.insertInto('audit_logs')` from anywhere else; CI grep guard
 * enforces this. Sanitizer runs whitelist + deny-list filter; PII detection
 * throws plain Error('error.audit.piiDetected') which the global errorHandler
 * maps to 500 INTERNAL_ERROR.
 *
 * `executor` parametresi `Kysely<DB>` veya `Transaction<DB>` olabilir; route
 * handler'lar domain mutation'la audit INSERT'i tek transaction içinde
 * çalıştırmak için trx geçer (ADR-002 §10.4).
 */
export async function writeAudit<T extends AuditEventType>(
  executor: AuditExecutor,
  params: WriteAuditParams<T>,
): Promise<void> {
  const payload: AllowedPayload<T> = sanitize(
    params.eventType,
    params.rawPayload,
    (msg) => {
      logger.warn(msg);
    },
  );

  await executor
    .insertInto('audit_logs')
    .values({
      id: randomUUID(),
      tenant_id: params.tenantId,
      event_type: params.eventType,
      actor_user_id: params.actorUserId ?? null,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      // Kysely Json columns: JSON.stringify required for pg driver via Generated<Json>.
      payload: JSON.stringify(payload),
      actor: JSON.stringify(params.actor ?? {}),
    })
    .execute();
}
