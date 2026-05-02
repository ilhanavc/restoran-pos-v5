import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { TableStatus, Area, TableCreateRequest, TableUpdateRequest } from '@restoran-pos/shared-types';

/**
 * Backend `/tables` runtime response — shared-types `TableRow` (eski v5
 * tasarımı) ile uyumsuz olduğu için lokal tip. Sprint 8b kapsam dışında
 * shared-types schema bir sonraki sprint'te düzeltilir.
 *
 * Backend snake_case + `code` (label değil). Sprint 8c PR #1 ile `area_id`
 * artık `GET /tables` projection'ında (ADR-009).
 */
export interface ApiTable {
  id: string;
  tenant_id: string;
  code: string;
  capacity: number | null;
  area_id: string | null;
  status: TableStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /** Aktif sipariş projection (tables baseQuery genişletme — PR-5).
   *  status='occupied' iken dolu, status='available' iken hepsi NULL. */
  active_order_id: string | null;
  active_order_total_cents: number | null;
  active_order_started_at: string | null;
  active_waiter_name: string | null;
}

interface TablesListResponse {
  data: { tables: ApiTable[] };
}

interface TableSingleResponse {
  data: { table: ApiTable };
}

interface AreasListResponse {
  data: { areas: Area[] };
}

const TABLES_KEY = ['tables'] as const;
const AREAS_KEY = ['areas'] as const;

export function useTables() {
  return useQuery({
    queryKey: TABLES_KEY,
    queryFn: async (): Promise<ApiTable[]> => {
      const res = await api.get<TablesListResponse>('/tables');
      return res.data.data.tables;
    },
  });
}

export function useAreas() {
  return useQuery({
    queryKey: AREAS_KEY,
    queryFn: async (): Promise<Area[]> => {
      const res = await api.get<AreasListResponse>('/areas');
      return res.data.data.areas;
    },
  });
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: TableCreateRequest): Promise<ApiTable> => {
      const res = await api.post<TableSingleResponse>('/tables', vars);
      return res.data.data.table;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TABLES_KEY });
    },
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; patch: TableUpdateRequest }): Promise<ApiTable> => {
      const res = await api.patch<TableSingleResponse>(`/tables/${vars.id}`, vars.patch);
      return res.data.data.table;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TABLES_KEY });
    },
  });
}

export function useDeleteTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/tables/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TABLES_KEY });
    },
  });
}

export function useTableRealtimeInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: TABLES_KEY });
  };
}
