import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  useAttributeGroupsAdmin,
  useDeleteAttributeGroup,
  type ApiAttributeGroup,
} from './attribute-groups/api';
import { GroupListRow } from './attribute-groups/components/GroupListRow';
import { DeleteGroupDialog } from './attribute-groups/components/DeleteGroupDialog';
import { NewGroupDrawer } from './attribute-groups/components/NewGroupDrawer';

/**
 * Özellikler admin sayfası — Sprint 8c PR-F2a (liste view).
 *
 * V3 paritesi: arama input + "Yeni Grup Tanımla" buton + tablo
 * (ÖZELLİK GRUP İSMİ / SEÇİM TİPİ / ÖZELLİKLER / İŞLEMLER + sil ikonu).
 *
 * F2a kapsamında "Yeni Grup Tanımla", "Düzenle", "Yeni özellik ekle"
 * ve "Sil" aksiyonları disabled placeholder. Drawer + mutation hook'ları
 * F2b/c'de eklenecek.
 *
 * Option count: F2a'da backend'den toplu /attribute-groups çağrısıyla
 * sadece grup listesi alınıyor; per-group option count F2c'de (her satır
 * için ayrı /options çağrısı yerine eklenir). Şu an "0" varsayılan.
 */
export default function AttributeGroupsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const groupsQuery = useAttributeGroupsAdmin();
  const deleteGroup = useDeleteAttributeGroup();

  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ApiAttributeGroup | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const groups = groupsQuery.data ?? [];

  const filteredGroups = useMemo(() => {
    const sorted = [...groups].sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr'),
    );
    const q = search.trim().toLocaleLowerCase('tr');
    if (!q) return sorted;
    return sorted.filter((g) => g.name.toLocaleLowerCase('tr').includes(q));
  }, [groups, search]);

  const handleBack = () => navigate('/dashboard');

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteGroup.mutateAsync(deleteTarget.id);
      toast.success(t('admin.attributeGroups.deleteSuccess'));
      setDeleteTarget(null);
    } catch {
      toast.error(t('admin.attributeGroups.errors.loadFailed'));
    }
  };

  return (
    <AppShell>
      {/* Header — DiningAreasPage ile aynı offsetler (V3 paritesi). */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
        <h1
          className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('admin.attributeGroups.title')}
        </h1>
        <button
          type="button"
          onClick={handleBack}
          aria-label={t('admin.attributeGroups.back')}
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
          {t('admin.attributeGroups.back')}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6">
        {/* Search + new group buton row */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--v3-text-muted)' }}
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.attributeGroups.searchPlaceholder')}
              className="h-10 pl-9"
              aria-label={t('admin.attributeGroups.searchPlaceholder')}
            />
          </div>
          <Button
            type="button"
            onClick={() => setNewOpen(true)}
            className="gap-1.5"
            style={{
              backgroundColor: 'var(--v3-purple, #7c3aed)',
              color: '#fff',
            }}
          >
            <Plus size={16} />
            {t('admin.attributeGroups.newGroupButton')}
          </Button>
        </div>

        {groupsQuery.isPending && (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2
              className="h-6 w-6 animate-spin"
              style={{ color: 'var(--v3-text-muted)' }}
            />
          </div>
        )}

        {groupsQuery.isError && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-danger, #dc2626)',
              color: 'var(--v3-danger, #dc2626)',
            }}
          >
            {t('admin.attributeGroups.errors.loadFailed')}
          </div>
        )}

        {groupsQuery.isSuccess && filteredGroups.length === 0 && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-muted)',
            }}
          >
            {t('admin.attributeGroups.empty')}
          </div>
        )}

        {groupsQuery.isSuccess && filteredGroups.length > 0 && (
          <div
            className="overflow-hidden rounded-md border bg-white"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            {/* Tablo header */}
            <div
              className="grid grid-cols-[2fr_1fr_1fr_2fr_auto] items-center gap-3 border-b px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider"
              style={{
                borderColor: 'var(--v3-border-subtle)',
                background: 'var(--v3-surface-1)',
                color: 'var(--v3-text-muted)',
              }}
            >
              <div>{t('admin.attributeGroups.table.groupName')}</div>
              <div>{t('admin.attributeGroups.table.selectionType')}</div>
              <div>{t('admin.attributeGroups.table.options')}</div>
              <div>{t('admin.attributeGroups.table.actions')}</div>
              <div className="w-9" />
            </div>

            {filteredGroups.map((group) => (
              <GroupListRow
                key={group.id}
                group={group}
                optionCount={0}
                onEdit={() =>
                  toast.info(
                    t('admin.attributeGroups.newGroupDisabledTooltip'),
                  )
                }
                onAddOption={() =>
                  toast.info(
                    t('admin.attributeGroups.newGroupDisabledTooltip'),
                  )
                }
                onDelete={() => setDeleteTarget(group)}
              />
            ))}
          </div>
        )}
      </div>

      <DeleteGroupDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        groupName={deleteTarget?.name ?? ''}
        onConfirm={handleConfirmDelete}
        isDeleting={deleteGroup.isPending}
      />

      <NewGroupDrawer open={newOpen} onOpenChange={setNewOpen} />
    </AppShell>
  );
}
