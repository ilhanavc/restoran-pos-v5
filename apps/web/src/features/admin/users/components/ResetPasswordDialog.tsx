import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';

interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userLabel: string;
  isSubmitting: boolean;
  onConfirm: (newPassword: string) => Promise<void>;
}

/**
 * Admin başka kullanıcı için şifre sıfırlar. Backend rate-limit 5/15dk/IP.
 * Kendi şifre değişimi MVP dışı (Profil ekranı v5.1+).
 */
export function ResetPasswordDialog({
  open,
  onOpenChange,
  userLabel,
  isSubmitting,
  onConfirm,
}: ResetPasswordDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword('');
      setTouched(false);
    }
  }, [open]);

  const valid = password.length >= 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    await onConfirm(password);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.users.resetPasswordDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('admin.users.resetPasswordDialog.body', { name: userLabel })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <Label htmlFor="reset-password" className="mb-1.5 block">
              {t('admin.users.fields.newPassword')}
            </Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={touched && !valid}
              disabled={isSubmitting}
            />
            {touched && !valid ? (
              <p className="mt-1 text-[12px] text-destructive">
                {t('admin.users.errors.passwordTooShort')}
              </p>
            ) : (
              <p
                className="mt-1 text-[12px]"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('admin.users.fields.passwordHelp')}
              </p>
            )}
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-1.5">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('admin.users.resetPasswordDialog.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
