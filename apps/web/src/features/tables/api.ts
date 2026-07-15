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
  /**
   * Kalıcı per-bölge görüntü numarası (ADR-009 Amendment 2026-06-30 Karar A).
   * NULL = bölgesiz orphan → etiket ham `code`'a düşer. Pozisyonel ordinal'in
   * (silme/sync ile kayan) yerini alır.
   */
  display_no: number | null;
  status: TableStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /** Aktif sipariş projection (tables baseQuery genişletme — PR-5).
   *  status='occupied' iken dolu, status='available' iken hepsi NULL. */
  active_order_id: string | null;
  active_order_total_cents: number | null;
  /** ADR-014 §11 — kısmi ödeme yapıldıysa SUM(payments.amount_cents).
   *  v3 paritesi: order_paid_total. NULL=henüz ödeme yok. Yeşil "/₺X" gösterimi. */
  active_order_paid_total_cents: number | null;
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

/**
 * PATCH /tables/:id/area — masayı bir bölgeye atar (orphan "Bölgesiz" masayı
 * gerçek bölgeye taşımak için, ADR-009 Amendment 2026-06-30 Karar C(c)).
 * `area_id: null` → bölgeden çıkar (bu UI'da kullanılmıyor; reassign yönü).
 * Başarıda ['tables'] cache invalid → board güncellenir.
 */
export function useAssignTableArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      areaId: string | null;
    }): Promise<ApiTable> => {
      const res = await api.patch<TableSingleResponse>(
        `/tables/${vars.id}/area`,
        { area_id: vars.areaId },
      );
      return res.data.data.table;
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
    // ADR-010 §11.6 Amendment (2026-07-01) — bölge pill'leri de tazelensin
    // (admin masa/bölge CRUD → tables.changed/areas.changed board sync).
    void qc.invalidateQueries({ queryKey: AREAS_KEY });
  };
}
