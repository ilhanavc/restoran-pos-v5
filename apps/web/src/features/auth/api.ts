import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore, type AuthUser } from '../../store/auth';
import { connectSocket, disconnectSocket } from '../../lib/socket';
import type { LoginRequest } from '@restoran-pos/shared-types';

interface LoginResponseDto {
  accessToken: string;
  user: AuthUser;
}

interface RefreshResponseDto {
  accessToken: string;
  user?: AuthUser;
}

interface MeResponseDto {
  user?: AuthUser;
  data?: { user?: AuthUser };
}

/**
 * Mount-time auth bootstrap (ADR-011 §3): cookie ile sessiz refresh + /me.
 * Sayfa yenilemede memory store sıfırlanır — refresh httpOnly cookie hâlâ
 * geçerliyse oturumu kesintisiz devam ettir, değilse /login'e bırak.
 *
 * `isReady` true olana kadar route render edilmemeli (white-flash login
 * önlenir). Bootstrap idempotent — strict mode double-mount güvenli.
 */
export function useAuthBootstrap(): { isReady: boolean } {
  const [isReady, setIsReady] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    let cancelled = false;
    // Already authenticated (login flow yarattı) — bootstrap atla.
    if (accessToken !== null) {
      setIsReady(true);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const refreshRes = await api.post<RefreshResponseDto>('/auth/refresh');
        const newToken = refreshRes.data.accessToken;
        let user = refreshRes.data.user;
        if (!user) {
          const meRes = await api.get<MeResponseDto>('/auth/me');
          user = meRes.data.user ?? meRes.data.data?.user;
        }
        if (!cancelled && user) {
          setAuth(newToken, user);
          connectSocket(newToken);
        }
      } catch {
        // 401 / network — kullanıcı zaten unauth, /login'e düşer.
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Bootstrap tek seferlik — accessToken değişiminde re-run gereksiz.
  }, []);

  return { isReady };
}

/**
 * Login mutation.
 * On success: persist token+user in Zustand and open the realtime socket.
 * Errors propagate to the caller (LoginPage maps them to a toast via getErrorMessage).
 */
export function useLogin() {
  return useMutation({
    mutationFn: async (vars: LoginRequest): Promise<LoginResponseDto> => {
      const res = await api.post<LoginResponseDto>('/auth/login', vars);
      return res.data;
    },
    onSuccess: (data) => {
      useAuthStore.getState().setAuth(data.accessToken, data.user);
      connectSocket(data.accessToken);
    },
  });
}

/** Best-effort logout — clears local session even if the network call fails. */
export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout');
    },
    onSettled: () => {
      disconnectSocket();
      useAuthStore.getState().clearAuth();
    },
  });
}
