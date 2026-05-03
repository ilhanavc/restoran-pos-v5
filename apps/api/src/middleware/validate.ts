import type { RequestHandler } from 'express';
import { z, type ZodTypeAny } from 'zod';

export function validateBody<S extends ZodTypeAny>(
  schema: S,
): RequestHandler<unknown, unknown, z.infer<S>> {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return void next(result.error);
    }
    req.body = result.data;
    next();
  };
}

/**
 * Path parameter doğrulayıcı — `validateBody` simetriği. Zod hatası
 * `errorHandler` üzerinden 400 VALIDATION_ERROR'a map edilir (errors.ts §ZodError).
 *
 * Middleware sırası: `authenticate → authorize → validateParams → handler`.
 * Auth'tan SONRA çağrılır; başarısız UUID parse'ı authentication'dan önce
 * 400 dönerse endpoint'in varlığı sızdırılır (info disclosure). Yetkisiz istek
 * yine 401/403 alır, yetkili istek malformed param için 400 alır.
 */
export function validateParams<S extends ZodTypeAny>(
  schema: S,
): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return void next(result.error);
    }
    // req.params Express tarafından readonly Record<string,string>; merge atomik.
    Object.assign(req.params, result.data);
    next();
  };
}

/**
 * Query string doğrulayıcı — `validateBody` simetriği. Zod parse sonucu
 * `req.query`'ye geri yazılır (coerce edilmiş tipler için). Hata
 * `errorHandler` üzerinden 400 VALIDATION_ERROR'a map edilir.
 */
export function validateQuery<S extends ZodTypeAny>(
  schema: S,
): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return void next(result.error);
    }
    Object.assign(req.query, result.data);
    next();
  };
}

/**
 * Tek `id` UUID path parametresi — yaygın kalıp (`/:id`, `/:id/...`).
 * Yeni route'lar için varsayılan; özel format gerekiyorsa route inline tanımlar.
 */
export const idParamSchema = z.object({
  id: z.string().uuid(),
});
