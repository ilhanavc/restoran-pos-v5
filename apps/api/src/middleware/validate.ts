import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';

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
