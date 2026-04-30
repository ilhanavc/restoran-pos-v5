import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';

/**
 * Attribute groups admin API hooks — Sprint 8c PR-F2a (read-only iskelet).
 *
 * Backend response shape (apps/api/src/routes/attribute-groups.ts, PR-F1):
 *   GET /attribute-groups               → { data: { groups: ApiAttributeGroup[] } }
 *   GET /attribute-groups/:id/options   → { data: { options: ApiAttributeOption[] } }
 *
 * F2a yalnız liste view → useAttributeGroupsAdmin yeterli. Mutation hook'ları
 * (create/update/delete) F2b'de eklenecek.
 */
export interface ApiAttributeGroup {
  id: string;
  tenant_id: string;
  name: string;
  selection_type: 'single' | 'multiple';
  is_required: boolean;
  sort_order: number;
}

interface AttributeGroupsListResponse {
  data: { groups: ApiAttributeGroup[] };
}

export interface ApiAttributeOption {
  id: string;
  tenant_id: string;
  group_id: string;
  name: string;
  extra_price_cents: number;
  is_default: boolean;
  sort_order: number;
}

const ATTR_GROUPS_KEY = ['attribute-groups', 'admin'] as const;

export function useAttributeGroupsAdmin() {
  return useQuery({
    queryKey: ATTR_GROUPS_KEY,
    queryFn: async (): Promise<ApiAttributeGroup[]> => {
      const res = await api.get<AttributeGroupsListResponse>('/attribute-groups');
      return res.data.data.groups;
    },
    staleTime: 30_000,
  });
}

interface AttributeGroupSingleResponse {
  data: { group: ApiAttributeGroup };
}

interface AttributeOptionSingleResponse {
  data: { option: ApiAttributeOption };
}

/**
 * POST /attribute-groups — Sprint 8c PR-F2b.
 * Yeni özellik grubu oluşturur. Options ayrı çağrılarla eklenir
 * (useCreateAttributeOption). F2c'de transaction iyileştirmesi yapılacak.
 */
export function useCreateAttributeGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      name: string;
      selectionType: 'single' | 'multiple';
      isRequired: boolean;
      sortOrder?: number;
    }): Promise<ApiAttributeGroup> => {
      const res = await api.post<AttributeGroupSingleResponse>('/attribute-groups', vars);
      return res.data.data.group;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attribute-groups'] });
    },
  });
}

/**
 * POST /attribute-groups/:id/options — Sprint 8c PR-F2b.
 * Mevcut bir gruba option ekler.
 */
export function useCreateAttributeOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      groupId: string;
      name: string;
      extraPriceCents: number;
      isDefault: boolean;
      sortOrder?: number;
    }): Promise<ApiAttributeOption> => {
      const { groupId, ...body } = vars;
      const res = await api.post<AttributeOptionSingleResponse>(
        `/attribute-groups/${groupId}/options`,
        body,
      );
      return res.data.data.option;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attribute-groups'] });
    },
  });
}

/**
 * DELETE /attribute-groups/:id — Sprint 8c PR-F2b.
 * Backend cascade option'ları temizler.
 */
export function useDeleteAttributeGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/attribute-groups/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attribute-groups'] });
    },
  });
}

/**
 * GET /attribute-groups/:id/options — Sprint 8c PR-F2c.
 * Inline expand + edit drawer için kullanılır.
 */
export function useAttributeGroupOptions(groupId: string | null) {
  return useQuery({
    queryKey: ['attribute-groups', 'admin', groupId, 'options'],
    queryFn: async (): Promise<ApiAttributeOption[]> => {
      if (!groupId) return [];
      const res = await api.get<{ data: { options: ApiAttributeOption[] } }>(
        `/attribute-groups/${groupId}/options`,
      );
      return res.data.data.options;
    },
    enabled: groupId !== null,
    staleTime: 30_000,
  });
}

/**
 * PATCH /attribute-groups/:id — Sprint 8c PR-F2c.
 */
export function useUpdateAttributeGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      name?: string;
      selectionType?: 'single' | 'multiple';
      isRequired?: boolean;
      sortOrder?: number;
    }): Promise<ApiAttributeGroup> => {
      const { id, ...body } = vars;
      const res = await api.patch<AttributeGroupSingleResponse>(
        `/attribute-groups/${id}`,
        body,
      );
      return res.data.data.group;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attribute-groups'] });
    },
  });
}

/**
 * PATCH /attribute-groups/:groupId/options/:optId — Sprint 8c PR-F2c.
 */
export function useUpdateAttributeOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      groupId: string;
      optionId: string;
      name?: string;
      extraPriceCents?: number;
      isDefault?: boolean;
      sortOrder?: number;
    }): Promise<ApiAttributeOption> => {
      const { groupId, optionId, ...body } = vars;
      const res = await api.patch<AttributeOptionSingleResponse>(
        `/attribute-groups/${groupId}/options/${optionId}`,
        body,
      );
      return res.data.data.option;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attribute-groups'] });
    },
  });
}

/**
 * DELETE /attribute-groups/:groupId/options/:optId — Sprint 8c PR-F2c.
 */
export function useDeleteAttributeOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { groupId: string; optionId: string }): Promise<void> => {
      await api.delete(`/attribute-groups/${vars.groupId}/options/${vars.optionId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attribute-groups'] });
    },
  });
}
