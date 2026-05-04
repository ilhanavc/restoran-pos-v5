import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { CallLog, CallLogStatus } from '@restoran-pos/shared-types';

/**
 * Caller ID — TanStack Query hook'ları (ADR-016 §11).
 *
 * Endpoint'ler `apps/api/src/routes/caller-id/index.ts`:
 *   - GET    /caller-id/logs            — son çağrı feed'i
 *   - PATCH  /caller-id/logs/:id/status — popup aksiyonu
 */

interface CallLogsListResponse {
  data: { calls: CallLog[] };
}

interface CallLogSingleResponse {
  data: { call: CallLog };
}

export const CALL_LOGS_KEY = ['caller-id', 'logs'] as const;

export function useCallLogs(limit = 50) {
  return useQuery({
    queryKey: [...CALL_LOGS_KEY, limit] as const,
    queryFn: async (): Promise<CallLog[]> => {
      const res = await api.get<CallLogsListResponse>('/caller-id/logs', {
        params: { limit },
      });
      return res.data.data.calls;
    },
  });
}

export interface UpdateCallStatusVars {
  id: string;
  status: CallLogStatus;
  openedOrderId?: string;
}

export function useUpdateCallStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: UpdateCallStatusVars): Promise<CallLog> => {
      const res = await api.patch<CallLogSingleResponse>(
        `/caller-id/logs/${vars.id}/status`,
        { status: vars.status, openedOrderId: vars.openedOrderId },
      );
      return res.data.data.call;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CALL_LOGS_KEY });
    },
  });
}
