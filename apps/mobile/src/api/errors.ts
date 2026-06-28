/**
 * Normalized API errors (ADR-026 K8).
 *
 * Both the mock layer (PR-5a) and the real transport (PR-5d) throw `ApiError`
 * carrying a domain error code (never PII). Screens map the code to a localized
 * message, so error handling does not depend on whether `USE_MOCK` is on.
 */

/** Wrong e-mail/password — mirrors the backend `AUTH_INVALID_CREDENTIALS`. */
export const AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS';

/** Carries a backend/domain error code instead of a user-facing string. */
export class ApiError extends Error {
  public readonly code: string;
  public constructor(code: string) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
  }
}

/** Type guard so screens can branch on the error code without `any`. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
