import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import type { ApiArea } from '../api';

interface AreaCardProps {
  area: ApiArea;
  activeTableCount: number;
  onSaveName: (name: string) => Promise<void>;
  onDelete: () => void;
  onSync: (count: number) => Promise<void>;
  isSaving?: boolean;
  isSyncing?: boolean;
}

/**
 * Salon bölgesi kartı — V3 paritesi (DiningAreasSettingsPage.jsx:189-274).
 * Inline edit (modal değil), Pencil + Trash icon, "Hedef masa sayısı" + "Uygula"
 * Sprint 8c PR-C'ye kadar disabled placeholder.
 */
export function AreaCard({ area, activeTableCount, onSaveName, onDelete, onSync, isSaving, isSyncing }: AreaCardProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(area.name);
  const [target, setTarget] = useState<string>(String(activeTableCount));

  const startEdit = () => {
    setEditName(area.name);
    setIsEditing(true);
  };
  const cancelEdit = () => {
    setIsEditing(false);
    setEditName(area.name);
  };
  const saveEdit = async () => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    await onSaveName(trimmed);
    setIsEditing(false);
  };

  return (
    <div
      className="rounded-md border bg-white p-4"
      style={{
        borderColor: 'var(--v3-border-subtle)',
      }}
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <LayoutGrid size={18} style={{ color: 'var(--v3-purple, #7c3aed)', flexShrink: 0 }} />
          {isEditing ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                disabled={isSaving}
                className="h-9 min-w-[160px] max-w-[280px]"
                aria-label={t('admin.diningAreas.editButton')}
              />
              <Button type="button" size="sm" onClick={saveEdit} disabled={isSaving || !editName.trim()}>
                {t('admin.diningAreas.saveButton')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={cancelEdit} disabled={isSaving}>
                {t('admin.diningAreas.cancelButton')}
              </Button>
            </div>
          ) : (
            <>
              <div className="min-w-0 truncate text-base font-bold" style={{ color: 'var(--v3-text-primary)' }}>
                {area.name}
              </div>
              <span className="text-xs" style={{ color: 'var(--v3-text-muted)' }}>
                {t('admin.diningAreas.activeTablesLabel', { count: activeTableCount })}
              </span>
            </>
          )}
        </div>
        {!isEditing && (
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={startEdit}
              title={t('admin.diningAreas.editButton')}
              aria-label={t('admin.diningAreas.editButton')}
              className="h-9 w-9 p-0"
            >
              <Pencil size={16} />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDelete}
              title={t('admin.diningAreas.deleteButton')}
              aria-label={t('admin.diningAreas.deleteButton')}
              className="h-9 w-9 p-0"
              style={{ color: 'var(--v3-danger, #dc2626)' }}
            >
              <Trash2 size={16} />
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--v3-text-primary)' }}>
          {t('admin.diningAreas.targetTablesLabel')}
          <Input
            type="number"
            min={0}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={isEditing}
            className="h-9 w-[100px]"
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={isSaving || isSyncing || isEditing}
          onClick={() => {
            const n = parseInt(target, 10);
            if (Number.isNaN(n) || n < 0) return;
            void onSync(n);
          }}
          title={t('admin.diningAreas.applyButton')}
        >
          {isSyncing ? t('admin.diningAreas.applying') : t('admin.diningAreas.applyButton')}
        </Button>
      </div>
    </div>
  );
}
