import type { ErrorRequestHandler, Request } from 'express';
import { describePgError } from '@restoran-pos/db';
import { toHttpError } from '../errors.js';
import { logger } from '../logger.js';
import { captureError } from '../observability/sentry.js';

/**
 * İstek için TAM PATH ŞABLONU (`/orders/:orderId/items`) — ham URL DEĞİL.
 * `req.originalUrl` id/telefon gibi PII taşıyabilir, log'a girmez (KVKK).
 *
 * Önek `req.mountPattern`'dan gelir: `app.use`'a verilen **literal desen**,
 * istekten türetilmiş metin değil (ADR-006 §2 Amendment 2026-11-05, bkz.
 * `mount.ts`). `req.baseUrl` burada OKUNMAZ — iki sebeple: (1) Express hata
 * bu app seviyesi middleware'e ulaşmadan önce onu restore eder, alan `''`
 * olur; (2) şablonu değil eşleşen metni döndürdüğü için parametreli
 * mount'larda log'a gerçek UUID girerdi.
 *
 * Alan üç değerli:
 * 1. **Tam** — `mountPattern + route.path` (route eşleşti).
 * 2. **Yalnız mount deseni** — istek router'a girdi, route eşleşmedi
 *    (router-içi 404 veya router seviyesi middleware hatası).
 * 3. **`undefined`** — istek hiçbir mount'a girmedi (body-parser hatası,
 *    app seviyesi 404). Teşhis `method` + `pg` alanlarına kalır; kabul
 *    edilen sınır.
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
  const prefix = req.mountPattern ?? '';
  if (path !== undefined) return `${prefix}${path}`;
  return prefix.length > 0 ? prefix : undefined;
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
