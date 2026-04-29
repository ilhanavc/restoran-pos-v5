import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { env } from './env';
import { useAuthStore } from '../store/auth';

/**
 * Axios instance for the cloud backend.
 * - withCredentials: true → refresh httpOnly cookie is sent automatically.
 * - Authorization header injected from in-memory access token (Zustand).
 * - 401 interceptor: single-flight refresh + retry; on refresh failure → clear + redirect.
 *
 * ADR-002 §3 (token transport), ADR-011 §3 (auth flow).
 */
export const api = axios.create({
  baseURL: env.VITE_API_BASE_URL,
  withCredentials: true,
  timeout: 15_000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

interface RetryableConfig extends AxiosRequestConfig {
  _retry?: boolean;
  url?: string;
}

let refreshPromise: Promise<string> | null = null;

async function performRefresh(): Promise<string> {
  // Plain axios call (no interceptor recursion).
  const res = await axios.post<{ accessToken: string }>(
    `${env.VITE_API_BASE_URL}/auth/refresh`,
    {},
    { withCredentials: true },
  );
  const newToken = res.data.accessToken;
  useAuthStore.getState().setAccessToken(newToken);
  return newToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetryableConfig | undefined;
    const status = error.response?.status;

    const isRefreshable =
      status === 401 &&
      !!original &&
      !original._retry &&
      original.url !== '/auth/refresh' &&
      original.url !== '/auth/login';

    if (!isRefreshable) {
      return Promise.reject(error);
    }

    original._retry = true;

    refreshPromise ??= performRefresh().finally(() => {
      refreshPromise = null;
    });

    try {
      const token = await refreshPromise;
      const headers = original.headers ?? {};
      // axios v1 supports plain object header assignment.
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
      original.headers = headers;
      return api(original);
    } catch (refreshErr) {
      useAuthStore.getState().clearAuth();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(refreshErr);
    }
  },
);
