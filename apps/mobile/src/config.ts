/**
 * Mobile app runtime configuration (ADR-026 K8).
 *
 * PR-5a ships with a mock data layer so the full UI flow (login → tables →
 * logout) can be exercised on a physical phone without a live backend. Flip
 * `USE_MOCK` to `false` once the real API transport lands (PR-5d). The mobile
 * waiter app is Turkish-only, single-tenant for MVP (CLAUDE.md scope lock).
 */
export const USE_MOCK = true;

/**
 * Base URL of the cloud API. Unused while `USE_MOCK` is `true`; kept here so the
 * switch to the real transport is a one-line config change, not a refactor.
 */
export const API_BASE_URL = 'http://localhost:3000';
