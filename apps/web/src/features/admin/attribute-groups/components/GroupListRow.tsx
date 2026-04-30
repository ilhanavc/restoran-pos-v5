import { useTranslation } from 'react-i18next';
import { ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import type { ApiAttributeGroup } from '../api';

interface GroupListRowProps {
  group: ApiAttributeGroup;
  optionCount: number;
  onEdit: () => void;
  onAddOption: () => void;
  onDelete: () => void;
  isDeleting?: boolean;
}

/**
 * Özellik grubu liste satırı — V3 paritesi (Tanımlamalar > Özellikler).
 * F2a'da Düzenle / Yeni özellik ekle / Sil aksiyonları placeholder
 * (disabled). F2b/c'de aktive edilecek.
 */
export function GroupListRow({
  group,
  optionCount,
  onEdit,
  onAddOption,
  onDelete,
  isDeleting,
}: GroupListRowProps) {
  const { t } = useTranslation();

  const selectionTypeLabel =
    group.selection_type === 'single'
      ? t('admin.attributeGroups.selectionType.single')
      : t('admin.attributeGroups.selectionType.multiple');

  return (
    <div
      className="grid grid-cols-[2fr_1fr_1fr_2fr_auto] items-center gap-3 border-b px-4 py-3 last:border-b-0"
      style={{ borderColor: 'var(--v3-border-subtle)' }}
    >
      {/* Grup ismi (uppercase bold) */}
      <div
        className="truncate text-[13px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--v3-text-primary)' }}
      >
        {group.name}
      </div>

      {/* Seçim tipi */}
      <div className="text-[13px]" style={{ color: 'var(--v3-text-secondary)' }}>
        {selectionTypeLabel}
      </div>

      {/* Özellik sayısı + chevron */}
      <button
        type="button"
        onClick={onAddOption}
        disabled
        title={t('admin.attributeGroups.newGroupDisabledTooltip')}
        className="inline-flex items-center gap-1 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        style={{ color: 'var(--v3-purple, #7c3aed)' }}
      >
        <span>{optionCount}</span>
        <ChevronRight size={14} />
      </button>

      {/* Düzenle / Yeni özellik ekle */}
      <div className="flex items-center gap-3 text-[13px]">
        <button
          type="button"
          onClick={onEdit}
          disabled
          title={t('admin.attributeGroups.newGroupDisabledTooltip')}
          className="font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          style={{ color: 'var(--v3-purple, #7c3aed)' }}
        >
          {t('admin.attributeGroups.editButton')}
        </button>
        <span style={{ color: 'var(--v3-border-subtle)' }}>·</span>
        <button
          type="button"
          onClick={onAddOption}
          disabled
          title={t('admin.attributeGroups.newGroupDisabledTooltip')}
          className="font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          style={{ color: 'var(--v3-purple, #7c3aed)' }}
        >
          {t('admin.attributeGroups.addOptionButton')}
        </button>
      </div>

      {/* Sil */}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDelete}
        disabled={isDeleting}
        title={t('admin.attributeGroups.deleteButton')}
        aria-label={t('admin.attributeGroups.deleteButton')}
        className="h-9 w-9 border p-0"
        style={{
          color: 'var(--v3-danger, #dc2626)',
          borderColor: 'var(--v3-danger, #dc2626)',
          opacity: isDeleting ? 0.5 : 1,
        }}
      >
        <Trash2 size={16} />
      </Button>
    </div>
  );
}
