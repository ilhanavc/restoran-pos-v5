import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';

/**
 * Menü Kategorileri admin API hooks — Sprint 8c PR-D1.
 *
 * Backend endpoint'leri (apps/api/src/routes/menu.ts):
 *   GET    /menu/categories      → { data: { categories: ApiCategory[] } }
 *   POST   /menu/categories      → { data: { category: ApiCategory } }, 201
 *   PATCH  /menu/categories/:id  → { data: { category: ApiCategory } }
 *   DELETE /menu/categories/:id  → 204
 *
 * `icon` ve `color` alanları Migration 012 + ADR-011 Amendment 2026-05-01
 * (Karar 2 + Karar 3) kapsamında zorunlu DB kolonları (DEFAULT'lu).
 *
 * Ürün sayısı (V3 "PİDELER 2 ürün" paritesi) /products listesinden client-side
 * group by category_id ile türetilir — yeni endpoint açılmadı (PR-E'de aktive
 * olacak ürün grid'i ile aynı kaynak).
 */
export interface ApiCategory {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
  icon: string;
  color: string;
}

interface CategoriesListResponse {
  data: { categories: ApiCategory[] };
}

interface CategorySingleResponse {
  data: { category: ApiCategory };
}

const CATEGORIES_ADMIN_KEY = ['categories', 'admin'] as const;

export function useCategoriesAdmin() {
  return useQuery({
    queryKey: CATEGORIES_ADMIN_KEY,
    queryFn: async (): Promise<ApiCategory[]> => {
      const res = await api.get<CategoriesListResponse>('/menu/categories');
      return res.data.data.categories;
    },
    staleTime: 30_000,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      name: string;
      sortOrder?: number;
      icon?: string;
      color?: string;
    }): Promise<ApiCategory> => {
      const res = await api.post<CategorySingleResponse>('/menu/categories', vars);
      return res.data.data.category;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      name?: string;
      sortOrder?: number;
      icon?: string;
      color?: string;
    }): Promise<ApiCategory> => {
      const { id, ...patch } = vars;
      const res = await api.patch<CategorySingleResponse>(`/menu/categories/${id}`, patch);
      return res.data.data.category;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/menu/categories/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
