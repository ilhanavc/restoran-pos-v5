import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

/**
 * Menü read-only API hook'ları — Sprint 8c PR #2.
 *
 * Backend kontratı (camelCase, ADR-003 §8.6 K1):
 *  - GET /menu/categories → { data: { categories: ApiCategory[] } }
 *  - GET /products        → { data: { products: ApiProduct[] } }
 *
 * NOT: `description` ve `is_active` MVP DB şemasında yok. Aktiflik =
 * `deletedAt === null`. Pasif ürünleri liste API zaten döndürmüyor (soft
 * delete filtresi repo katmanında), bu yüzden "Pasif" badge defansif kalır.
 */

export interface ApiCategoryRaw {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiVariant {
  id: string;
  tenantId: string;
  productId: string;
  name: string;
  priceDeltaCents: number;
  isDefault: boolean;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiProduct {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  /** INTEGER MINOR UNIT (kuruş) — float yasak (CLAUDE.md "Asla"). */
  priceCents: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  variants: ApiVariant[];
}

interface CategoriesResponse {
  data: { categories: ApiCategoryRaw[] };
}

interface ProductsResponse {
  data: { products: ApiProduct[] };
}

const CATEGORIES_KEY = ['menu', 'categories'] as const;
const PRODUCTS_KEY = ['menu', 'products'] as const;

export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: async (): Promise<ApiCategoryRaw[]> => {
      const res = await api.get<CategoriesResponse>('/menu/categories');
      return res.data.data.categories;
    },
    staleTime: 60_000,
  });
}

export function useProducts() {
  return useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: async (): Promise<ApiProduct[]> => {
      const res = await api.get<ProductsResponse>('/products');
      return res.data.data.products;
    },
    staleTime: 60_000,
  });
}
