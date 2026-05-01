import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import type { ApiUser, UserRole } from '../api';

const ROLE_OPTIONS: ReadonlyArray<UserRole> = [
  'admin',
  'cashier',
  'waiter',
  'kitchen',
];

export interface UserDrawerSubmit {
  email: string;
  name: string;
  role: UserRole;
  password?: string;
}

interface UserDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialUser?: ApiUser | null;
  /** True when target is the current admin (kendin); rolünü değiştirme engellenir. */
  isSelf?: boolean;
  isSubmitting: boolean;
  onSubmit: (values: UserDrawerSubmit) => Promise<void> | void;
}

/**
 * Yeni / Düzenle ortak modal. Görev 35.
 *
 * Mode: 'create' → email + name + role + password
 * Mode: 'edit'   → email + name + role (password ResetPasswordDialog'dan)
 *
 * Self-edit: isSelf=true ise rol seçimi disabled (admin'in kendi rolünü
 * düşürmesi domain kuralı + UX guard; backend zaten son admin guard'lı).
 */
export function UserDrawer({
  open,
  onOpenChange,
  mode,
  initialUser,
  isSelf = false,
  isSubmitting,
  onSubmit,
}: UserDrawerProps) {
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('cashier');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initialUser) {
      setEmail(initialUser.email);
      setName(initialUser.name);
      setRole(initialUser.role);
      setPassword('');
    } else {
      setEmail('');
      setName('');
      setRole('cashier');
      setPassword('');
    }
    setTouched(false);
  }, [open, mode, initialUser]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const nameValid = name.trim().length >= 2;
  const passwordValid = mode === 'edit' || password.length >= 10;
  const formValid = emailValid && nameValid && passwordValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!formValid) return;
    const payload: UserDrawerSubmit = {
      email: email.trim(),
      name: name.trim(),
      role,
    };
    if (mode === 'create') {
      payload.password = password;
    }
    await onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? t('admin.users.drawer.createTitle')
              : t('admin.users.drawer.editTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="user-email" className="mb-1.5 block">
              {t('admin.users.fields.email')}
            </Label>
            <Input
              id="user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              aria-invalid={touched && !emailValid}
              disabled={isSubmitting}
            />
            {touched && !emailValid && (
              <p className="mt-1 text-[12px] text-destructive">
                {t('admin.users.errors.invalidEmail')}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="user-name" className="mb-1.5 block">
              {t('admin.users.fields.name')}
            </Label>
            <Input
              id="user-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              aria-invalid={touched && !nameValid}
              disabled={isSubmitting}
            />
            {touched && !nameValid && (
              <p className="mt-1 text-[12px] text-destructive">
                {t('admin.users.errors.invalidName')}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="user-role" className="mb-1.5 block">
              {t('admin.users.fields.role')}
            </Label>
            <select
              id="user-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              disabled={isSubmitting || isSelf}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`admin.users.roles.${r}`)}
                </option>
              ))}
            </select>
            {isSelf && (
              <p
                className="mt-1 text-[12px]"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('admin.users.drawer.cannotChangeOwnRole')}
              </p>
            )}
          </div>

          {mode === 'create' && (
            <div>
              <Label htmlFor="user-password" className="mb-1.5 block">
                {t('admin.users.fields.password')}
              </Label>
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={touched && !passwordValid}
                disabled={isSubmitting}
              />
              {touched && !passwordValid ? (
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
          )}

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
              {mode === 'create'
                ? t('admin.users.drawer.createSubmit')
                : t('admin.users.drawer.editSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
