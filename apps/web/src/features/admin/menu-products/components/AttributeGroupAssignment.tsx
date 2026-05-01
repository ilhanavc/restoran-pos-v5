import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Layers, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Button } from '../../../../components/ui/button';
import { useAttributeGroupsAdmin } from '../../attribute-groups/api';
import {
  useEffectiveProductAttributeGroups,
  useLinkProductAttributeGroup,
  useProductAttributeGroupLinks,
  useUnlinkProductAttributeGroup,
} from '../api';

interface AttributeGroupAssignmentProps {
  productId: string;
}

/**
 * Ürün özellik grubu atama UI — Sprint 8c PR-F3a.
 *
 * V3 paritesi `MenuProductEditorPage.jsx` "Özellik grupları" bölümü.
 * Backend: GET/POST/DELETE /products/:id/attribute-groups (Sprint 8c PR-F1c1).
 *
 * - Direkt link'lenmiş gruplar düzenlenebilir (Sil btn aktif)
 * - Kategori bazlı miras gruplar read-only ("Kategoriden" rozeti)
 * - Halihazırda link'li grup tekrar eklenmez (idempotent backend yine de
 *   200 döner; UI'da disabled select option)
 */
export function AttributeGroupAssignment({ productId }: AttributeGroupAssignmentProps) {
  const { t } = useTranslation();
  const allGroupsQuery = useAttributeGroupsAdmin();
  const linksQuery = useProductAttributeGroupLinks(productId);
  const effectiveQuery = useEffectiveProductAttributeGroups(productId);
  const linkMutation = useLinkProductAttributeGroup();
  const unlinkMutation = useUnlinkProductAttributeGroup();

  const [selectedGroupId, setSelectedGroupId] = useState<string>('');

  const allGroups = allGroupsQuery.data ?? [];
  const linkedIds = useMemo(
    () => new Set((linksQuery.data ?? []).map((l) => l.group_id)),
    [linksQuery.data],
  );
  const effective = effectiveQuery.data ?? [];

  const selectableGroups = useMemo(
    () => allGroups.filter((g) => !linkedIds.has(g.id)),
    [allGroups, linkedIds],
  );

  const isBusy = linkMutation.isPending || unlinkMutation.isPending;

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { message?: string; code?: string } }
        | undefined;
      return data?.error?.message ?? fallback;
    }
    return fallback;
  };

  const handleAdd = async () => {
    if (!selectedGroupId) return;
    try {
      await linkMutation.mutateAsync({ productId, groupId: selectedGroupId });
      toast.success(t('admin.menuDefinitions.products.editor.attributeAttachSuccess'));
      setSelectedGroupId('');
    } catch (err) {
      toast.error(
        extractError(
          err,
          t('admin.menuDefinitions.products.errors.attributeAttachFailed'),
        ),
      );
    }
  };

  const handleRemove = async (groupId: string) => {
    try {
      await unlinkMutation.mutateAsync({ productId, groupId });
      toast.success(t('admin.menuDefinitions.products.editor.attributeDetachSuccess'));
    } catch (err) {
      toast.error(
        extractError(
          err,
          t('admin.menuDefinitions.products.errors.attributeDetachFailed'),
        ),
      );
    }
  };

  if (effectiveQuery.isPending || linksQuery.isPending) {
    return (
      <p className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
        {t('admin.menuDefinitions.products.editor.attributeLoading')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {effective.length === 0 ? (
        <div
          className="rounded-md border border-dashed p-4 text-center"
          style={{ borderColor: 'var(--v3-border-subtle)' }}
        >
          <p className="text-[13px]" style={{ color: 'var(--v3-text-muted)' }}>
            {t('admin.menuDefinitions.products.editor.attributeEmpty')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {effective.map((g) => {
            const fromCategory = g.source === 'category';
            return (
              <div
                key={g.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2.5"
                style={{ borderColor: 'var(--v3-border-subtle)' }}
              >
                <Layers
                  className="h-4 w-4 shrink-0"
                  strokeWidth={2}
                  style={{ color: 'var(--v3-text-muted)' }}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className="truncate text-[13px] font-bold"
                    style={{ color: 'var(--v3-text-primary)' }}
                  >
                    {g.name}
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    {g.selection_type === 'single'
                      ? t('admin.attributeGroups.selectionType.single')
                      : t('admin.attributeGroups.selectionType.multiple')}
                    {g.is_required &&
                      ` · ${t('admin.menuDefinitions.products.editor.attributeRequiredBadge')}`}
                  </span>
                </div>
                {fromCategory ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                    style={{
                      background: 'var(--v3-surface-2, #f3f4f6)',
                      color: 'var(--v3-text-secondary)',
                    }}
                  >
                    <Lock className="h-3 w-3" strokeWidth={2} />
                    {t('admin.menuDefinitions.products.editor.attributeFromCategory')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleRemove(g.id)}
                    disabled={isBusy}
                    aria-label={t('admin.menuDefinitions.products.editor.attributeRemove')}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-red-50 disabled:opacity-50"
                    style={{ color: 'var(--v3-danger, #dc2626)' }}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Yeni grup ekle */}
      {selectableGroups.length > 0 ? (
        <div className="flex items-center gap-2">
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            disabled={isBusy}
            className="h-10 flex-1 rounded-md border bg-white px-3 text-sm"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <option value="">
              {t('admin.menuDefinitions.products.editor.attributeSelectPlaceholder')}
            </option>
            {selectableGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleAdd()}
            disabled={!selectedGroupId || isBusy}
            className="gap-1.5"
          >
            <Plus size={14} />
            {t('admin.menuDefinitions.products.editor.attributeAdd')}
          </Button>
        </div>
      ) : allGroups.length > 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
          {t('admin.menuDefinitions.products.editor.attributeAllAttached')}
        </p>
      ) : (
        <p className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
          {t('admin.menuDefinitions.products.editor.attributeNoneDefined')}
        </p>
      )}
    </div>
  );
}
