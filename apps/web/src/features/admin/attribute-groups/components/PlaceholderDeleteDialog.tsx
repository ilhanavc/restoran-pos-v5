import { useTranslation } from 'react-i18next';
import { Button } from '../../../../components/ui/button';

interface PlaceholderDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  onConfirm: () => void;
  isDeleting?: boolean;
}

/**
 * Özellik grubu silme onayı — F2a placeholder.
 * Mutation entegrasyonu F2b'de gelecek; şu an UI iskeleti hazır,
 * onConfirm parent'tan boş bırakılabilir.
 */
export function PlaceholderDeleteDialog({
  open,
  onOpenChange,
  groupName,
  onConfirm,
  isDeleting,
}: PlaceholderDeleteDialogProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-md rounded-md bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2
          className="mb-2 text-lg font-bold"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('admin.attributeGroups.deleteDialog.title')}
        </h2>
        <p
          className="mb-5 text-sm"
          style={{ color: 'var(--v3-text-secondary)' }}
        >
          {t('admin.attributeGroups.deleteDialog.message', { name: groupName })}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {t('admin.attributeGroups.cancelButton')}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            style={{ backgroundColor: 'var(--v3-danger, #dc2626)', color: '#fff' }}
          >
            {t('admin.attributeGroups.deleteButton')}
          </Button>
        </div>
      </div>
    </div>
  );
}
