import type { LoginRequest, LoginResponse } from '@restoran-pos/shared-types';
import { USE_MOCK } from '../config';
import { mockLogin } from '../mock/auth';

/**
 * API client (ADR-026 K8).
 *
 * Thin seam between the screens and the network. While `USE_MOCK` is `true` it
 * delegates to the in-process mock layer; flipping the flag (PR-5d) swaps in a
 * real `fetch` against `API_BASE_URL` without touching any screen. PR-5a only
 * needs `login`.
 */

/** Authenticate the waiter. Throws on invalid credentials or transport error. */
export async function login(request: LoginRequest): Promise<LoginResponse> {
  if (USE_MOCK) {
    return mockLogin(request);
  }
  // Real transport lands in PR-5d (fetch against API_BASE_URL + zod parse).
  throw new Error('Real API transport not implemented yet (PR-5d).');
}
