import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PrinterDto,
  PrintersListResponse,
} from '@restoran-pos/shared-types';
import { api } from '../../../lib/api';

/**
 * Yazıcı yönetimi API hook'ları — ADR-032 Amendment 2 (Dilim A + B).
 *
 * Backend: apps/api/src/routes/printers.ts (kullanıcı-JWT + admin).
 *   GET /printers                  → { data: { printers, orphanKinds } }
 *   PATCH /printers/:id            → { data: { printer: { id, displayName } } }
 *   PUT /printers/:id/categories   → { data: { assignment: {...} } }
 *
 * Tazeleme: ekran açıkken 10 sn react-query polling (ADR K10). Yeni Socket.IO
 * olayı YOKTUR (kapsam kilidi) — durum/kuyruk verisi yalnız bu poll'dan gelir.
 *
 * v5.1 / cutover sonrası (Dilim C/D/E): kitchen_print anahtarı · yazıcı ekleme
 * + tek-seferlik anahtar + revoke/restore · test baskısı.
 */

export type { PrinterDto };

const PRINTERS_KEY = ['printers'] as const;

/** Ekran açıkken 10 sn'de bir tazelenir (durum + kuyruk + yetim kuyruk). */
const POLL_INTERVAL_MS = 10_000;

interface PrintersResponse {
  data: PrintersListResponse;
}

export function usePrinters() {
  return useQuery({
    queryKey: PRINTERS_KEY,
    queryFn: async (): Promise<PrintersListResponse> => {
      const res = await api.get<PrintersResponse>('/printers');
      return res.data.data;
    },
    refetchInterval: POLL_INTERVAL_MS,
    // Poll'lar arasında bayat veri gösterme; durum ekranı tazelik ister.
    staleTime: 0,
  });
}

export interface UpdatePrinterInput {
  id: string;
  displayName: string;
}

/** Yazıcıya istasyon etiketi verir/düzeltir ("Fırın", "Izgara", "Kasa"). */
export function useUpdatePrinter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, displayName }: UpdatePrinterInput): Promise<void> => {
      await api.patch(`/printers/${id}`, { displayName });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRINTERS_KEY });
    },
  });
}

export interface AssignCategoriesInput {
  printerId: string;
  stationKind: string;
  categoryIds: string[];
}

export interface AssignCategoriesResult {
  addedCount: number;
  removedCount: number;
}

/**
 * İstasyon atama kaydı (Dilim B). `categoryIds` = bu istasyona basacak
 * kategorilerin TAM listesi; sunucu istasyon-kapsamlı diff uygular.
 * Kategori listesi de tazelenir (print_station değişti).
 */
export function useAssignPrinterCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      printerId,
      stationKind,
      categoryIds,
    }: AssignCategoriesInput): Promise<AssignCategoriesResult> => {
      const res = await api.put<{
        data: { assignment: AssignCategoriesResult };
      }>(`/printers/${printerId}/categories`, { stationKind, categoryIds });
      return res.data.data.assignment;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRINTERS_KEY });
      void qc.invalidateQueries({ queryKey: ['categories', 'admin'] });
    },
  });
}
