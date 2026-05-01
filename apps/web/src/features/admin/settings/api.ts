import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';

/**
 * Tenant settings admin API hooks — Görev 36 (Session 49).
 *
 * Backend: apps/api/src/routes/settings.ts (PR #47, Session 40).
 *   GET   /settings  → admin + cashier; { data: { settings: ApiTenantSettings } }
 *   PATCH /settings  → admin only;      { data: { settings: ApiTenantSettings } }
 *
 * Kapsam (Session 40 kararı, kapsam kilidi):
 *   MVP:        timezone + business_day_cutoff_hour + tenant_name (read-only)
 *   v5.1+:      fiş header, telefon, vergi no, KDV oranları
 */
export interface ApiTenantSettings {
  tenantId: string;
  tenantName: string;
  timezone: string;
  businessDayCutoffHour: number;
  createdAt: string;
  updatedAt: string;
}

interface SettingsResponse {
  data: { settings: ApiTenantSettings };
}

const SETTINGS_KEY = ['settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async (): Promise<ApiTenantSettings> => {
      const res = await api.get<SettingsResponse>('/settings');
      return res.data.data.settings;
    },
    staleTime: 60_000,
  });
}

export interface SettingsPatch {
  timezone?: string;
  businessDayCutoffHour?: number;
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SettingsPatch): Promise<ApiTenantSettings> => {
      const res = await api.patch<SettingsResponse>('/settings', patch);
      return res.data.data.settings;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}
