import { create } from 'zustand';

/**
 * Authenticated user payload — kept in memory (never persisted to localStorage).
 * Refresh token lives in httpOnly cookie (ADR-002 §3, ADR-011 §3).
 */
export interface AuthUser {
  id: string;
  email: string;
  tenantId: string;
  role: 'admin' | 'cashier' | 'waiter' | 'kitchen';
  fullName?: string;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  setAccessToken: (token: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAuth: (accessToken, user) => set({ accessToken, user }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clearAuth: () => set({ accessToken: null, user: null }),
}));
