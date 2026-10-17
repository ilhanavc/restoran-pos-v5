import type { ErrorRequestHandler, Request } from 'express';
import { describePgError } from '@restoran-pos/db';
import { toHttpError } from '../errors.js';
import { logger } from '../logger.js';
import { captureError } from '../observability/sentry.js';

/**
 * İstek için PATH ŞABLONU (`/:orderId/items`) — ham URL DEĞİL.
 * `req.originalUrl` id/telefon gibi PII taşıyabilir, log'a girmez (KVKK).
 *
 * ⚠️ Şablon ROUTER'A GÖRELİdir: Express, hata app seviyesindeki bu middleware'e
 * ulaşmadan önce `req.baseUrl`'i geri alır (router'dan çıkarken restore eder),
 * bu yüzden mount öneki (`/orders`) burada ARTIK YOKTUR — `req.baseUrl` ''.
 * Yine de `method` + `pg.table`/`constraint` ile birlikte olay tanınabilir.
 * Tam öneki basmak route-match anında yakalayan ayrı bir middleware gerektirir
 * (bu PR'ın kapsamı dışı). Route eşleşmeden fırlayan hatada (ör. body-parser)
 * `route` yoktur → alan `undefined`.
 *
 * Express tipinde `req.route` `any`; anayasa gereği `any` bırakılmaz, bu yüzden
 * `unknown` üzerinden daraltılır (`route.path` dizi/RegExp de olabilir).
 */
function routeTemplate(req: Request): string | undefined {
  const route: unknown = req.route;
  const path =
    typeof route === 'object' &&
    route !== null &&
    'path' in route &&
    typeof route.path === 'string'
      ? route.path
      : undefined;
  if (path !== undefined) return `${req.baseUrl}${path}`;
  return req.baseUrl.length > 0 ? req.baseUrl : undefined;
}

/**
 * ADR-006 §2 — Tek merkezi error middleware. Express'in 4 argümanlı imza
 * sözleşmesi gereği `_next` parametresi imzada kalmalı. `app.use(errorHandler)`
 * çağrısı tüm route'lardan SONRA gelmeli.
 *
 * ADR-040 — 5xx (beklenmeyen sunucu hatası) Sentry'ye raporlanır; dönen event
 * id yanıta `reference` olarak eklenir (code-style §81). Sentry devre dışıysa
 * `captureError` no-op döner, davranış değişmez. 4xx (istemci hatası) Sentry'ye
 * gitmez — gürültü olmasın.
 *
 * 5xx log satırı TEŞHİS EDİLEBİLİR olmalı (docs/audit/23514-teshis-2026-09-27.md
 * §3 F1): eski satır yalnız `{ err, sentryEventId }` basıyordu ve pino `err`'den
 * sadece `name` + `code` serileştirdiği için route/method/tenant/`constraint`
 * hiçbiri görünmüyordu — prod'daki dört 23514 hatasının kaynağını bulmak 20 gün
 * sürdü. Log'a giren alanların hepsi PII'siz: path şablonu (ham URL değil),
 * kimlik id'leri ve sanitize edilmiş pg alanları (`describePgError`).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const { status, body } = toHttpError(err);
  if (status >= 500) {
    const reference = captureError(err);
    const pg = describePgError(err);
    logger.error(
      {
        err,
        sentryEventId: reference,
        method: req.method,
        route: routeTemplate(req),
        // Bridge akışında `req.tenantId`, kullanıcı akışında `req.user`.
        tenantId: req.user?.tenantId ?? req.tenantId,
        userId: req.user?.userId,
        ...(pg !== null && { pg }),
      },
      '[errorHandler] unhandled error',
    );
    if (reference !== undefined) {
      body.error.reference = reference;
    }
  }
  res.status(status).json(body);
};
