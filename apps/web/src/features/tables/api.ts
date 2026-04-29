import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type {
  TableRow,
  TableCreateRequest,
  TableUpdateRequest,
  Area,
} from '@restoran-pos/shared-types';

interface TablesListResponse {
  data: { tables: TableRow[] };
}

interface TableSingleResponse {
  data: { table: TableRow };
}

interface AreasListResponse {
  data: { areas: Area[] };
}

const TABLES_KEY = ['tables'] as const;
const AREAS_KEY = ['areas'] as const;

export function useTables() {
  return useQuery({
    queryKey: TABLES_KEY,
    queryFn: async (): Promise<TableRow[]> => {
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
    mutationFn: async (vars: TableCreateRequest): Promise<TableRow> => {
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
    mutationFn: async (vars: { id: string; patch: TableUpdateRequest }): Promise<TableRow> => {
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

/** Realtime invalidation helper (Sprint 7 ADR-010 events). */
export function useTableRealtimeInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: TABLES_KEY });
  };
}
