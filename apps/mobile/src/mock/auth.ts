import type { LoginRequest, LoginResponse } from '@restoran-pos/shared-types';

import { ApiError, AUTH_INVALID_CREDENTIALS } from '../api/errors';

/**
 * Mock authentication backend (ADR-026 K8).
 *
 * Lets the login → tables → logout flow run on a physical phone with no live
 * API. Replaced by the real transport in PR-5d (USE_MOCK = false). The single
 * demo account below is documented in the PR description; it is NOT a real
 * credential and never reaches a backend.
 */

const DEMO_EMAIL = 'ahmet@restoran.com';
const DEMO_PASSWORD = '1234';
const MOCK_DELAY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Simulate `POST /auth/login`. Resolves with a waiter `LoginResponse` for the
 * demo account, or rejects with an {@link ApiError} on any other credential.
 */
export async function mockLogin(request: LoginRequest): Promise<LoginResponse> {
  await delay(MOCK_DELAY_MS);

  const matches =
    request.email.trim().toLowerCase() === DEMO_EMAIL &&
    request.password === DEMO_PASSWORD;

  if (!matches) {
    throw new ApiError(AUTH_INVALID_CREDENTIALS);
  }

  return {
    accessToken: 'mock-access-token',
    expiresIn: 900,
    refreshToken: 'mock-refresh-token',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: '00000000-0000-4000-8000-0000000000ff',
      email: DEMO_EMAIL,
      role: 'waiter',
      name: 'Ahmet Garson',
      createdAt: '2026-06-28T00:00:00.000Z',
    },
  };
}
