import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useAuthStore } from '../../store/auth';
import {
  useSettings,
  useUpdateSettings,
  type SettingsPatch,
} from './settings/api';

/**
 * Ayarlar sayfası — Görev 36 (Session 49).
 *
 * Backend: GET/PATCH /settings (PR #47, Session 40 + ADR-002 §6 amendment).
 *   - admin   → görür + düzenler
 *   - cashier → görür, form disabled
 *   - waiter/kitchen → router-level erişim yok (ProtectedRoute izin vermiyor değil
 *     ama backend authorize() reddedeceği için pratikte 403 olur)
 *
 * Kapsam (Session 40 kararı, kapsam kilidi):
 *   MVP:    timezone + businessDayCutoffHour (+ tenantName read-only)
 *   v5.1+:  fiş header, telefon, vergi no, KDV oranları
 *
 * V3 paritesi: V3'te bu ekran yok — sıfırdan v5 form.
 */

/** Popüler IANA TZ listesi — TR odaklı ama Avrupa kapsayıcı. Uzatma v5.1+. */
const TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Europe/Istanbul', label: 'Europe/Istanbul (TR)' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { value: 'Europe/Paris', label: 'Europe/Paris' },
  { value: 'Europe/Amsterdam', label: 'Europe/Amsterdam' },
  { value: 'UTC', label: 'UTC' },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const settingsQuery = useSettings();
  const updateSettings = useUpdateSettings();

  const [timezone, setTimezone] = useState<string>('');
  const [cutoffHour, setCutoffHour] = useState<string>('');

  // İlk veri geldiğinde / refetch sonrası lokal state'i senkronize et.
  useEffect(() => {
    if (settingsQuery.data) {
      setTimezone(settingsQuery.data.timezone);
      setCutoffHour(String(settingsQuery.data.businessDayCutoffHour));
    }
  }, [settingsQuery.data]);

  const original = settingsQuery.data;
  const cutoffHourNum = Number.parseInt(cutoffHour, 10);
  const cutoffValid =
    Number.isInteger(cutoffHourNum) && cutoffHourNum >= 0 && cutoffHourNum <= 23;

  const isDirty = useMemo(() => {
    if (!original) return false;
    return (
      timezone !== original.timezone ||
      (cutoffValid && cutoffHourNum !== original.businessDayCutoffHour)
    );
  }, [original, timezone, cutoffHourNum, cutoffValid]);

  const tzInList = TIMEZONE_OPTIONS.some((o) => o.value === timezone);

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { message?: string; code?: string } }
        | undefined;
      const code = data?.error?.code;
      if (code) {
        const localized = t(`admin.settings.errors.${code}`, {
          defaultValue: '',
        });
        if (localized) return localized;
      }
      return data?.error?.message ?? fallback;
    }
    return fallback;
  };

  const handleBack = () => navigate('/dashboard');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!original || !isAdmin || !isDirty || !cutoffValid) return;

    const patch: SettingsPatch = {};
    if (timezone !== original.timezone) patch.timezone = timezone;
    if (cutoffHourNum !== original.businessDayCutoffHour) {
      patch.businessDayCutoffHour = cutoffHourNum;
    }

    try {
      await updateSettings.mutateAsync(patch);
      toast.success(t('admin.settings.saveSuccess'));
    } catch (err) {
      toast.error(extractError(err, t('admin.settings.errors.saveFailed')));
    }
  };

  return (
    <AppShell>
      {/* Header — Tables/DiningAreas paritesi (pl-[74px] mt-3 mb-[14px] min-h-[42px]). */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
        <h1
          className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('admin.settings.title')}
        </h1>
        <button
          type="button"
          onClick={handleBack}
          aria-label={t('admin.settings.back')}
          className="tables-action-btn inline-flex h-11 items-center gap-2 rounded-xl px-4 transition-all duration-[120ms] hover:[background:var(--v3-surface-2)] hover:[color:var(--v3-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{
            background: 'var(--v3-surface-1)',
            border: '1px solid var(--v3-border-subtle)',
            color: 'var(--v3-text-secondary)',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2} />
          {t('admin.settings.back')}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6">
        <p className="mb-3 text-[13px]" style={{ color: 'var(--v3-text-muted)' }}>
          {t('admin.settings.intro')}
        </p>
        {!isAdmin && (
          <p
            className="mb-4 rounded-md border px-3 py-2 text-[12px]"
            style={{
              background: 'var(--v3-surface-1)',
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-muted)',
            }}
            role="note"
          >
            {t('admin.settings.viewerNotice')}
          </p>
        )}

        {settingsQuery.isPending && (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2
              className="h-6 w-6 animate-spin"
              style={{ color: 'var(--v3-text-muted)' }}
            />
          </div>
        )}

        {settingsQuery.isError && (
          <div
            className="rounded-md border border-dashed p-8 text-center text-sm"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-muted)',
            }}
          >
            {t('admin.settings.errors.loadFailed')}
          </div>
        )}

        {settingsQuery.isSuccess && original && (
          <form
            onSubmit={handleSubmit}
            className="max-w-xl rounded-lg border bg-white p-6 shadow-sm"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            {/* Tenant adı — read-only */}
            <div className="mb-5">
              <Label htmlFor="tenant-name" className="mb-1.5 block">
                {t('admin.settings.tenantName')}
              </Label>
              <Input
                id="tenant-name"
                type="text"
                value={original.tenantName}
                readOnly
                disabled
                className="bg-stone-50"
              />
            </div>

            {/* Saat dilimi */}
            <div className="mb-5">
              <Label htmlFor="timezone" className="mb-1.5 block">
                {t('admin.settings.timezone')}
              </Label>
              <select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={!isAdmin || updateSettings.isPending}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {!tzInList && (
                  <option value={timezone}>{timezone}</option>
                )}
                {TIMEZONE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p
                className="mt-1.5 text-[12px]"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('admin.settings.timezoneHelp')}
              </p>
            </div>

            {/* İş günü kapanış saati */}
            <div className="mb-6">
              <Label htmlFor="cutoff-hour" className="mb-1.5 block">
                {t('admin.settings.businessDayCutoff')}
              </Label>
              <Input
                id="cutoff-hour"
                type="number"
                min={0}
                max={23}
                step={1}
                value={cutoffHour}
                onChange={(e) => setCutoffHour(e.target.value)}
                disabled={!isAdmin || updateSettings.isPending}
                aria-invalid={cutoffHour !== '' && !cutoffValid}
                className="max-w-[120px]"
              />
              <p
                className="mt-1.5 text-[12px]"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('admin.settings.businessDayCutoffHelp')}
              </p>
              {cutoffHour !== '' && !cutoffValid && (
                <p className="mt-1 text-[12px] text-destructive">
                  {t('admin.settings.errors.invalidCutoff')}
                </p>
              )}
            </div>

            {isAdmin && (
              <div className="flex items-center justify-end gap-3">
                {!isDirty && (
                  <span
                    className="text-[12px]"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    {t('admin.settings.noChanges')}
                  </span>
                )}
                <Button
                  type="submit"
                  className="gap-1.5"
                  disabled={
                    !isDirty || !cutoffValid || updateSettings.isPending
                  }
                >
                  {updateSettings.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {updateSettings.isPending
                    ? t('admin.settings.saving')
                    : t('admin.settings.saveButton')}
                </Button>
              </div>
            )}
          </form>
        )}
      </div>
    </AppShell>
  );
}
