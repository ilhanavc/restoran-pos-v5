import { useQuery } from '@tanstack/react-query';
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

// F2b: useCreateGroup / useUpdateGroup / useDeleteGroup
// F2c: useGroupOptions / useCreateOption / useUpdateOption / useDeleteOption
