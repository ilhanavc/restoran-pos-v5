import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';

/**
 * Dining areas admin API hooks — Sprint 8c PR-B.
 *
 * Backend response shape (apps/api/src/routes/areas.ts):
 *   GET    /areas         → { data: { areas: ApiArea[] } }
 *   POST   /areas         → { data: { area: ApiArea } }, 201
 *   PATCH  /areas/:id     → { data: { area: ApiArea } }
 *   DELETE /areas/:id     → 204
 *
 * Active table count is derived from /tables (group by area_id).
 * No dedicated /areas/:id/sync endpoint until Sprint 8c PR-C.
 */
export interface ApiArea {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
}

interface AreasListResponse {
  data: { areas: ApiArea[] };
}

interface AreaSingleResponse {
  data: { area: ApiArea };
}

const AREAS_ADMIN_KEY = ['areas', 'admin'] as const;

export function useAreasAdmin() {
  return useQuery({
    queryKey: AREAS_ADMIN_KEY,
    queryFn: async (): Promise<ApiArea[]> => {
      const res = await api.get<AreasListResponse>('/areas');
      return res.data.data.areas;
    },
    staleTime: 30_000,
  });
}

/**
 * /tables shape'i lokal — `area_id` alanını alabilen minimal projeksiyon.
 * Tables api.ts ApiTable ile uyumlu.
 */
interface ApiTableForCount {
  id: string;
  area_id: string | null;
  status: string;
}

interface TablesListResponse {
  data: { tables: ApiTableForCount[] };
}

export function useTablesForAreaCount() {
  return useQuery({
    queryKey: ['tables', 'forAreaCount'],
    queryFn: async (): Promise<ApiTableForCount[]> => {
      const res = await api.get<TablesListResponse>('/tables');
      return res.data.data.tables;
    },
    staleTime: 30_000,
  });
}

export function useCreateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; sortOrder?: number }): Promise<ApiArea> => {
      const res = await api.post<AreaSingleResponse>('/areas', vars);
      return res.data.data.area;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['areas'] });
    },
  });
}

export function useUpdateAreaName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; name: string }): Promise<ApiArea> => {
      const res = await api.patch<AreaSingleResponse>(`/areas/${vars.id}`, { name: vars.name });
      return res.data.data.area;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['areas'] });
    },
  });
}

export function useDeleteArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/areas/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['areas'] });
      void qc.invalidateQueries({ queryKey: ['tables'] });
    },
  });
}
