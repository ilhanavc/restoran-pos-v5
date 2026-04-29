import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore, type AuthUser } from '../../store/auth';
import { connectSocket, disconnectSocket } from '../../lib/socket';
import type { LoginRequest } from '@restoran-pos/shared-types';

interface LoginResponseDto {
  accessToken: string;
  user: AuthUser;
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
