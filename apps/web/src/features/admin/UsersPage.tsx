import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useAuthStore } from '../../store/auth';
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useResetUserPassword,
  type ApiUser,
  type UserRole,
} from './users/api';
import { UserDrawer, type UserDrawerSubmit } from './users/components/UserDrawer';
import { DeleteUserDialog } from './users/components/DeleteUserDialog';
import { ResetPasswordDialog } from './users/components/ResetPasswordDialog';

/**
 * Kullanıcılar admin sayfası — Görev 35 (Session 49).
 *
 * Backend: apps/api/src/routes/users.ts (PR #35).
 * Erişim: yalnız admin (backend authorize, UI route koruması yok ama
 * cashier sayfayı açarsa GET 403 döner, error state görünür).
 *
 * V3 paritesi: V3'te yok — sıfırdan v5 ekran.
 *
 * Kapsam (MVP):
 *   - Liste, oluştur, güncelle (email/name/role), soft-delete, şifre sıfırla
 * v5.1+:
 *   - Pagination, arama backend'i, profil ekranı (self-password change)
 */
export default function UsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const usersQuery = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const resetPassword = useResetUserPassword();

  const [search, setSearch] = useState('');
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<ApiUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiUser | null>(null);
  const [resetTarget, setResetTarget] = useState<ApiUser | null>(null);

  const users = usersQuery.data ?? [];

  const filteredUsers = useMemo(() => {
    const sorted = [...users].sort((a, b) =>
      a.email.localeCompare(b.email, 'tr'),
    );
    const q = search.trim().toLocaleLowerCase('tr');
    if (!q) return sorted;
    return sorted.filter(
      (u) =>
        u.email.toLocaleLowerCase('tr').includes(q) ||
        u.name.toLocaleLowerCase('tr').includes(q),
    );
  }, [users, search]);

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { code?: string; message?: string } }
        | undefined;
      const code = data?.error?.code;
      if (code) {
        const localized = t(`admin.users.errors.${code}`, { defaultValue: '' });
        if (localized) return localized;
      }
      return data?.error?.message ?? fallback;
    }
    return fallback;
  };

  const handleBack = () => navigate('/dashboard');

  const handleSubmit = async (values: UserDrawerSubmit) => {
    try {
      if (drawerMode === 'create') {
        await createUser.mutateAsync({
          email: values.email,
          password: values.password ?? '',
          role: values.role,
          name: values.name,
        });
        toast.success(t('admin.users.createSuccess'));
      } else if (drawerMode === 'edit' && editTarget) {
        await updateUser.mutateAsync({
          id: editTarget.id,
          patch: {
            email: values.email,
            name: values.name,
            role: values.role,
          },
        });
        toast.success(t('admin.users.updateSuccess'));
      }
      setDrawerMode(null);
      setEditTarget(null);
    } catch (err) {
      toast.error(extractError(err, t('admin.users.errors.saveFailed')));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteUser.mutateAsync(deleteTarget.id);
      toast.success(t('admin.users.deleteSuccess'));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(extractError(err, t('admin.users.errors.deleteFailed')));
    }
  };

  const handleResetPassword = async (newPassword: string) => {
    if (!resetTarget) return;
    try {
      await resetPassword.mutateAsync({
        id: resetTarget.id,
        newPassword,
      });
      toast.success(t('admin.users.resetPasswordSuccess'));
      setResetTarget(null);
    } catch (err) {
      toast.error(extractError(err, t('admin.users.errors.resetFailed')));
    }
  };

  return (
    <AppShell>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
        <h1
          className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('admin.users.title')}
        </h1>
        <button
          type="button"
          onClick={handleBack}
          aria-label={t('admin.users.back')}
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
          {t('admin.users.back')}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6">
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
              placeholder={t('admin.users.searchPlaceholder')}
              className="h-10 pl-9"
              aria-label={t('admin.users.searchPlaceholder')}
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              setEditTarget(null);
              setDrawerMode('create');
            }}
            className="gap-1.5"
          >
            <Plus size={16} />
            {t('admin.users.newUserButton')}
          </Button>
        </div>

        {usersQuery.isPending && (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2
              className="h-6 w-6 animate-spin"
              style={{ color: 'var(--v3-text-muted)' }}
            />
          </div>
        )}

        {usersQuery.isError && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-danger, #dc2626)',
              color: 'var(--v3-danger, #dc2626)',
            }}
          >
            {t('admin.users.errors.loadFailed')}
          </div>
        )}

        {usersQuery.isSuccess && filteredUsers.length === 0 && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-muted)',
            }}
          >
            {users.length === 0
              ? t('admin.users.empty')
              : t('admin.users.noResults')}
          </div>
        )}

        {usersQuery.isSuccess && filteredUsers.length > 0 && (
          <div
            className="overflow-hidden rounded-md border bg-white"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <div
              className="grid grid-cols-[2fr_1.5fr_1fr_auto] items-center gap-3 border-b px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider"
              style={{
                borderColor: 'var(--v3-border-subtle)',
                background: 'var(--v3-surface-1)',
                color: 'var(--v3-text-muted)',
              }}
            >
              <div>{t('admin.users.table.email')}</div>
              <div>{t('admin.users.table.name')}</div>
              <div>{t('admin.users.table.role')}</div>
              <div className="text-right">{t('admin.users.table.actions')}</div>
            </div>

            {filteredUsers.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <div
                  key={user.id}
                  className="grid grid-cols-[2fr_1.5fr_1fr_auto] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0 hover:bg-stone-50/40"
                  style={{ borderColor: 'var(--v3-border-subtle)' }}
                >
                  <div className="truncate font-medium">{user.email}</div>
                  <div
                    className="truncate"
                    style={{ color: 'var(--v3-text-secondary)' }}
                  >
                    {user.name}
                  </div>
                  <div>
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                      style={{
                        background: roleBadgeBg(user.role),
                        color: roleBadgeFg(user.role),
                      }}
                    >
                      {t(`admin.users.roles.${user.role}`)}
                    </span>
                    {isSelf && (
                      <span
                        className="ml-2 text-[11px]"
                        style={{ color: 'var(--v3-text-muted)' }}
                      >
                        ({t('admin.users.youLabel')})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditTarget(user);
                        setDrawerMode('edit');
                      }}
                      aria-label={t('admin.users.actions.edit')}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setResetTarget(user)}
                      disabled={isSelf}
                      aria-label={t('admin.users.actions.resetPassword')}
                      title={
                        isSelf
                          ? t('admin.users.actions.selfResetDisabled')
                          : undefined
                      }
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <KeyRound size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(user)}
                      disabled={isSelf}
                      aria-label={t('admin.users.actions.delete')}
                      title={
                        isSelf
                          ? t('admin.users.actions.selfDeleteDisabled')
                          : undefined
                      }
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <UserDrawer
        open={drawerMode !== null}
        onOpenChange={(v) => {
          if (!v) {
            setDrawerMode(null);
            setEditTarget(null);
          }
        }}
        mode={drawerMode ?? 'create'}
        initialUser={editTarget}
        isSelf={editTarget?.id === currentUserId}
        isSubmitting={createUser.isPending || updateUser.isPending}
        onSubmit={handleSubmit}
      />

      <DeleteUserDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        userLabel={deleteTarget?.email ?? ''}
        onConfirm={handleDelete}
        isDeleting={deleteUser.isPending}
      />

      <ResetPasswordDialog
        open={resetTarget !== null}
        onOpenChange={(v) => !v && setResetTarget(null)}
        userLabel={resetTarget?.email ?? ''}
        isSubmitting={resetPassword.isPending}
        onConfirm={handleResetPassword}
      />
    </AppShell>
  );
}

function roleBadgeBg(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '#fef3c7';
    case 'cashier':
      return '#dbeafe';
    case 'waiter':
      return '#dcfce7';
    case 'kitchen':
      return '#fce7f3';
  }
}

function roleBadgeFg(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '#92400e';
    case 'cashier':
      return '#1e40af';
    case 'waiter':
      return '#166534';
    case 'kitchen':
      return '#9d174d';
  }
}
