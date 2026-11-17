import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReceiptSettings, ReceiptSettingsUpdate } from '@restoran-pos/shared-types';
import { api } from '../../../lib/api';

/**
 * Fiş Ayarları API kancaları — ADR-045 K7 (PR-2b).
 *
 * Backend (PR-2a): apps/api/src/routes/settings.ts
 *   GET  /settings/receipt             → admin; { data: { receipt } }
 *   PUT  /settings/receipt             → admin; TAM değiştirme, { data: { receipt } }
 *   POST /settings/receipt/test-print  → admin; 202 { data: { enqueued: true } }
 */
interface ReceiptResponse {
  data: { receipt: ReceiptSettings };
}

const RECEIPT_KEY = ['settings', 'receipt'] as const;

export function useReceiptSettings() {
  return useQuery({
    queryKey: RECEIPT_KEY,
    queryFn: async (): Promise<ReceiptSettings> => {
      const res = await api.get<ReceiptResponse>('/settings/receipt');
      return res.data.data.receipt;
    },
    staleTime: 60_000,
  });
}

export function useUpdateReceiptSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ReceiptSettingsUpdate): Promise<ReceiptSettings> => {
      const res = await api.put<ReceiptResponse>('/settings/receipt', body);
      return res.data.data.receipt;
    },
    onSuccess: (saved) => {
      qc.setQueryData(RECEIPT_KEY, saved);
    },
  });
}

export function useReceiptTestPrint() {
  return useMutation({
    mutationFn: async (targetPrinterId: string | undefined): Promise<void> => {
      await api.post(
        '/settings/receipt/test-print',
        targetPrinterId === undefined ? {} : { targetPrinterId },
      );
    },
  });
}
