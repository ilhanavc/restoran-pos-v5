import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';

/**
 * Users admin API hooks — Görev 35 (Session 49).
 *
 * Backend: apps/api/src/routes/users.ts (PR #35).
 * Tüm uçlar admin-only (PATCH /:id/password kendi kullanıcı için açık ama
 * UI sadece admin tarafından çağırır).
 *
 * Kapsam (MVP):
 *   - Liste, oluştur, güncelle (email/role/name), soft-delete, şifre sıfırla
 *
 * v5.1+:
 *   - Pagination (max 500 hard-cap MVP'de yeterli)
 *   - Arama / filtreleme
 *   - 2FA, login geçmişi
 */

export type UserRole = 'admin' | 'cashier' | 'waiter' | 'kitchen';

export interface ApiUser {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  name: string;
  createdAt: string;
}

interface UsersListResponse {
  data: { users: ApiUser[] };
}

interface UserSingleResponse {
  data: { user: ApiUser };
}

const USERS_KEY = ['users'] as const;

export function useUsers() {
  return useQuery({
    queryKey: USERS_KEY,
    queryFn: async (): Promise<ApiUser[]> => {
      const res = await api.get<UsersListResponse>('/users');
      return res.data.data.users;
    },
    staleTime: 30_000,
  });
}

export interface CreateUserInput {
  email: string;
  password: string;
  role: UserRole;
  name: string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput): Promise<ApiUser> => {
      const res = await api.post<UserSingleResponse>('/users', input);
      return res.data.data.user;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USERS_KEY });
    },
  });
}

export interface UpdateUserInput {
  id: string;
  patch: {
    email?: string;
    role?: UserRole;
    name?: string;
  };
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateUserInput): Promise<ApiUser> => {
      const res = await api.patch<UserSingleResponse>(`/users/${id}`, patch);
      return res.data.data.user;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USERS_KEY });
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/users/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USERS_KEY });
    },
  });
}

export interface ResetPasswordInput {
  id: string;
  newPassword: string;
}

/**
 * Admin başka kullanıcının şifresini sıfırlar (currentPassword opsiyonel).
 * Self-password change UI MVP dışı — yalnız admin reset.
 */
export function useResetUserPassword() {
  return useMutation({
    mutationFn: async ({ id, newPassword }: ResetPasswordInput): Promise<void> => {
      await api.patch(`/users/${id}/password`, { newPassword });
    },
  });
}
