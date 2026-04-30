import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChefHat, Mail, Lock, Loader2, ArrowRight } from 'lucide-react';
import { LoginRequestSchema, type LoginRequest } from '@restoran-pos/shared-types';
import { AuthLayout } from '../../components/layout/AuthLayout';
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
      <div className="rounded-2xl border border-white/60 bg-white/75 p-8 shadow-[0_20px_60px_-15px_rgba(180,83,9,0.20)] backdrop-blur-xl sm:p-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-md shadow-amber-500/20">
            <ChefHat className="h-8 w-8 text-white" strokeWidth={2.25} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {t('auth.login.title')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('auth.login.subtitle')}</p>
        </div>

        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              {t('auth.login.email.label')}
            </Label>
            <div className="relative">
              <Mail
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder={t('auth.login.email.placeholder')}
                aria-invalid={errors.email ? 'true' : 'false'}
                className="h-12 pl-10 transition-all focus-visible:ring-2 focus-visible:ring-orange-500/40"
                {...register('email')}
              />
            </div>
            {errors.email && (
              <p className="text-xs text-destructive" role="alert">
                {t('auth.login.email.invalid')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">
              {t('auth.login.password.label')}
            </Label>
            <div className="relative">
              <Lock
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder={t('auth.login.password.placeholder')}
                aria-invalid={errors.password ? 'true' : 'false'}
                className="h-12 pl-10 transition-all focus-visible:ring-2 focus-visible:ring-orange-500/40"
                {...register('password')}
              />
            </div>
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
              className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-orange-700 underline-offset-4 transition-colors hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 rounded-sm"
            >
              {t('auth.forgotPassword.link')}
            </button>
          </div>

          <Button
            type="submit"
            disabled={login.isPending}
            className="group h-12 w-full bg-gradient-to-r from-amber-500 to-orange-500 text-base font-semibold shadow-md shadow-amber-500/25 transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-lg hover:shadow-amber-500/30 disabled:from-amber-300 disabled:to-orange-300 disabled:shadow-none"
          >
            {login.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('auth.login.submitting')}
              </>
            ) : (
              <>
                {t('auth.login.submit')}
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </Button>
        </form>
      </div>

      <ForgotPasswordModal open={forgotOpen} onOpenChange={setForgotOpen} />
    </AuthLayout>
  );
}
