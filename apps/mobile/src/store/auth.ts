import * as SecureStore from 'expo-secure-store';
import type { LoginResponse, UserPublic } from '@restoran-pos/shared-types';
import { create } from 'zustand';

/**
 * Auth store (ADR-026 K4/K9).
 *
 * Tokens live in `expo-secure-store` (OS keychain / keystore — encrypted at
 * rest), never in plain storage and never logged (KVKK / no-PII rule). The
 * in-memory store mirrors the persisted state for fast synchronous reads by the
 * navigator gate. PR-5a stores the refresh token but does NOT yet perform a
 * refresh round-trip — silent refresh transport is PR-5d.
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
  isAuthenticated: boolean;
  /** Last successfully used e-mail; prefilled on the login screen. */
  lastEmail: string | null;
  /** Persist tokens + e-mail and flip the navigator gate. */
  login: (response: LoginResponse) => Promise<void>;
  /** Clear tokens (keep lastEmail) and reset to the unauthenticated state. */
  logout: () => Promise<void>;
  /** Read persisted token + last e-mail on app start (best-effort). */
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
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
      isAuthenticated: true,
      lastEmail: response.user.email,
    });
  },

  logout: async () => {
    // Tokens are cleared; lastEmail is intentionally KEPT so the next login
    // prefills the e-mail (remember-me convenience).
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  hydrate: async () => {
    // No persisted UserPublic in PR-5a: a stored access token only flips the
    // gate to "authenticated" so the splash can route past Login. The full
    // user profile is repopulated on the next real login/refresh (PR-5d).
    const [accessToken, lastEmail] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(LAST_EMAIL_KEY),
    ]);
    if (accessToken !== null) {
      set({ accessToken, isAuthenticated: true, lastEmail });
    } else {
      set({ lastEmail });
    }
  },
}));
