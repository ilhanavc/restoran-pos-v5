import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import i18n from 'i18next';
import { AppShell } from '../../components/layout/AppShell';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import {
  useAreasAdmin,
  useCreateArea,
  useDeleteArea,
  useSyncTables,
  useTablesForAreaCount,
  useUpdateAreaName,
  type ApiArea,
} from './dining-areas/api';
import { AreaCard } from './dining-areas/components/AreaCard';
import { NewAreaDialog } from './dining-areas/components/NewAreaDialog';
import { DeleteAreaDialog } from './dining-areas/components/DeleteAreaDialog';

/**
 * Salon Bölgeleri admin sayfası — Sprint 8c PR-B.
 *
 * V3 paritesi (DiningAreasSettingsPage.jsx) + V5 AppShell layout (Tables sayfası
 * ile aynı header pattern: pl-[74px] mt-3 mb-[14px] min-h-[42px]).
 *
 * Mevcut backend endpoint'leri: GET/POST/PATCH/DELETE /areas. Aktif masa sayısı
 * /tables üzerinden hesaplanır. "Hedef masa sayısı + Uygula" butonu Sprint 8c
 * PR-C'de aktif olacak — şu an disabled placeholder.
 */
export default function DiningAreasPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const areasQuery = useAreasAdmin();
  const tablesQuery = useTablesForAreaCount();
  const createArea = useCreateArea();
  const updateName = useUpdateAreaName();
  const deleteArea = useDeleteArea();
  const syncTables = useSyncTables();

  const [newOpen, setNewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApiArea | null>(null);

  const areas = areasQuery.data ?? [];
  const tables = tablesQuery.data ?? [];

  const sortedAreas = useMemo(
    () => [...areas].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr')),
    [areas],
  );

  const activeCountByArea = useMemo(() => {
    const map = new Map<string, number>();
    for (const tbl of tables) {
      if (tbl.area_id) {
        map.set(tbl.area_id, (map.get(tbl.area_id) ?? 0) + 1);
      }
    }
    return map;
  }, [tables]);

  const maxSortOrder = areas.reduce((max, a) => Math.max(max, a.sort_order), -1);

  const handleBack = () => navigate('/dashboard');

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { message?: string; code?: string } }
        | undefined;
      // ADR-006 zarfı `message` taşımaz; raw `code` (ör. AREA_HAS_ACTIVE_TABLES)
      // i18n `error.{CODE}` registry'sinde varsa Türkçe mesajı göster (hardcoded
      // string yasağı). Yoksa modül-özel fallback.
      const code = data?.error?.code;
      if (code !== undefined) {
        const codeKey = `error.${code}`;
        if (i18n.exists(codeKey)) return i18n.t(codeKey);
      }
      return data?.error?.message ?? fallback;
    }
    return fallback;
  };

  const handleSync = async (areaId: string, count: number) => {
    try {
      const result = await syncTables.mutateAsync({ areaId, count });
      if (result.created > 0) {
        toast.success(t('admin.diningAreas.syncCreated', { count: result.created }));
      } else if (result.removed > 0) {
        toast.success(t('admin.diningAreas.syncRemoved', { count: result.removed }));
      } else {
        toast.success(t('admin.diningAreas.syncNoChange'));
      }
    } catch (err) {
      toast.error(extractError(err, t('admin.diningAreas.errors.syncFailed')));
    }
  };

  const handleCreate = async ({ name, initialTableCount }: { name: string; initialTableCount: number }) => {
    try {
      const newArea = await createArea.mutateAsync({ name, sortOrder: maxSortOrder + 1 });
      setNewOpen(false);
      if (initialTableCount > 0) {
        await handleSync(newArea.id, initialTableCount);
      } else {
        toast.success(t('admin.diningAreas.createSuccess'));
      }
    } catch (err) {
      toast.error(extractError(err, t('admin.diningAreas.errors.createFailed')));
    }
  };

  const handleSaveName = async (id: string, name: string) => {
    try {
      await updateName.mutateAsync({ id, name });
      toast.success(t('admin.diningAreas.updateSuccess'));
    } catch (err) {
      toast.error(extractError(err, t('admin.diningAreas.errors.updateFailed')));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteArea.mutateAsync(deleteTarget.id);
      toast.success(t('admin.diningAreas.deleteSuccess'));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(extractError(err, t('admin.diningAreas.errors.deleteFailed')));
    }
  };

  return (
    <AppShell>
      <PageHeader
        title={t('admin.diningAreas.title')}
        actions={
          <button
            type="button"
            onClick={handleBack}
            aria-label={t('admin.diningAreas.back')}
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
            {t('admin.diningAreas.back')}
          </button>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6">
        <p className="mb-3 text-[13px]" style={{ color: 'var(--v3-text-muted)' }}>
          {t('admin.diningAreas.intro1')}
        </p>
        <p className="mb-4 text-[12px]" style={{ color: 'var(--v3-text-muted)', lineHeight: 1.45 }}>
          {t('admin.diningAreas.intro2')}
        </p>

        <div className="mb-3.5 flex justify-end">
          <Button type="button" size="sm" onClick={() => setNewOpen(true)} className="gap-1.5">
            <Plus size={16} />
            {t('admin.diningAreas.newAreaButton')}
          </Button>
        </div>

        {areasQuery.isPending && (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--v3-text-muted)' }} />
          </div>
        )}

        {areasQuery.isError && (
          <ErrorState
            description={t('admin.diningAreas.errors.loadFailed')}
            onRetry={() => {
              void areasQuery.refetch();
            }}
          />
        )}

        {areasQuery.isSuccess && sortedAreas.length === 0 && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{ borderColor: 'var(--v3-border-subtle)', color: 'var(--v3-text-muted)' }}
          >
            {t('admin.diningAreas.empty')}
          </div>
        )}

        {areasQuery.isSuccess && sortedAreas.length > 0 && (
          <div className="flex flex-col gap-3">
            {sortedAreas.map((area) => (
              <AreaCard
                key={area.id}
                area={area}
                activeTableCount={activeCountByArea.get(area.id) ?? 0}
                onSaveName={(name) => handleSaveName(area.id, name)}
                onDelete={() => setDeleteTarget(area)}
                onSync={(count) => handleSync(area.id, count)}
                isSaving={updateName.isPending}
                isSyncing={syncTables.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <NewAreaDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onSubmit={handleCreate}
        isSubmitting={createArea.isPending}
      />

      <DeleteAreaDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        areaName={deleteTarget?.name ?? ''}
        onConfirm={handleDelete}
        isDeleting={deleteArea.isPending}
      />
    </AppShell>
  );
}
