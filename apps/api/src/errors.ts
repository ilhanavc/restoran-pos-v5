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
 * Domain code → AuthError envelope kısayolu. Tek satırda fırlatma için.
 * `messageKey` `AUTH_MESSAGE_KEYS` sözlüğünde yoksa `error.internal`'a düşer.
 *
 * Tüm route'larda bu helper kullanılır (ADR-006 §5.2 message key registry'sini
 * tek nokta üzerinden tüketir; route'lardaki yerel duplicate'ler kaldırıldı).
 */
export function domainError(
  code: string,
  status: number,
  details?: unknown,
): AuthError {
  return new AuthError(
    code,
    AUTH_MESSAGE_KEYS[code] ?? 'error.internal',
    status,
    details,
  );
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
  // ADR-028 — PATCH /orders/:orderId/table (Masayı Değiştir). Yeni kodlar
  // (TABLE_NOT_FOUND + TABLE_ALREADY_OCCUPIED zaten VAR, reuse edilir):
  //   ORDER_NOT_DINE_IN (409) — takeaway/delivery siparişin masası yok.
  //   ORDER_ALREADY_CLOSED (409) — terminal status (paid|cancelled|void).
  //   TABLE_MOVE_SAME_TABLE (409) — hedef masa = mevcut masa (no-op reddi).
  ORDER_NOT_DINE_IN: 'error.order.notDineIn',
  ORDER_ALREADY_CLOSED: 'error.order.alreadyClosed',
  TABLE_MOVE_SAME_TABLE: 'error.table.moveSameTable',
  // ADR-029 — POST /orders/:sourceOrderId/merge (Adisyon Birleştir). Yeni kodlar
  // (ORDER_NOT_FOUND + ORDER_NOT_DINE_IN + ORDER_ALREADY_CLOSED zaten VAR, reuse):
  //   MERGE_SAME_ORDER (409) — hedef masa = kaynak siparişin masası (no-op reddi).
  //   MERGE_TARGET_NOT_OCCUPIED (409) — hedef masa boş (Masayı Değiştir kullan).
  //   ORDER_HAS_PAYMENTS (409) — kaynak veya hedefte ödeme kaydı var (K3).
  MERGE_SAME_ORDER: 'error.order.mergeSameOrder',
  MERGE_TARGET_NOT_OCCUPIED: 'error.order.mergeTargetNotOccupied',
  ORDER_HAS_PAYMENTS: 'error.order.hasPayments',
  // Session 78 (task_7f45a99d) — sipariş 404'ü. Registry'de eksikti; orders.ts +
  // payments.ts'teki 19 domainError('ORDER_NOT_FOUND', 404) çağrısı message_key
  // olarak generic 'error.internal' basıyordu (code alanı zaten doğruydu).
  ORDER_NOT_FOUND: 'error.order.notFound',
  // Session 78 (task_56cd16fe) — registry-completeness: kalan 9 domainError kodu
  // eklendi (generic 'error.internal' fallback sınıfı kapandı). Generic'ler
  // toHttpError kanonik anahtarlarıyla HİZALI (aynı kod → aynı message_key,
  // kaynağı domainError veya RepositoryError olsun): VALIDATION_ERROR (ZodError
  // dalı), RESOURCE_NOT_FOUND (not_found dalı), ORDER_INVARIANT_VIOLATED (check
  // dalı). Order-domain olanlar error.order.<camelCase>. errors.test.ts
  // kaynak-tarama lint testi bu sınıfı kalıcı kapatır.
  INVALID_STATE: 'error.order.invalidState',
  INVALID_TRANSITION: 'error.order.invalidTransition',
  NOT_TAKEAWAY: 'error.order.notTakeaway',
  ORDER_ITEM_NOT_FOUND: 'error.order.itemNotFound',
  PRODUCT_INACTIVE: 'error.order.productInactive',
  PRODUCT_NOT_FOUND: 'error.order.productNotFound',
  ORDER_INVARIANT_VIOLATED: 'error.db.checkConstraint',
  RESOURCE_NOT_FOUND: 'error.resource.notFound',
  VALIDATION_ERROR: 'error.validation.failed',
  // ADR-006 §5.2 area lifecycle codes (Sprint 5 Görev 23, ADR-009 Karar 4)
  AREA_NOT_FOUND: 'error.area.notFound',
  AREA_NAME_ALREADY_EXISTS: 'error.area.nameAlreadyExists',
  AREA_SYNC_OCCUPIED: 'error.area.syncOccupied',
  // ADR-009 Amendment 2026-06-30 Karar C(a) — bölge-silme guard. Bölgede
  // aktif-siparişli masa varsa DELETE engellenir (409). Açık adisyonun
  // bölgesiz orphan'a düşüp tahtadan kaybolmasını önler.
  AREA_HAS_ACTIVE_TABLES: 'error.area.hasActiveTables',
  // ADR-006 §5.2 attribute groups codes (Sprint 8c PR-F1, ADR-012)
  ATTRIBUTE_GROUP_NOT_FOUND: 'error.attribute.groupNotFound',
  ATTRIBUTE_GROUP_NAME_ALREADY_EXISTS: 'error.attribute.groupNameDuplicate',
  ATTRIBUTE_OPTION_NOT_FOUND: 'error.attribute.optionNotFound',
  ATTRIBUTE_OPTION_NAME_ALREADY_EXISTS: 'error.attribute.optionNameDuplicate',
  ATTRIBUTE_OPTION_DEFAULT_INVALID: 'error.attribute.optionDefaultInvalid',
  // ADR-013 §10 (PR-6) order item attribute resolution
  MISSING_REQUIRED_ATTRIBUTE: 'error.order.missingRequiredAttribute',
  INVALID_ATTRIBUTE_SELECTION: 'error.order.invalidAttributeSelection',
  // ADR-013 §11 — variant ownership check
  VARIANT_NOT_FOUND: 'error.order.variantNotFound',
  // ADR-014 (PR-7) — payments
  COMP_ITEM_IN_PAYMENT: 'error.payment.compItemInPayment',
  ORDER_ITEM_ALREADY_PAID: 'error.payment.orderItemAlreadyPaid',
  PAYMENT_QTY_EXCEEDS_ORDER_ITEM: 'error.payment.qtyExceedsOrderItem',
  // ADR-014 §9 Karar 9.6 — sipariş iptali
  ORDER_CANCEL_NOT_ALLOWED: 'error.order.cancelNotAllowed',
  // ADR-014 §10 Karar 10.4 — Mod B "Masayı Kapat"
  PAYMENT_INSUFFICIENT_FOR_CLOSE: 'error.payment.insufficientForClose',
  // ADR-014 §12 — /payments *_close overpaid (ödenen > sipariş toplamı)
  PAYMENT_EXCEEDS_TOTAL: 'error.payment.exceedsTotal',
  // ADR-020 K3 (Sprint 12 PR-2) — KDS state machine geçersiz transition.
  // sent → preparing → ready (skip preparing OK). Diğer geçişler 422.
  ORDER_ITEM_INVALID_STATUS_TRANSITION:
    'error.order.itemInvalidStatusTransition',
  // ADR-006 §5.2 tenant settings codes (Sprint 6 Görev 24)
  // SETTINGS_NOT_FOUND defansif (404) — seed garantili olduğundan normal akışta tetiklenmez.
  // SETTINGS_INVALID_TIMEZONE (400) — DB trigger validate_timezone IANA olmayan TZ reject eder.
  SETTINGS_NOT_FOUND: 'error.settings.notFound',
  SETTINGS_INVALID_TIMEZONE: 'error.settings.invalidTimezone',
  // ADR-016 §11 — Customers + Caller ID
  CUSTOMER_NOT_FOUND: 'error.customer.notFound',
  // Session 53 — PATCH /orders/:id/customer; kara listedeki müşteri reddi.
  CUSTOMER_BLACKLISTED: 'error.customer.blacklisted',
  // Session 53 — Migration 028 CHECK defansı; takeaway müşteri kaldırma reddi.
  TAKEAWAY_CUSTOMER_REQUIRED: 'error.order.takeawayCustomerRequired',
  PHONE_INVALID: 'error.customer.phoneInvalid',
  PHONE_NOT_FOUND: 'error.customer.phoneNotFound',
  PHONE_ALREADY_EXISTS: 'error.customer.phoneAlreadyExists',
  CUSTOMER_LAST_PHONE_REQUIRED: 'error.customer.lastPhoneRequired',
  CUSTOMER_ADDRESS_NOT_FOUND: 'error.customer.addressNotFound',
  INVALID_PHONE: 'error.customer.phoneInvalid',
  BRIDGE_TOKEN_INVALID: 'error.bridge.tokenInvalid',
  TENANT_HEADER_INVALID: 'error.bridge.tenantHeaderInvalid',
  CALL_LOG_NOT_FOUND: 'error.callerId.logNotFound',
  CALL_LOG_INVALID_STATUS: 'error.callerId.invalidStatus',
  // PR-8c-3 — Excel import preview cache hataları
  IMPORT_PREVIEW_NOT_FOUND: 'error.customer.importPreviewNotFound',
  IMPORT_PREVIEW_EXPIRED: 'error.customer.importPreviewExpired',
  IMPORT_PREVIEW_FORBIDDEN: 'error.customer.importPreviewForbidden',
  // ADR-021 (Sprint 14 PR-4a) — CSV export 100k row cap aşımı.
  // Client error: range daralt + tekrar dene. 413 değil çünkü request body
  // değil, response büyüklüğü; 400 (RFC 9110 §15.5.1) semantik olarak doğru.
  REPORT_TOO_LARGE: 'error.report.tooLarge',
  // ADR-004 Amendment 1 (Session 63 PR-2) — Print Agent result callback.
  // 404: jobId tenant scope'unda yok. 400: result POST geldi ama job
  // `printing` durumda değil ve idempotent no-op koşuluna da uymuyor
  // (ör. queued/retry/failed durumda result almak).
  PRINT_JOB_NOT_FOUND: 'error.print.jobNotFound',
  PRINT_JOB_NOT_IN_PRINTING_STATE: 'error.print.jobNotInPrintingState',
  // ADR-004 Amendment 2 (Session 62 PR-3a) — Print Agent auth backbone.
  // AUTH_TOKEN_MISSING (401) — Authorization header yok / Bearer prefix yok.
  // AGENT_REVOKED (401) — JWT geçerli ama agents.revoked_at IS NOT NULL.
  // AGENT_FINGERPRINT_CONFLICT (409) — aynı device fingerprint başka tenant'ta.
  // AUTH_TOKEN_INVALID / AUTH_REFRESH_INVALID zaten ADR-002 §2'den reuse.
  AUTH_TOKEN_MISSING: 'error.auth.tokenMissing',
  AGENT_REVOKED: 'error.printAgent.revoked',
  AGENT_FINGERPRINT_CONFLICT: 'error.printAgent.fingerprintConflict',
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
