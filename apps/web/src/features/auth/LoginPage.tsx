import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { LoginRequestSchema, type LoginRequest } from '@restoran-pos/shared-types';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { useLogin } from './api';
import { useAuthStore } from '../../store/auth';
import { getErrorMessage } from '../../lib/error';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const login = useLogin();
  const [forgotOpen, setForgotOpen] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  // Already authenticated → /dashboard.
  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const onSubmit = handleSubmit((values) => {
    login.mutate(values, {
      onSuccess: () => navigate('/dashboard', { replace: true }),
      onError: (err) => toast.error(getErrorMessage(err)),
    });
  });

  return (
    <AuthLayout>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">{t('auth.login.title')}</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">{t('auth.login.subtitle')}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.login.email.label')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder={t('auth.login.email.placeholder')}
                aria-invalid={errors.email ? 'true' : 'false'}
                {...register('email')}
              />
              {errors.email && (
                <p className="text-xs text-destructive" role="alert">
                  {t('auth.login.email.invalid')}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.login.password.label')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder={t('auth.login.password.placeholder')}
                aria-invalid={errors.password ? 'true' : 'false'}
                {...register('password')}
              />
              {errors.password && (
                <p className="text-xs text-destructive" role="alert">
                  {t('auth.login.password.required')}
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setForgotOpen(true)}
                className="inline-flex min-h-11 items-center px-2 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                {t('auth.forgotPassword.link')}
              </button>
            </div>

            <Button type="submit" size="default" className="w-full" disabled={login.isPending}>
              {login.isPending ? t('auth.login.submitting') : t('auth.login.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ForgotPasswordModal open={forgotOpen} onOpenChange={setForgotOpen} />
    </AuthLayout>
  );
}
