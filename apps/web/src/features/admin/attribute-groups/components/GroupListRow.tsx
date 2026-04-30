import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import type { ApiAttributeGroup, ApiAttributeOption } from '../api';

interface GroupListRowProps {
  group: ApiAttributeGroup;
  optionCount: number;
  onEdit: () => void;
  onAddOption: () => void;
  onDelete: () => void;
  onToggleExpand: () => void;
  expanded: boolean;
  options: ApiAttributeOption[];
  optionsLoading?: boolean;
  isDeleting?: boolean;
}

/**
 * Para birimini Türkçe formatlı string'e çevir (kuruş → ₺X,YZ).
 * Float yasağı: input integer kuruş, output sadece display.
 */
function formatTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

/**
 * Özellik grubu liste satırı — Sprint 8c PR-F2c.
 * - Count + chevron clickable (toggle expand)
 * - Düzenle / Yeni özellik ekle linkleri aktif (parent'a callback)
 * - Expand'de inline options sub-table (V3 #2 paritesi)
 */
export function GroupListRow({
  group,
  optionCount,
  onEdit,
  onAddOption,
  onDelete,
  onToggleExpand,
  expanded,
  options,
  optionsLoading,
  isDeleting,
}: GroupListRowProps) {
  const { t } = useTranslation();

  const selectionTypeLabel =
    group.selection_type === 'single'
      ? t('admin.attributeGroups.selectionType.single')
      : t('admin.attributeGroups.selectionType.multiple');

  return (
    <div className="border-b last:border-b-0" style={{ borderColor: 'var(--v3-border-subtle)' }}>
      <div className="grid grid-cols-[2fr_1fr_1fr_2fr_auto] items-center gap-3 px-4 py-3">
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

        {/* Özellik sayısı + chevron (toggle expand) */}
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-[13px] font-semibold"
          style={{ color: 'var(--v3-purple, #7c3aed)' }}
        >
          <span>{optionCount}</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Düzenle / Yeni özellik ekle */}
        <div className="flex items-center gap-3 text-[13px]">
          <button
            type="button"
            onClick={onEdit}
            className="font-medium underline-offset-2 hover:underline"
            style={{ color: 'var(--v3-purple, #7c3aed)' }}
          >
            {t('admin.attributeGroups.editButton')}
          </button>
          <span style={{ color: 'var(--v3-border-subtle)' }}>·</span>
          <button
            type="button"
            onClick={onAddOption}
            className="font-medium underline-offset-2 hover:underline"
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

      {/* Expanded options sub-table (V3 #2 paritesi) */}
      {expanded && (
        <div
          className="border-t"
          style={{
            borderColor: 'var(--v3-border-subtle)',
            background: 'var(--v3-surface-1)',
          }}
        >
          {optionsLoading ? (
            <div
              className="px-4 py-3 text-center text-[12px]"
              style={{ color: 'var(--v3-text-muted)' }}
            >
              ...
            </div>
          ) : options.length === 0 ? (
            <div
              className="px-4 py-3 text-center text-[12px]"
              style={{ color: 'var(--v3-text-muted)' }}
            >
              —
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr
                  className="border-b text-[11px] font-bold uppercase tracking-wider"
                  style={{
                    borderColor: 'var(--v3-border-subtle)',
                    color: 'var(--v3-text-muted)',
                  }}
                >
                  <th className="px-4 py-2 text-left">
                    {t('admin.attributeGroups.expandedTable.optionName')}
                  </th>
                  <th className="px-4 py-2 text-left">
                    {t('admin.attributeGroups.expandedTable.extraPrice')}
                  </th>
                  <th className="px-4 py-2 text-left">
                    {t('admin.attributeGroups.expandedTable.default')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {options.map((opt) => (
                  <tr
                    key={opt.id}
                    className="border-b last:border-b-0"
                    style={{ borderColor: 'var(--v3-border-subtle)' }}
                  >
                    <td
                      className="px-4 py-2 text-[13px] font-bold uppercase"
                      style={{ color: 'var(--v3-purple, #7c3aed)' }}
                    >
                      {opt.name}
                    </td>
                    <td
                      className="px-4 py-2 text-[13px]"
                      style={{ color: 'var(--v3-text-secondary)' }}
                    >
                      {opt.extra_price_cents === 0
                        ? t('admin.attributeGroups.free')
                        : formatTL(opt.extra_price_cents)}
                    </td>
                    <td
                      className="px-4 py-2 text-[13px]"
                      style={{ color: 'var(--v3-text-secondary)' }}
                    >
                      {opt.is_default ? '✓' : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
