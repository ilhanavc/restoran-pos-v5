import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Customer,
  CustomerCreate,
  CustomerUpdate,
  CustomerSearchResponse,
  CustomerAddress,
  BlacklistTogglePayload,
} from '@restoran-pos/shared-types';
import { api } from '../../../lib/api';

/**
 * Müşteri yönetimi TanStack Query hooks — ADR-016 §11.
 *
 * Backend: apps/api/src/routes/customers/.
 * RBAC: list/create/update/phones/addresses → admin+cashier; blacklist → admin.
 */

export const CUSTOMERS_KEY = ['customers'] as const;

interface ApiEnvelope<T> {
  data: T;
}

// ─── Queries ───────────────────────────────────────────────────────────────

/**
 * Telefon prefix veya isim parçası ile arama. `query` boşsa sorgu disabled.
 */
export function useSearchCustomers(query: string, limit = 20) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, 'search', trimmed, limit],
    queryFn: async (): Promise<CustomerSearchResponse> => {
      const res = await api.get<ApiEnvelope<CustomerSearchResponse>>(
        `/customers/search?search=${encodeURIComponent(trimmed)}&limit=${limit}`,
      );
      return res.data.data;
    },
    enabled: trimmed.length > 0,
    staleTime: 10_000,
  });
}

export function useCustomer(id: string | null | undefined) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, 'detail', id],
    queryFn: async (): Promise<Customer> => {
      const res = await api.get<ApiEnvelope<Customer>>(`/customers/${id}`);
      return res.data.data;
    },
    enabled: typeof id === 'string' && id.length > 0,
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────

function useInvalidateCustomers() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: CUSTOMERS_KEY });
    if (id !== undefined) {
      void qc.invalidateQueries({ queryKey: [...CUSTOMERS_KEY, 'detail', id] });
    }
  };
}

export function useCreateCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async (payload: CustomerCreate): Promise<Customer> => {
      const res = await api.post<ApiEnvelope<Customer>>('/customers', payload);
      return res.data.data;
    },
    onSuccess: (created) => invalidate(created.id),
  });
}

export function useUpdateCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async (input: { id: string; patch: CustomerUpdate }): Promise<Customer> => {
      const res = await api.patch<ApiEnvelope<Customer>>(
        `/customers/${input.id}`,
        input.patch,
      );
      return res.data.data;
    },
    onSuccess: (updated) => invalidate(updated.id),
  });
}

export function useToggleBlacklist() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async (input: { id: string; payload: BlacklistTogglePayload }): Promise<Customer> => {
      const res = await api.patch<ApiEnvelope<Customer>>(
        `/customers/${input.id}/blacklist`,
        input.payload,
      );
      return res.data.data;
    },
    onSuccess: (updated) => invalidate(updated.id),
  });
}

export interface AddPhoneInput {
  rawPhone: string;
  isPrimary: boolean;
}

export function useAddPhone(customerId: string) {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async (payload: AddPhoneInput): Promise<Customer> => {
      const res = await api.post<ApiEnvelope<Customer>>(
        `/customers/${customerId}/phones`,
        payload,
      );
      return res.data.data;
    },
    onSuccess: () => invalidate(customerId),
  });
}

export function useDeletePhone(customerId: string) {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async (normalizedPhone: string): Promise<void> => {
      await api.delete(
        `/customers/${customerId}/phones/${encodeURIComponent(normalizedPhone)}`,
      );
    },
    onSuccess: () => invalidate(customerId),
  });
}

export type AddressInput = Omit<CustomerAddress, 'id'>;

export function useAddAddress(customerId: string) {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async (payload: AddressInput): Promise<Customer> => {
      const res = await api.post<ApiEnvelope<Customer>>(
        `/customers/${customerId}/addresses`,
        payload,
      );
      return res.data.data;
    },
    onSuccess: () => invalidate(customerId),
  });
}

export function useUpdateAddress(customerId: string) {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async (input: { addressId: string; patch: Partial<AddressInput> }): Promise<Customer> => {
      const res = await api.patch<ApiEnvelope<Customer>>(
        `/customers/${customerId}/addresses/${input.addressId}`,
        input.patch,
      );
      return res.data.data;
    },
    onSuccess: () => invalidate(customerId),
  });
}

export function useDeleteAddress(customerId: string) {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async (addressId: string): Promise<void> => {
      await api.delete(`/customers/${customerId}/addresses/${addressId}`);
    },
    onSuccess: () => invalidate(customerId),
  });
}
