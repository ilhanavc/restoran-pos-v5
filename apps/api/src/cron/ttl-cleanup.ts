/**
 * ADR-002 §13 — TTL cleanup cron.
 *
 * Audit log retention 2 yıl, call_logs retention 30 gün (KVKK §13.2.A).
 * Her gece 03:30 Europe/Istanbul'da iki bağımsız task koşar:
 *   - purgeAuditLogs   → audit_logs WHERE created_at  < now() - 2 years
 *   - purgeCallLogs    → call_logs  WHERE received_at < now() - 30 days
 *
 * Tasarım kuralları (§13.2):
 *   - Tenant döngüsü: her tenant'a ayrı DELETE (cross-tenant impact yok).
 *   - Batch: LIMIT 10000 — büyük tablo'da tek DELETE lock yığmasın.
 *   - Advisory lock: çakışan node'lar varsa ikinci instance silent exit.
 *   - Self-audit: her task tamamlanınca tek `audit.purge` event (§13.4).
 *   - audit_logs ek pass: tenant_id IS NULL (system-actor satırlar).
 *   - call_logs: yalnız tenant-loop (system-actor yok).
 */
import cron, { type ScheduledTask } from 'node-cron';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { CRON_LOCK_IDS } from '@restoran-pos/shared-domain';
import { writeAudit } from '../audit/writeAudit.js';
import { logger } from '../logger.js';

const BATCH_LIMIT = 10_000;
const SCHEDULE_EXPR = '0 30 3 * * *';
const TIMEZONE = 'Europe/Istanbul';

const AUDIT_LOG_RETENTION_DAYS = 365 * 2; // 2 yıl
const CALL_LOG_RETENTION_DAYS = 30;

export interface TtlCleanupDeps {
  pool: Pool;
  db: Kysely<DB>;
}

/**
 * Try to acquire a session-level advisory lock. Returns null if lock failed
 * (another instance running) — caller must silent-exit.
 *
 * Lock holder = pool client. Caller MUST release via `releaseLock(client, id)`
 * in `finally`. Released-or-throw kuralı: client.release() finally'de.
 */
async function tryAcquireLock(
  pool: Pool,
  lockId: bigint,
): Promise<{ release: () => Promise<void> } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockId.toString()],
    );
    if (res.rows[0]?.acquired !== true) {
      client.release();
      return null;
    }
    return {
      release: async () => {
        try {
          await client.query('SELECT pg_advisory_unlock($1)', [
            lockId.toString(),
          ]);
        } finally {
          client.release();
        }
      },
    };
  } catch (err) {
    client.release();
    throw err;
  }
}

interface BatchOutcome {
  deleted: number;
  batches: number;
}

/**
 * audit_logs için batch DELETE — bir tenant scope'u (tenantId NULL ise
 * system-actor satırlar).
 */
async function batchDeleteAuditLogs(
  db: Kysely<DB>,
  tenantId: string | null,
  cutoffIso: string,
): Promise<BatchOutcome> {
  let deleted = 0;
  let batches = 0;
  // Loop until affected_rows < BATCH_LIMIT.
  // CTE pattern: DELETE ... WHERE id IN (SELECT id ... LIMIT N).
  for (;;) {
    const result = await sql<{ deleted_id: string }>`
      WITH victims AS (
        SELECT id
          FROM audit_logs
         WHERE created_at < ${cutoffIso}::timestamptz
           AND ${tenantId === null ? sql`tenant_id IS NULL` : sql`tenant_id = ${tenantId}::uuid`}
         LIMIT ${BATCH_LIMIT}
      )
      DELETE FROM audit_logs
       USING victims
       WHERE audit_logs.id = victims.id
       RETURNING audit_logs.id AS deleted_id
    `.execute(db);
    const affected = result.rows.length;
    deleted += affected;
    batches += 1;
    if (affected < BATCH_LIMIT) break;
  }
  return { deleted, batches };
}

async function batchDeleteCallLogs(
  db: Kysely<DB>,
  tenantId: string,
  cutoffIso: string,
): Promise<BatchOutcome> {
  let deleted = 0;
  let batches = 0;
  for (;;) {
    const result = await sql<{ deleted_id: string }>`
      WITH victims AS (
        SELECT id
          FROM call_logs
         WHERE received_at < ${cutoffIso}::timestamptz
           AND tenant_id = ${tenantId}::uuid
         LIMIT ${BATCH_LIMIT}
      )
      DELETE FROM call_logs
       USING victims
       WHERE call_logs.id = victims.id
       RETURNING call_logs.id AS deleted_id
    `.execute(db);
    const affected = result.rows.length;
    deleted += affected;
    batches += 1;
    if (affected < BATCH_LIMIT) break;
  }
  return { deleted, batches };
}

function cutoffIso(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

async function listTenantIds(db: Kysely<DB>): Promise<string[]> {
  const rows = await db
    .selectFrom('tenants')
    .select('id')
    .where('deleted_at', 'is', null)
    .execute();
  return rows.map((r) => r.id);
}

/**
 * audit_logs (2 yıl) purge task. Advisory lock + tenant-loop + system-actor pass.
 * §13.4 self-audit: tek `audit.purge` event yazılır.
 */
export async function purgeAuditLogs(deps: TtlCleanupDeps): Promise<void> {
  const startedAt = Date.now();
  const lock = await tryAcquireLock(
    deps.pool,
    CRON_LOCK_IDS.TTL_CLEANUP_AUDIT_LOGS,
  );
  if (lock === null) {
    logger.warn(
      { task: 'audit_logs' },
      '[ttl-cleanup] advisory lock taken; silent exit',
    );
    return;
  }
  let totalDeleted = 0;
  let totalBatches = 0;
  const cutoff = cutoffIso(AUDIT_LOG_RETENTION_DAYS);
  try {
    const tenantIds = await listTenantIds(deps.db);
    for (const tenantId of tenantIds) {
      try {
        const t0 = Date.now();
        const out = await batchDeleteAuditLogs(deps.db, tenantId, cutoff);
        totalDeleted += out.deleted;
        totalBatches += out.batches;
        logger.info(
          {
            task: 'audit_logs',
            tenant_id: tenantId,
            deleted_count: out.deleted,
            batch_count: out.batches,
            duration_ms: Date.now() - t0,
          },
          '[ttl-cleanup] audit_logs tenant batch done',
        );
        if (out.deleted > 0 && out.deleted % BATCH_LIMIT === 0) {
          logger.warn(
            { task: 'audit_logs', tenant_id: tenantId, deleted: out.deleted },
            '[ttl-cleanup] retention pressure: hit BATCH_LIMIT exactly',
          );
        }
      } catch (err) {
        logger.error(
          { task: 'audit_logs', tenant_id: tenantId, err },
          '[ttl-cleanup] audit_logs tenant batch failed',
        );
      }
    }
    // System-actor pass (tenant_id IS NULL).
    try {
      const t0 = Date.now();
      const out = await batchDeleteAuditLogs(deps.db, null, cutoff);
      totalDeleted += out.deleted;
      totalBatches += out.batches;
      logger.info(
        {
          task: 'audit_logs',
          tenant_id: null,
          deleted_count: out.deleted,
          batch_count: out.batches,
          duration_ms: Date.now() - t0,
        },
        '[ttl-cleanup] audit_logs system-actor batch done',
      );
    } catch (err) {
      logger.error(
        { task: 'audit_logs', tenant_id: null, err },
        '[ttl-cleanup] audit_logs system-actor batch failed',
      );
    }
    // Self-audit (§13.4) — tek event, tenantId=null sistem actor.
    try {
      await writeAudit(deps.db, {
        tenantId: null,
        eventType: 'audit.purge',
        actorUserId: null,
        actor: { user_agent: 'cron/ttl-cleanup' },
        rawPayload: {
          table: 'audit_logs',
          deleted_count: totalDeleted,
          batch_count: totalBatches,
          duration_ms: Date.now() - startedAt,
          cutoff_date: cutoff,
        },
      });
    } catch (err) {
      logger.error(
        { task: 'audit_logs', err },
        '[ttl-cleanup] self-audit write failed',
      );
    }
  } finally {
    await lock.release();
  }
}

/**
 * call_logs (30 gün) purge task. Advisory lock + tenant-loop only.
 * KVKK §13.2.A retention.
 */
export async function purgeCallLogs(deps: TtlCleanupDeps): Promise<void> {
  const startedAt = Date.now();
  const lock = await tryAcquireLock(
    deps.pool,
    CRON_LOCK_IDS.TTL_CLEANUP_CALL_LOGS,
  );
  if (lock === null) {
    logger.warn(
      { task: 'call_logs' },
      '[ttl-cleanup] advisory lock taken; silent exit',
    );
    return;
  }
  let totalDeleted = 0;
  let totalBatches = 0;
  const cutoff = cutoffIso(CALL_LOG_RETENTION_DAYS);
  try {
    const tenantIds = await listTenantIds(deps.db);
    for (const tenantId of tenantIds) {
      try {
        const t0 = Date.now();
        const out = await batchDeleteCallLogs(deps.db, tenantId, cutoff);
        totalDeleted += out.deleted;
        totalBatches += out.batches;
        logger.info(
          {
            task: 'call_logs',
            tenant_id: tenantId,
            deleted_count: out.deleted,
            batch_count: out.batches,
            duration_ms: Date.now() - t0,
          },
          '[ttl-cleanup] call_logs tenant batch done',
        );
        if (out.deleted > 0 && out.deleted % BATCH_LIMIT === 0) {
          logger.warn(
            { task: 'call_logs', tenant_id: tenantId, deleted: out.deleted },
            '[ttl-cleanup] retention pressure: hit BATCH_LIMIT exactly',
          );
        }
      } catch (err) {
        logger.error(
          { task: 'call_logs', tenant_id: tenantId, err },
          '[ttl-cleanup] call_logs tenant batch failed',
        );
      }
    }
    try {
      await writeAudit(deps.db, {
        tenantId: null,
        eventType: 'audit.purge',
        actorUserId: null,
        actor: { user_agent: 'cron/ttl-cleanup' },
        rawPayload: {
          table: 'call_logs',
          deleted_count: totalDeleted,
          batch_count: totalBatches,
          duration_ms: Date.now() - startedAt,
          cutoff_date: cutoff,
        },
      });
    } catch (err) {
      logger.error(
        { task: 'call_logs', err },
        '[ttl-cleanup] self-audit write failed',
      );
    }
  } finally {
    await lock.release();
  }
}

/**
 * Schedule both tasks daily at 03:30 Europe/Istanbul.
 * Returns the scheduled task handle so callers can stop it (tests).
 */
export function startTtlCleanup(deps: TtlCleanupDeps): ScheduledTask {
  const task = cron.schedule(
    SCHEDULE_EXPR,
    () => {
      void (async () => {
        try {
          await purgeAuditLogs(deps);
        } catch (err) {
          logger.error({ err }, '[ttl-cleanup] purgeAuditLogs crashed');
        }
        try {
          await purgeCallLogs(deps);
        } catch (err) {
          logger.error({ err }, '[ttl-cleanup] purgeCallLogs crashed');
        }
      })();
    },
    { timezone: TIMEZONE },
  );
  logger.info(
    { schedule: SCHEDULE_EXPR, timezone: TIMEZONE },
    '[ttl-cleanup] scheduled',
  );
  return task;
}
