import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import type { AuditEventType } from '@restoran-pos/shared-types';
import { sanitize, type AllowedPayload } from '@restoran-pos/shared-domain';

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
 */
export async function writeAudit<T extends AuditEventType>(
  db: Kysely<DB>,
  params: WriteAuditParams<T>,
): Promise<void> {
  const payload: AllowedPayload<T> = sanitize(
    params.eventType,
    params.rawPayload,
  );

  await db
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
