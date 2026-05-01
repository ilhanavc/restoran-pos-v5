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
  sortOrder: number;
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

/**
 * Bulk reorder — Sprint 8c PR-E4.
 * Backend: POST /menu/categories/:categoryId/products/reorder
 * Body: { productIds: string[] } → tenant + category scoped UPDATE.
 */
export function useReorderProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      categoryId: string;
      productIds: string[];
    }): Promise<void> => {
      await api.post(
        `/menu/categories/${vars.categoryId}/products/reorder`,
        { productIds: vars.productIds },
      );
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

/* ───────────────────────────── Product ↔ Attribute Group ─────────────────────
 * Backend: apps/api/src/routes/attribute-groups.ts productAttributesRouter
 * Mount: /products/:id/attribute-groups (Sprint 8c PR-F1c1).
 *   GET    /                  → { data: { links: ApiProductAttributeGroupLink[] } }
 *   GET    /effective         → { data: { groups: ApiAttributeGroupEffective[] } }
 *   POST   /:groupId          → 200 idempotent assign
 *   DELETE /:groupId          → 204
 * ────────────────────────────────────────────────────────────────────────── */

export interface ApiProductAttributeGroupLink {
  id: string;
  product_id: string;
  group_id: string;
  sort_order: number;
}

/**
 * Effective attribute group ürün için: direkt link veya kategori bazlı miras.
 * `source` alanı 'product' veya 'category' — UI'da rozet gösterimi için.
 */
export interface ApiAttributeGroupEffective {
  id: string;
  name: string;
  selection_type: 'single' | 'multiple';
  is_required: boolean;
  source: 'product' | 'category';
  sort_order: number;
}

interface ProductAttributeLinksResponse {
  data: { links: ApiProductAttributeGroupLink[] };
}

interface ProductAttributeEffectiveResponse {
  data: { groups: ApiAttributeGroupEffective[] };
}

export function useProductAttributeGroupLinks(productId: string | null) {
  return useQuery({
    queryKey: ['products', productId, 'attribute-groups'],
    queryFn: async (): Promise<ApiProductAttributeGroupLink[]> => {
      const res = await api.get<ProductAttributeLinksResponse>(
        `/products/${productId}/attribute-groups`,
      );
      return res.data.data.links;
    },
    enabled: productId !== null && productId !== '',
    staleTime: 30_000,
  });
}

export function useEffectiveProductAttributeGroups(productId: string | null) {
  return useQuery({
    queryKey: ['products', productId, 'attribute-groups', 'effective'],
    queryFn: async (): Promise<ApiAttributeGroupEffective[]> => {
      const res = await api.get<ProductAttributeEffectiveResponse>(
        `/products/${productId}/attribute-groups/effective`,
      );
      return res.data.data.groups;
    },
    enabled: productId !== null && productId !== '',
    staleTime: 30_000,
  });
}

export function useLinkProductAttributeGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { productId: string; groupId: string }): Promise<void> => {
      await api.post(`/products/${vars.productId}/attribute-groups/${vars.groupId}`);
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['products', vars.productId, 'attribute-groups'] });
    },
  });
}

export function useUnlinkProductAttributeGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { productId: string; groupId: string }): Promise<void> => {
      await api.delete(`/products/${vars.productId}/attribute-groups/${vars.groupId}`);
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['products', vars.productId, 'attribute-groups'] });
    },
  });
}
