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
  /**
   * ADR-020 K2 — "mutfağa gider mi": KDS görünürlüğü + mutfak fişi tetiği.
   * Backend `selectAll()` ile zaten dönüyordu, tipte eksikti. Yazıcı istasyon
   * atama paneli (ADR-032 Amd2) bu bayrağı okur — yalnız `true` olan kategori
   * bir istasyona atanabilir.
   */
  kitchen_print: boolean;
  /**
   * ADR-032 Amd1 — "hangi mutfak yazıcısı": NULL = taban istasyon (FIRIN).
   * `kitchen_print`ten ORTOGONAL. Yalnız enqueue + yazıcı atama paneli okur.
   */
  print_station: string | null;
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

/**
 * Session 85 — kategori bulk sıralama ("Kategorileri Sırala").
 * POST /menu/categories/reorder { categoryIds } — dizi index'i yeni sort_order.
 * `useReorderProducts` paritesi; onSuccess ['categories'] invalidate → sipariş
 * ekranı + admin canlı tazelenir (realtime `categories.changed` da tetikler).
 */
export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (categoryIds: string[]): Promise<void> => {
      await api.post('/menu/categories/reorder', { categoryIds });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

/* ─────────────────────── Category ↔ Attribute Group ──────────────────────────
 * Backend: apps/api/src/routes/attribute-groups.ts categoryAttributesRouter (ADR-012).
 * Mount: /menu/categories/:id/attribute-groups (DİKKAT: /menu/ prefix'li — ürün
 * versiyonu /products/:id/... ile karışmasın).
 *   GET    /                  → { data: { links: ApiCategoryAttributeGroupLink[] } }
 *   POST   /:groupId          → 200 idempotent assign (admin)
 *   DELETE /:groupId          → 204 (admin)
 *
 * Ürün versiyonundan (menu-products/api.ts) fark: kategori gruplarında miras /
 * effective YOK — hepsi doğrudan link. Bu yüzden `effective` query gerekmez.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ApiCategoryAttributeGroupLink {
  id: string;
  category_id: string;
  group_id: string;
  sort_order: number;
}

interface CategoryAttributeLinksResponse {
  data: { links: ApiCategoryAttributeGroupLink[] };
}

export function useCategoryAttributeGroupLinks(categoryId: string | null) {
  return useQuery({
    queryKey: ['menu-categories', categoryId, 'attribute-groups'],
    queryFn: async (): Promise<ApiCategoryAttributeGroupLink[]> => {
      const res = await api.get<CategoryAttributeLinksResponse>(
        `/menu/categories/${categoryId}/attribute-groups`,
      );
      return res.data.data.links;
    },
    enabled: categoryId !== null && categoryId !== '',
    staleTime: 30_000,
  });
}

/**
 * Kategoriye özellik grubu bağla. Idempotent (backend zaten bağlıysa 200 no-op).
 * onSuccess: link listesini + `['products']`'ı invalidate — kategori ataması
 * ürünlerin effective grubunu etkiler, sipariş ekranı taze görsün.
 */
export function useLinkCategoryAttributeGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { categoryId: string; groupId: string }): Promise<void> => {
      await api.post(`/menu/categories/${vars.categoryId}/attribute-groups/${vars.groupId}`);
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['menu-categories', vars.categoryId, 'attribute-groups'],
      });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/** Kategoriden özellik grubu kaldır (204 idempotent). Aynı invalidation. */
export function useUnlinkCategoryAttributeGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { categoryId: string; groupId: string }): Promise<void> => {
      await api.delete(`/menu/categories/${vars.categoryId}/attribute-groups/${vars.groupId}`);
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['menu-categories', vars.categoryId, 'attribute-groups'],
      });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
