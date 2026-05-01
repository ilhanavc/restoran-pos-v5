import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';

/**
 * Menü Ürünleri admin API hooks — Sprint 8c PR-E.
 *
 * Backend endpoint'leri (apps/api/src/routes/products.ts, Sprint 3b PR #37):
 *   GET    /products      → { data: { products: ApiProduct[] } } (variants nested)
 *   POST   /products      → { data: { product: ApiProduct } }, 201
 *   PATCH  /products/:id  → { data: { product: ApiProduct } }
 *   DELETE /products/:id  → 204 (cascade soft delete; variants de soft-deleted)
 *
 * PR-E kapsam kilidi: sadece ad + fiyat + kategori. Variants editing PR-F3a/b'ye
 * ertelendi (active-plan AÇIK İŞLER §iii). Backend variants opsiyonel kabul
 * ediyor; bu hook'larda variants gönderilmez.
 */
export interface ApiProductVariant {
  id: string;
  productId: string;
  name: string;
  priceDeltaCents: number;
  isDefault: boolean;
  sortOrder: number;
}

export interface ApiProduct {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  priceCents: number;
  description: string | null;
  barcode: string | null;
  isActive: boolean;
  variants: ApiProductVariant[];
}

interface ProductsListResponse {
  data: { products: ApiProduct[] };
}

interface ProductSingleResponse {
  data: { product: ApiProduct };
}

const PRODUCTS_ADMIN_KEY = ['products', 'admin'] as const;

export function useProductsAdmin() {
  return useQuery({
    queryKey: PRODUCTS_ADMIN_KEY,
    queryFn: async (): Promise<ApiProduct[]> => {
      const res = await api.get<ProductsListResponse>('/products');
      return res.data.data.products;
    },
    staleTime: 30_000,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      categoryId: string;
      name: string;
      priceCents: number;
      description?: string | null;
      barcode?: string | null;
      isActive?: boolean;
      variants?: Array<{
        id?: string;
        name: string;
        priceDeltaCents: number;
        isDefault: boolean;
        sortOrder: number;
      }>;
    }): Promise<ApiProduct> => {
      const res = await api.post<ProductSingleResponse>('/products', vars);
      return res.data.data.product;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      categoryId?: string;
      name?: string;
      priceCents?: number;
      description?: string | null;
      barcode?: string | null;
      isActive?: boolean;
      variants?: Array<{
        id?: string;
        name: string;
        priceDeltaCents: number;
        isDefault: boolean;
        sortOrder: number;
      }>;
    }): Promise<ApiProduct> => {
      const { id, ...patch } = vars;
      const res = await api.patch<ProductSingleResponse>(`/products/${id}`, patch);
      return res.data.data.product;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/products/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
