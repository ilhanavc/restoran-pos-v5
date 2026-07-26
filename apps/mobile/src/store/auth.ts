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
/**
 * S105 — kullanıcı profili (id/ad/rol) artık KALICI.
 *
 * Eskiden yalnız token saklanıyordu; uygulama yeniden başladığında `user`
 * `null` kalıyordu. Bu, kimliğe/role bağlı HER özelliği sessizce bozuyordu:
 * S104'te "hep Kilitli" rozeti (#461) bu yüzden çıktı, S105'te de yönetici
 * ciro göstergesi aynı tuzağa düştü (admin oturumunda bile görünmedi).
 * SecureStore şifreli (Keychain/Keystore); e-posta zaten `auth.lastEmail`
 * ile saklanıyordu — yeni bir PII sınıfı eklemiyor.
 */
const USER_KEY = 'auth.user';

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
  /** Read persisted tokens + profile + last e-mail on app start (best-effort). */
  hydrate: () => Promise<void>;
  /** S105 — sunucudan tazelenen profili yaz (rol değişimi + eski oturum boşluğu). */
  setUser: (user: UserPublic) => Promise<void>;
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
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(response.user));
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
    await SecureStore.deleteItemAsync(USER_KEY);
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },

  setUser: async (user) => {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    set({ user });
  },

  hydrate: async () => {
    // S105 — kullanıcı profili de geri yüklenir (eskiden YALNIZ token'lar
    // dönüyordu, `user` null kalıyordu → role/kimliğe bağlı her özellik
    // uygulama yeniden açıldığında sessizce kapanıyordu). Bozuk/eski kayıt
    // uygulamayı açılışta çökertmesin diye parse try/catch ile korunur.
    const [accessToken, refreshToken, lastEmail, userRaw] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.getItemAsync(LAST_EMAIL_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    let user: UserPublic | null = null;
    if (userRaw !== null) {
      try {
        user = JSON.parse(userRaw) as UserPublic;
      } catch {
        user = null;
      }
    }
    if (accessToken !== null) {
      set({ user, accessToken, refreshToken, isAuthenticated: true, lastEmail });
    } else {
      set({ lastEmail });
    }
  },
}));
