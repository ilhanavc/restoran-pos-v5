import { z } from 'zod';
import { RepositoryError } from '@restoran-pos/db';

/**
 * ADR-006: Tüm HTTP hata yanıtları bu zarfı kullanır.
 * `code` makine-okur kararlı; `message_key` UI'da i18n lookup için.
 * Kullanıcıya gösterilen serbest metin asla bu zarfta dönmez.
 */
export interface ErrorEnvelope {
  error: {
    code: string;
    message_key: string;
    details?: unknown;
  };
}

/**
 * Auth katmanına özgü, route handler'ların `next(err)` ile fırlattığı domain hatası.
 * `httpStatus` doğrudan response status'una map edilir; tüm map mantığı `toHttpError`'da.
 */
export class AuthError extends Error {
  constructor(
    public readonly code: string,
    public readonly messageKey: string,
    public readonly httpStatus: number,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'AuthError';
  }
}

/**
 * Auth code → i18n message_key sözlüğü. UI tarafında `t(key)` ile çevrilir.
 * Format: `error.<domain>.<camelCase>` (test ile garanti edilir).
 */
export const AUTH_MESSAGE_KEYS: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: 'error.auth.invalidCredentials',
  AUTH_REFRESH_INVALID: 'error.auth.refreshInvalid',
  AUTH_RATE_LIMITED: 'error.auth.rateLimited',
  AUTH_CSRF_CHECK_FAILED: 'error.auth.csrfCheckFailed',
  AUTH_TOKEN_INVALID: 'error.auth.tokenInvalid',
  AUTH_BAD_REQUEST: 'error.auth.badRequest',
  AUTH_FORBIDDEN: 'error.auth.forbidden',
  INTERNAL_ERROR: 'error.internal',
  ACCESS_DENIED: 'error.auth.accessDenied',
  // ADR-006 §5.2 user lifecycle codes
  USER_NOT_FOUND: 'error.user.notFound',
  USER_LAST_ADMIN_PROTECTED: 'error.user.lastAdminProtected',
  USER_CANNOT_DELETE_SELF: 'error.user.cannotDeleteSelf',
  // ADR-006 §5.2 menu/product lifecycle codes (Görev 18)
  MENU_PRODUCT_NOT_FOUND: 'error.menu.productNotFound',
  MENU_CATEGORY_NOT_FOUND: 'error.menu.categoryNotFound',
  // ADR-006 §5.2 menu category lifecycle (Sprint 4 Görev 20 — DELETE guard)
  MENU_CATEGORY_HAS_PRODUCTS: 'error.menu.categoryHasProducts',
  // ADR-006 §5.2 table lifecycle codes (Sprint 4 Görev 19)
  TABLE_NOT_FOUND: 'error.table.notFound',
  TABLE_ALREADY_OCCUPIED: 'error.table.alreadyOccupied',
};

/**
 * Tek error → HTTP envelope mapper. Hiçbir zaman fırlatmaz, daima
 * `{status, body}` döner. Bilinmeyen hata 500 INTERNAL_ERROR'a düşer.
 */
export function toHttpError(err: unknown): {
  status: number;
  body: ErrorEnvelope;
} {
  if (err instanceof AuthError) {
    return {
      status: err.httpStatus,
      body: {
        error: {
          code: err.code,
          message_key: err.messageKey,
          ...(err.details !== undefined && { details: err.details }),
        },
      },
    };
  }

  if (err instanceof RepositoryError) {
    switch (err.cause) {
      case 'unique':
        return {
          status: 409,
          body: {
            error: {
              code: err.messageKey ?? 'RESOURCE_CONFLICT',
              message_key: 'error.resource.conflict',
              ...(err.detail !== undefined && {
                details: { field: err.detail },
              }),
            },
          },
        };
      case 'foreign_key': {
        const fkStatus = err.messageKey === 'TABLE_NOT_FOUND' ? 404 : 409;
        return {
          status: fkStatus,
          body: {
            error: {
              code: err.messageKey ?? 'RESOURCE_CONFLICT',
              message_key: err.messageKey
                ? `error.resource.${err.messageKey.toLowerCase()}`
                : 'error.resource.foreignKeyViolation',
            },
          },
        };
      }
      case 'check':
        return {
          status: 409,
          body: {
            error: {
              code: 'ORDER_INVARIANT_VIOLATED',
              message_key: err.messageKey ?? 'error.db.checkConstraint',
              ...(err.detail !== undefined && {
                details: { constraint: err.detail },
              }),
            },
          },
        };
      case 'not_found':
        return {
          status: 404,
          body: {
            error: {
              code: 'RESOURCE_NOT_FOUND',
              message_key: 'error.resource.notFound',
            },
          },
        };
      case 'not_null':
      case 'unknown':
      default:
        return {
          status: 500,
          body: {
            error: { code: 'INTERNAL_ERROR', message_key: 'error.internal' },
          },
        };
    }
  }

  if (err instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.');
      fields[path || '_'] = issue.message;
    }
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message_key: 'error.validation.failed',
          details: { fields },
        },
      },
    };
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message_key: 'error.internal' } },
  };
}
