import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';

/**
 * ADR-004 Amendment 2 (Session 62 PR-3a) — Print Agent JWT verify middleware.
 *
 * Davranış (decisions.md ADR-004 §Amendment 2 §4):
 *   1. `Authorization: Bearer <token>` header yoksa → 401 AUTH_TOKEN_MISSING
 *   2. JWT verify fail (expired, wrong signature, wrong `type` claim) →
 *      401 AUTH_TOKEN_INVALID
 *   3. DB lookup `agents WHERE id=$sub AND tenant_id=$tid AND revoked_at IS NULL`
 *      → 0 row → 401 AGENT_REVOKED
 *   4. `UPDATE agents SET last_seen_at = now()` fire-and-forget (await EDİLMEZ;
 *      response gecikmesin; hata sessizce yutulur)
 *   5. `req.tenantId` + `req.agentId` set; `next()`
 *
 * `requireTenantHeader` (mock auth, bridge-token.ts) ile chain'lenmez; tek
 * katman. Var olan handler kodu `req.tenantId` üzerinden çalışmaya devam
 * eder — sadece auth kaynağı değişti.
 *
 * Secret: `JWT_AGENT_SECRET` env var (user `JWT_ACCESS_SECRET`'ten ayrı —
 * compromise blast radius). HS256, `type='agent'` claim mock auth ve user
 * JWT'leri ayırt eder.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * ADR-004 Amendment 2 — `requireAgentJwt` middleware tarafından set
       * edilen agent id (JWT `sub` claim). Mock auth (`X-Tenant-Id` header)
       * akışında tanımsızdır.
       */
      agentId?: string;
    }
  }
}

export interface PrintAgentAuthDeps {
  db: Kysely<DB>;
  agentSecret: string;
}

/**
 * `agents` tablosunu lookup edip `req.tenantId` + `req.agentId` set eder.
 * Handler kodları bu iki alana güvenebilir (mock auth ile uyumlu).
 */
export function requireAgentJwt(deps: PrintAgentAuthDeps): RequestHandler {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const header = req.header('Authorization');
    if (header === undefined || !header.startsWith('Bearer ')) {
      res.status(401).json({
        error: {
          code: 'AUTH_TOKEN_MISSING',
          message_key: 'error.auth.tokenMissing',
        },
      });
      return;
    }
    const token = header.slice('Bearer '.length);

    let payload: jwt.JwtPayload;
    try {
      const decoded = jwt.verify(token, deps.agentSecret, {
        algorithms: ['HS256'],
      });
      if (typeof decoded === 'string') {
        throw new Error('string payload');
      }
      payload = decoded;
    } catch {
      res.status(401).json({
        error: {
          code: 'AUTH_TOKEN_INVALID',
          message_key: 'error.auth.tokenInvalid',
        },
      });
      return;
    }

    if (
      payload['type'] !== 'agent' ||
      typeof payload['sub'] !== 'string' ||
      typeof payload['tid'] !== 'string'
    ) {
      res.status(401).json({
        error: {
          code: 'AUTH_TOKEN_INVALID',
          message_key: 'error.auth.tokenInvalid',
        },
      });
      return;
    }

    const agentId = payload['sub'];
    const tenantId = payload['tid'];

    // DB lookup — revoke flow tüm aktif access token'ları öldürür
    // (stateless rotation kararı; ADR-004 §Amendment 2 §3).
    const row = await deps.db
      .selectFrom('agents')
      .select(['id'])
      .where('id', '=', agentId)
      .where('tenant_id', '=', tenantId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (row === undefined) {
      res.status(401).json({
        error: {
          code: 'AGENT_REVOKED',
          message_key: 'error.printAgent.revoked',
        },
      });
      return;
    }

    // Fire-and-forget last_seen_at update — response latency'i etkilemesin.
    // Hata sessizce yutulur (admin UI "son görülme" Phase 4+; eksik update
    // güvenlik veya correctness etkilemez).
    void deps.db
      .updateTable('agents')
      .set({ last_seen_at: new Date() })
      .where('id', '=', agentId)
      .execute()
      .catch(() => {
        /* sessizce yut */
      });

    req.tenantId = tenantId;
    req.agentId = agentId;
    next();
  };
}
