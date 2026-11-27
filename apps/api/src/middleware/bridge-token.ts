import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Kysely } from 'kysely';
import {
  createCallerBridgeKeysRepository,
  withTenant,
  type DB,
} from '@restoran-pos/db';
import { logger } from '../logger.js';

/**
 * Caller Bridge / Print Agent shared-secret authentication — ADR-016 §11.
 *
 * Bridge süreçleri (lokal Windows servisleri) Authorization JWT akışına dahil
 * değildir; servis kimliği `X-Bridge-Token` header üzerinden tek seferlik
 * sabit token ile doğrulanır. Karşılaştırma `timingSafeEqual` ile yapılır
 * (timing leak'i bertaraf eder).
 *
 * Tenant header zorunlu: bridge süreçleri `X-Tenant-Id` header'ı ile hangi
 * tenant'a ait event gönderdiklerini belirtir (JWT yok). UUID format kontrolü
 * yapılır; format hatası 400.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * `X-Bridge-Token` header'ı `expectedToken` ile constant-time karşılaştırılır.
 * Eksik / yanlış → 401 BRIDGE_TOKEN_INVALID. Token boş tanımlıysa (process
 * env yok) tüm istekler 401 alır — defansif fail-closed.
 */
export function requireBridgeToken(expectedToken: string | undefined): RequestHandler {
  const token = expectedToken ?? '';
  return (req: Request, res: Response, next: NextFunction): void => {
    if (token === '') {
      res.status(401).json({ error: { code: 'BRIDGE_TOKEN_INVALID' } });
      return;
    }
    const provided = req.get('X-Bridge-Token') ?? '';
    if (provided === '' || !constantTimeEquals(provided, token)) {
      res.status(401).json({ error: { code: 'BRIDGE_TOKEN_INVALID' } });
      return;
    }
    next();
  };
}

/**
 * `X-Tenant-Id` header'ından tenant id okur, UUID format kontrolünden geçirip
 * `req.tenantId` set eder. Eksik / format hatası → 400 TENANT_HEADER_INVALID.
 */
export function requireTenantHeader(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = req.get('X-Tenant-Id') ?? '';
    if (raw === '' || !UUID_REGEX.test(raw)) {
      res.status(400).json({ error: { code: 'TENANT_HEADER_INVALID' } });
      return;
    }
    req.tenantId = raw;
    next();
  };
}

/**
 * ADR-052 K5.1 — the legacy shared `BRIDGE_TOKEN` is locked to the platform's
 * live tenant (`TENANT_ID`). Runs after `requireBridgeToken` +
 * `requireTenantHeader`. Any other tenant in `X-Tenant-Id` → the same
 * 401 BRIDGE_TOKEN_INVALID (no distinct "wrong tenant" code — no oracle).
 * Empty/undefined `lockedTenantId` → every request 401 (fail-closed).
 *
 * K4.1: on failure nothing attacker-chosen is logged; on success a
 * `caller_id.bridge.legacy_token` counter line (K5.2 removal criterion).
 */
export function requireLegacyBridgeTenant(lockedTenantId: string | undefined): RequestHandler {
  const locked = (lockedTenantId ?? '').toLowerCase();
  return (req: Request, res: Response, next: NextFunction): void => {
    const headerTenant = (req.tenantId ?? '').toLowerCase();
    if (locked === '' || headerTenant !== locked) {
      // Fixed text only — the header value is attacker-chosen and never logged.
      logger.warn('caller_id.bridge.legacy_tenant_rejected');
      res.status(401).json({ error: { code: 'BRIDGE_TOKEN_INVALID' } });
      return;
    }
    req.tenantId = locked;
    logger.info({ tenantId: locked }, 'caller_id.bridge.legacy_token');
    next();
  };
}

/**
 * ADR-052 K1 — tenant-bound bridge key: `cb1_<32 lowercase hex tenant uuid>_<43 base64url>`.
 * The prefix only SELECTS the tenant to look in; authority comes solely from
 * the SHA-256 of the full presented string matching a live row (ADR-042 K5).
 */
export const CALLER_BRIDGE_KEY_PREFIX = 'cb1_';
const CALLER_BRIDGE_KEY_RE = /^cb1_([0-9a-f]{32})_[A-Za-z0-9_-]{43}$/;

/** K2 — `last_used_at` is written at most once per this window. */
const LAST_USED_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function hexToUuid(hex: string): string {
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function rejectBridgeKey(res: Response): void {
  // K4.1: fixed text only — no tenant, no token (both attacker-chosen).
  logger.warn('caller_id.bridge.key_rejected');
  res.status(401).json({ error: { code: 'BRIDGE_TOKEN_INVALID' } });
}

/**
 * ADR-052 K1 — verifies a `cb1_` bridge key. Sets `req.tenantId` to the tenant
 * resolved FROM THE KEY (never from `X-Tenant-Id`, K1.6 i). Every failure is
 * the same 401 BRIDGE_TOKEN_INVALID (K1.4); it never falls back to the legacy
 * shared-secret branch (K1.6 iii) — the dispatcher `requireBridgeAuth` owns
 * that routing.
 *
 * Order (K1.2): strict parse → pre-context `tenants` read (RLS-free table, no
 * BYPASSRLS pool — same path as print-agent `pk2_` and refresh `rt1_`) →
 * hash lookup inside `withTenant(<resolved tenant>)`. The hash query runs even
 * when the tenant does not exist (K1.5 — no extra signal from timing).
 */
export function requireCallerBridgeKey(db: Kysely<DB>): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const provided = req.get('X-Bridge-Token') ?? '';
      const match = CALLER_BRIDGE_KEY_RE.exec(provided);
      if (match === null) {
        rejectBridgeKey(res);
        return;
      }
      const tenantId = hexToUuid(match[1]!);

      // K1.3 + K1.6 v: optional header; if sent it must equal the key's tenant.
      // Both sides normalized to lowercase (the prefix regex already is).
      const headerTenant = req.get('X-Tenant-Id');
      if (headerTenant !== undefined && headerTenant.toLowerCase() !== tenantId) {
        rejectBridgeKey(res);
        return;
      }

      const tenantRow = await db
        .selectFrom('tenants')
        .select(['id'])
        .where('id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      // K1.6 iv: validity filter lives inside the repository query.
      const keyHash = createHash('sha256').update(provided, 'utf8').digest();
      const keyRow = await withTenant(db, tenantId, async (trx) => {
        const repo = createCallerBridgeKeysRepository(trx);
        const row = await repo.findActiveByHash(tenantId, keyHash);
        if (row === null || tenantRow === undefined) return null;
        const lastUsed = row.last_used_at?.getTime() ?? null;
        if (lastUsed === null || Date.now() - lastUsed >= LAST_USED_TOUCH_INTERVAL_MS) {
          // Throttle is enforced again in SQL; this check only skips the
          // no-op UPDATE on the hot path.
          await repo.touchLastUsed(tenantId, row.id);
        }
        return row;
      });

      if (keyRow === null || tenantRow === undefined) {
        rejectBridgeKey(res);
        return;
      }
      req.tenantId = tenantId;
    } catch (err) {
      next(err);
      return;
    }
    // Outside the try: a synchronous throw downstream must not trigger a
    // second next(err) from the catch above.
    next();
  };
}

export interface BridgeAuthOptions {
  db: Kysely<DB>;
  /** Legacy shared `BRIDGE_TOKEN` (ADR-016 §11) — removed in ADR-052 PR-5. */
  legacyToken: string | undefined;
  /** ADR-052 K5.1 — the only tenant the legacy token may write to. */
  legacyTenantId: string | undefined;
}

/**
 * ADR-052 K1/K5 — single auth entry for the bridge endpoint. The branch is
 * chosen by the token prefix ONLY:
 *   - `cb1_…`  → `requireCallerBridgeKey` (tenant from the key). A failing
 *                `cb1_` token is a 401 and NEVER reaches the legacy branch.
 *   - anything else → unchanged legacy chain: `requireBridgeToken` →
 *                `requireTenantHeader` → `requireLegacyBridgeTenant`.
 */
export function requireBridgeAuth(opts: BridgeAuthOptions): RequestHandler {
  const keyBranch = requireCallerBridgeKey(opts.db);
  const legacyBranch: RequestHandler[] = [
    requireBridgeToken(opts.legacyToken),
    requireTenantHeader(),
    requireLegacyBridgeTenant(opts.legacyTenantId),
  ];
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.get('X-Bridge-Token') ?? '';
    if (provided.startsWith(CALLER_BRIDGE_KEY_PREFIX)) {
      void keyBranch(req, res, next);
      return;
    }
    runChain(legacyBranch, req, res, next);
  };
}

/**
 * Runs synchronous middlewares in order, stopping at the first one that does
 * not call `next()` (it has already responded). Errors are forwarded.
 */
function runChain(
  handlers: readonly RequestHandler[],
  req: Request,
  res: Response,
  done: NextFunction,
): void {
  let index = 0;
  const step = (err?: unknown): void => {
    // `next(null)` means "no error": continue with the next legacy check.
    // Forwarding null to Express would skip the remaining checks entirely.
    if (err !== undefined && err !== null) {
      done(err);
      return;
    }
    const handler = handlers[index];
    index += 1;
    if (handler === undefined) {
      done();
      return;
    }
    void handler(req, res, step);
  };
  step();
}
