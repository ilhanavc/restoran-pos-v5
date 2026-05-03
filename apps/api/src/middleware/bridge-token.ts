import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

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
