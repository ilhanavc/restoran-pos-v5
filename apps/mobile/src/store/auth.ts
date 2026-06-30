import * as SecureStore from 'expo-secure-store';
import type { LoginResponse, UserPublic } from '@restoran-pos/shared-types';
import { create } from 'zustand';

/**
 * Auth store (ADR-026 K4/K9 + Amendment 2026-06-29 PR-5d C).
 *
 * Tokens live in `expo-secure-store` (OS keychain / keystore — encrypted at
 * rest) AND mirrored in memory for synchronous reads by the navigator gate and
 * the fetch wrapper (which injects the access token and, on a 401, rotates via
 * the refresh token). Tokens are never logged (KVKK / no-PII rule). Unlike the
 * web (HttpOnly refresh cookie), the mobile refresh token is body-sourced
 * (ADR-002 §2.1), so it must be readable by JS — held here and persisted.
 *
 * `lastEmail` is kept across logouts (a "remember me" convenience): the next
 * login prefills the e-mail so the waiter re-enters only the password. It is
 * the waiter's own e-mail on the waiter's own device, encrypted at rest.
 */

const ACCESS_TOKEN_KEY = 'auth.accessToken';
const REFRESH_TOKEN_KEY = 'auth.refreshToken';
const LAST_EMAIL_KEY = 'auth.lastEmail';

interface AuthState {
  user: UserPublic | null;
  accessToken: string | null;
  /** Body-sourced refresh token (mobile) — used for silent 401 refresh. */
  refreshToken: string | null;
  isAuthenticated: boolean;
  /** Last successfully used e-mail; prefilled on the login screen. */
  lastEmail: string | null;
  /** Persist tokens + e-mail and flip the navigator gate. */
  login: (response: LoginResponse) => Promise<void>;
  /**
   * Replace the access token (and, when rotated, the refresh token) after a
   * silent refresh. Persists to secure-store; does NOT touch the gate/user.
   */
  setTokens: (accessToken: string, refreshToken?: string) => Promise<void>;
  /** Clear tokens (keep lastEmail) and reset to the unauthenticated state. */
  logout: () => Promise<void>;
  /** Read persisted tokens + last e-mail on app start (best-effort). */
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  lastEmail: null,

  login: async (response) => {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, response.accessToken);
    if (response.refreshToken !== undefined) {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, response.refreshToken);
    }
    if (response.user.email !== null) {
      await SecureStore.setItemAsync(LAST_EMAIL_KEY, response.user.email);
    }
    set({
      user: response.user,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken ?? null,
      isAuthenticated: true,
      lastEmail: response.user.email,
    });
  },

  setTokens: async (accessToken, refreshToken) => {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
    if (refreshToken !== undefined) {
      // Refresh Token Rotation: persist the rotated token so the next refresh
      // uses the current family member (ADR-002 §4.3).
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
    }
    set((state) => ({
      accessToken,
      refreshToken: refreshToken ?? state.refreshToken,
    }));
  },

  logout: async () => {
    // Tokens are cleared; lastEmail is intentionally KEPT so the next login
    // prefills the e-mail (remember-me convenience).
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },

  hydrate: async () => {
    // No persisted UserPublic: a stored access token only flips the gate to
    // "authenticated" so the splash can route past Login. The full user profile
    // is repopulated on the next real login (or stays null until then — screens
    // that need the user id read it after login). The refresh token is restored
    // so a stored session can silently refresh an expired access token.
    const [accessToken, refreshToken, lastEmail] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.getItemAsync(LAST_EMAIL_KEY),
    ]);
    if (accessToken !== null) {
      set({ accessToken, refreshToken, isAuthenticated: true, lastEmail });
    } else {
      set({ lastEmail });
    }
  },
}));
