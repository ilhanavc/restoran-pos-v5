/**
 * Normalized API errors (ADR-026 K8).
 *
 * Both the mock layer (PR-5a) and the real transport (PR-5d) throw `ApiError`
 * carrying a domain error code (never PII). Screens map the code to a localized
 * message, so error handling does not depend on whether `USE_MOCK` is on.
 */

/** Wrong e-mail/password — mirrors the backend `AUTH_INVALID_CREDENTIALS`. */
export const AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS';

/**
 * `/login` brute-force limiters tripped — mirrors the backend `AUTH_RATE_LIMITED`.
 * İKİ kova bu kodu döndürür ve ikisinin de penceresi **15 dakika**:
 * `loginStrictLimiter` (5/15dk, IP + e-posta) ve `loginVolumeLimiter` (30/15dk, IP).
 * Bu yüzden mesajı "15 dakika" diyebilir.
 */
export const AUTH_RATE_LIMITED = 'AUTH_RATE_LIMITED';

/**
 * Router-seviyesi taban kova tripped (60/dk, per-IP, tüm `/auth/*`) — mirrors the
 * backend `AUTH_BASELINE_RATE_LIMITED`. AYRI koddur çünkü penceresi **60 saniye**:
 * `AUTH_RATE_LIMITED`'ın "15 dakika" metni burada yanıltıcı olurdu
 * (ADR-002 Amd8 madde 131, S141'de kapandı).
 */
export const AUTH_BASELINE_RATE_LIMITED = 'AUTH_BASELINE_RATE_LIMITED';

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
