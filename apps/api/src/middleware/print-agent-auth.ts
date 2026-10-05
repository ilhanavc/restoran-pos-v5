import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Kysely } from 'kysely';
import { withTenant, type DB } from '@restoran-pos/db';
import { logger } from '../logger.js';
import { captureError } from '../observability/sentry.js';

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
 *      response gecikmesin). ADR-041 Amd7 K5: hata artık SESSİZCE YUTULMAZ —
 *      `logger.error` + `captureError` (istek yine başarılı olur)
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
    //
    // ADR-041 Amd7 K3 — `agents` force-RLS (mig 064) → tenant context ŞART.
    // Tenant kaynağı doğrulanmış JWT payload'ı (`tid`), yani `withTenant`
    // sözleşmesinin istediği kaynak zaten mevcut; eksik olan yalnız sarımdı
    // (Amd2 Karar 2'nin "pre-context" etiketi bu yüzden yanlıştı).
    // Sarım eksik kalırsa: 0 satır → aşağıdaki 401 AGENT_REVOKED → her poll
    // reddedilir → TÜM BASKI DURUR (gürültülü: agent log'u + gelmeyen fiş).
    const row = await withTenant(deps.db, tenantId, (trx) =>
      trx
        .selectFrom('agents')
        .select(['id'])
        .where('id', '=', agentId)
        .where('tenant_id', '=', tenantId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst(),
    );
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
    //
    // ADR-041 Amd7 K3 — 🔴 UYGULAMA-KATMANI BUG'I DÜZELTİLDİ: bu UPDATE'te
    // `tenant_id` filtresi HİÇ YOKTU (yalnız `id`). RLS eksiği değil, base
    // ADR'nin "tek unutulan WHERE" sınıfı; `agentId` UUID olduğu için bugün
    // sömürülebilir değildi ama eksik WHERE'in kendisi bulgudur ve RLS onu
    // maskelemeden önce kapatıldı.
    //
    // ADR-041 Amd7 K5 — `.catch(() => {})` KALDIRILDI. Fire-and-forget
    // davranışı BİREBİR korunur: `await` YOK, istek düşürülmez, yanıt
    // gecikmesi değişmez. Değişen tek şey `catch`'in boş kalmaması — bu yol
    // artık gerçek DB hatalarını (bağlantı kopması, GRANT kaybı, WITH CHECK
    // ihlali) sessizce yutmaz. `captureError` ADR-040'ın mevcut
    // `beforeSend`/PII kapısından geçer; Sentry aynı hatayı tek issue'da
    // gruplar → yüksek sayaç burada tam olarak istenen sinyaldir.
    //
    // ⚠️ K5'İN SINIRI (ampirik bulgu, Amd7 metninden SAPMA): **eksik sarımı
    // bu catch YAKALAMAZ.** Force-RLS altında context'siz bir UPDATE 42501
    // FIRLATMAZ; policy'nin `USING` yüklemi satırı görünmez kılar ve komut
    // "0 satır etkilendi" ile BAŞARIYLA döner. Yani sarım söküklüyken
    // `last_seen_at` sessizce donar ve Sentry'ye hiçbir şey düşmez (negatif
    // kontrolde doğrulandı: `last_seen_at` NULL kaldı, log yazılmadı).
    // Dolayısıyla eksik sarımın tek gerçek güvenlik ağı NEGATİF KONTROL
    // TESTİDİR (print-agent-auth.test.ts "last_seen_at poll sonrası dolar"),
    // K5'in alarmı değil.
    void withTenant(deps.db, tenantId, (trx) =>
      trx
        .updateTable('agents')
        .set({ last_seen_at: new Date() })
        .where('id', '=', agentId)
        .where('tenant_id', '=', tenantId)
        .execute(),
    ).catch((err: unknown) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), agentId },
        '[print-agent-auth] last_seen_at yazımı başarısız — gözlem alanı donar (ADR-041 Amd7 K5)',
      );
      captureError(err);
    });

    req.tenantId = tenantId;
    req.agentId = agentId;
    next();
  };
}
