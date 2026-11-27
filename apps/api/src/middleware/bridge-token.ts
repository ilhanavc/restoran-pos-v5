import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
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
