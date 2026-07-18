import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Trash2, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { useAttributeGroupsAdmin } from '../../attribute-groups/api';
import {
  useCategoryAttributeGroupLinks,
  useLinkCategoryAttributeGroup,
  useUnlinkCategoryAttributeGroup,
  type ApiCategory,
} from '../api';

interface CategoryAttributeModalProps {
  category: ApiCategory | null;
  onClose: () => void;
}

/**
 * Kategori özellik grubu atama modalı — ADR-012 eksik UI parçası.
 *
 * Ürün versiyonu `AttributeGroupAssignment.tsx`'in sadeleştirilmiş hali: kategori
 * gruplarında miras / effective YOK, hepsi doğrudan link → 'Kategoriden' rozeti
 * ve effective query gerekmez. `category === null` iken modal kapalı.
 *
 * Backend: GET/POST/DELETE /menu/categories/:id/attribute-groups (admin, idempotent).
 */
export function CategoryAttributeModal({ category, onClose }: CategoryAttributeModalProps) {
  const { t } = useTranslation();
  const allGroupsQuery = useAttributeGroupsAdmin();
  const linksQuery = useCategoryAttributeGroupLinks(category?.id ?? null);
  const linkMutation = useLinkCategoryAttributeGroup();
  const unlinkMutation = useUnlinkCategoryAttributeGroup();

  const [selectedGroupId, setSelectedGroupId] = useState<string>('');

  const allGroups = allGroupsQuery.data ?? [];
  const links = linksQuery.data ?? [];

  const groupById = useMemo(() => {
    const map = new Map<string, (typeof allGroups)[number]>();
    for (const g of allGroups) map.set(g.id, g);
    return map;
  }, [allGroups]);

  const linkedIds = useMemo(() => new Set(links.map((l) => l.group_id)), [links]);

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
    if (!category || !selectedGroupId) return;
    try {
      await linkMutation.mutateAsync({ categoryId: category.id, groupId: selectedGroupId });
      toast.success(t('admin.menuDefinitions.categoryAttributes.attachSuccess'));
      setSelectedGroupId('');
    } catch (err) {
      toast.error(
        extractError(err, t('admin.menuDefinitions.categoryAttributes.attachFailed')),
      );
    }
  };

  const handleRemove = async (groupId: string) => {
    if (!category) return;
    try {
      await unlinkMutation.mutateAsync({ categoryId: category.id, groupId });
      toast.success(t('admin.menuDefinitions.categoryAttributes.detachSuccess'));
    } catch (err) {
      toast.error(
        extractError(err, t('admin.menuDefinitions.categoryAttributes.detachFailed')),
      );
    }
  };

  return (
    <Dialog
      open={category !== null}
      onOpenChange={(v) => {
        if (!v && !isBusy) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('admin.menuDefinitions.categoryAttributes.title', {
              name: category?.name ?? '',
            })}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {linksQuery.isPending ? (
            <div className="flex min-h-[80px] items-center justify-center">
              <Loader2
                className="h-5 w-5 animate-spin"
                style={{ color: 'var(--v3-text-muted)' }}
                aria-label={t('common.loading')}
              />
            </div>
          ) : links.length === 0 ? (
            <div
              className="rounded-md border border-dashed p-4 text-center"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              <p className="text-[13px]" style={{ color: 'var(--v3-text-muted)' }}>
                {t('admin.menuDefinitions.categoryAttributes.empty')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {links.map((link) => {
                const group = groupById.get(link.group_id);
                if (group === undefined) return null;
                return (
                  <div
                    key={link.id}
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
                        {group.name}
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--v3-text-muted)' }}>
                        {group.selection_type === 'single'
                          ? t('admin.attributeGroups.selectionType.single')
                          : t('admin.attributeGroups.selectionType.multiple')}
                        {group.is_required &&
                          ` · ${t('admin.menuDefinitions.categoryAttributes.requiredBadge')}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemove(group.id)}
                      disabled={isBusy}
                      aria-label={t('admin.menuDefinitions.categoryAttributes.remove')}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-red-50 disabled:opacity-50"
                      style={{ color: 'var(--v3-danger, #dc2626)' }}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Yeni grup ekle */}
          {allGroups.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
              {t('admin.menuDefinitions.categoryAttributes.noneDefined')}
            </p>
          ) : selectableGroups.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                disabled={isBusy}
                aria-label={t('admin.menuDefinitions.categoryAttributes.selectPlaceholder')}
                className="h-10 flex-1 rounded-md border bg-white px-3 text-sm"
                style={{ borderColor: 'var(--v3-border-subtle)' }}
              >
                <option value="">
                  {t('admin.menuDefinitions.categoryAttributes.selectPlaceholder')}
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
                {t('admin.menuDefinitions.categoryAttributes.add')}
              </Button>
            </div>
          ) : (
            <p className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
              {t('admin.menuDefinitions.categoryAttributes.allAssigned')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
