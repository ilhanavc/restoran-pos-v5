import { RefreshResponseSchema } from '@restoran-pos/shared-types';

import { API_BASE_URL } from '../config';
import { useAuthStore } from '../store/auth';
import { ApiError } from './errors';

/**
 * Low-level HTTP transport (ADR-026 K8 + Amendment 2026-06-29 PR-5d C).
 *
 * A thin `fetch` wrapper (no axios) that mirrors the web client's contract:
 *  - injects `Authorization: Bearer <accessToken>` from the in-memory auth store,
 *  - normalizes the backend error envelope `{ error: { code } }` into an
 *    {@link ApiError} carrying just the code (never PII / never the body),
 *  - on a 401 runs a SINGLE-FLIGHT silent refresh (mobile body-refresh: header
 *    `X-Refresh-Request: 1` + `{ refreshToken }`), rotates the stored tokens and
 *    retries the original request once; if refresh fails it logs the waiter out
 *    so the navigator gate falls back to Login.
 *
 * Transport failures (no connection / timeout) surface as `ApiError('NETWORK_ERROR')`
 * so screens show a "check your connection" message rather than a wrong-password one.
 */

const REFRESH_PATH = '/auth/refresh';
const LOGIN_PATH = '/auth/login';
const REQUEST_TIMEOUT_MS = 15_000;

/** Transport-layer error code (no backend equivalent — local only). */
const NETWORK_ERROR = 'NETWORK_ERROR';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /**
   * Gövde NESNE olarak verilir — `apiRequest` kendisi `JSON.stringify` eder.
   * Önceden `unknown`'dı; çağıran yanlışlıkla stringify edilmiş bir değer
   * geçince (`JSON.stringify({...})`) gövde çift kodlanıp üst-seviye JSON
   * string'ine dönüşüyor, `express.json({strict})` bunu reddediyordu → istek
   * sunucuya hiç ulaşmadan patlıyordu. `object` tipi bunu derleme anında
   * imkânsız kılar (string primitive'i atanamaz).
   */
  body?: object;
  /** Attach the Bearer access token (default true). Login/refresh pass false. */
  auth?: boolean;
  /** Extra request headers (e.g. `X-Client: mobile` on login). */
  headers?: Record<string, string>;
  /** Internal: set on the post-refresh retry to prevent an infinite loop. */
  _retry?: boolean;
}

/** Single-flight guard: concurrent 401s share one refresh round-trip. */
let refreshPromise: Promise<string> | null = null;

/** Map a non-2xx Response to an ApiError carrying the backend error code. */
async function toApiError(res: Response): Promise<ApiError> {
  let code = `HTTP_${String(res.status)}`;
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    if (typeof body.error?.code === 'string') {
      code = body.error.code;
    }
  } catch {
    // Non-JSON error body — keep the generic HTTP_<status> code.
  }
  return new ApiError(code);
}

async function performRefresh(): Promise<string> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (refreshToken === null) {
    throw new ApiError('AUTH_REFRESH_INVALID');
  }
  const res = await fetch(`${API_BASE_URL}${REFRESH_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // CSRF-lite guard required by the backend (auth.ts).
      'X-Refresh-Request': '1',
    },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  const parsed = RefreshResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ApiError('AUTH_REFRESH_INVALID');
  }
  await useAuthStore
    .getState()
    .setTokens(parsed.data.accessToken, parsed.data.refreshToken);
  return parsed.data.accessToken;
}

/**
 * Perform a JSON request and return the parsed body (or `undefined` for 204).
 * Throws {@link ApiError} on a non-2xx response or transport failure.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, headers = {}, _retry = false } =
    options;

  const finalHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token !== null) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // Aborted (timeout) or network failure — no PII to surface.
    throw new ApiError(NETWORK_ERROR);
  } finally {
    clearTimeout(timeoutId);
  }

  // 401 → single-flight refresh + retry once (auth endpoints excluded).
  if (
    res.status === 401 &&
    auth &&
    !_retry &&
    path !== REFRESH_PATH &&
    path !== LOGIN_PATH
  ) {
    try {
      refreshPromise ??= performRefresh().finally(() => {
        refreshPromise = null;
      });
      await refreshPromise;
    } catch {
      await useAuthStore.getState().logout();
      throw new ApiError('AUTH_TOKEN_INVALID');
    }
    return apiRequest<T>(path, { ...options, _retry: true });
  }

  if (!res.ok) {
    throw await toApiError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
