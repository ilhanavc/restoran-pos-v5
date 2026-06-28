import * as SecureStore from 'expo-secure-store';
import type { LoginResponse, UserPublic } from '@restoran-pos/shared-types';
import { create } from 'zustand';

/**
 * Auth store (ADR-026 K4/K9).
 *
 * Tokens live in `expo-secure-store` (OS keychain / keystore — encrypted at
 * rest), never in plain AsyncStorage and never logged (KVKK / no-PII rule). The
 * in-memory store mirrors the persisted state for fast synchronous reads by the
 * navigator gate. PR-5a stores the refresh token but does NOT yet perform a
 * refresh round-trip — silent refresh transport is PR-5d.
 */

const ACCESS_TOKEN_KEY = 'auth.accessToken';
const REFRESH_TOKEN_KEY = 'auth.refreshToken';

interface AuthState {
  user: UserPublic | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  /** Persist tokens to secure storage and flip the navigator gate. */
  login: (response: LoginResponse) => Promise<void>;
  /** Clear secure storage and reset to the unauthenticated state. */
  logout: () => Promise<void>;
  /** Read the persisted access token on app start (best-effort). */
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,

  login: async (response) => {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, response.accessToken);
    if (response.refreshToken !== undefined) {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, response.refreshToken);
    }
    set({
      user: response.user,
      accessToken: response.accessToken,
      isAuthenticated: true,
    });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  hydrate: async () => {
    // No persisted UserPublic in PR-5a: a stored access token only flips the
    // gate to "authenticated" so the splash can route past Login. The full
    // user profile is repopulated on the next real login/refresh (PR-5d).
    const accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    if (accessToken !== null) {
      set({ accessToken, isAuthenticated: true });
    }
  },
}));
