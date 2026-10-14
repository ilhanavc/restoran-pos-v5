import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Mail, Lock, Loader2, ArrowRight, Store, ChevronDown } from 'lucide-react';
import { LoginRequestSchema, type LoginRequest } from '@restoran-pos/shared-types';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { useLogin } from './api';
import { useAuthStore } from '../../store/auth';
import { clearSessionEndedFlag, wasSessionRecentlyEnded } from '../../lib/api';
import { getErrorMessage } from '../../lib/error';

/**
 * ADR-042 K1.7 — hatırlanan işletme kodu.
 *
 * Kod `tenants.slug`'tır ve **kişisel veri değildir** (işletme kodu, KVKK
 * envanterinde böyle kayıtlı) → `localStorage`'da tutulması sakıncasızdır.
 * Erişilemezse (gizli pencere, storage engelli) sessizce boşa düşer; boş
 * bırakmak zaten **geçerli** bir giriştir (varsayılan işletmeye düşer).
 */
const TENANT_SLUG_STORAGE_KEY = 'pos.login.tenantSlug';

/**
 * İşletme kodunu istemci tarafında normalize eder (ADR-042 K1.1 — iki taraflı
 * normalize; sunucu da ayrıca normalize eder, tek tarafa güvenilmez).
 *
 * 🔑 **Türkçe I ailesi ÖNCE eşlenir.** `"İ".toLowerCase()` JavaScript'te `i` +
 * BİRLEŞİK NOKTA (U+0307) üretir, `"I".toLowerCase()` ise `i` verir ama Türkçe
 * doğru karşılığı `ı`'dır. Türk klavyesinde `DİLAN` yazan kullanıcı, kod salt
 * ASCII olduğu için (mig 068 CHECK) reddedilir ve **sebebini asla bulamaz** —
 * ekranda küçük harf yazdığını görür. Ampirik: `DİLAN` → RED, `DILAN` → KABUL.
 * Üç harfi de `i`'ye eşlemek bu sınıfı kapatır; kod gizli bir değer olmadığı
 * için güvenlik etkisi yoktur, yanlış kod zaten sunucuda 401 alır.
 */
export function normalizeTenantSlugInput(raw: string): string {
  return raw.trim().replace(/[İIı]/g, 'i').toLowerCase();
}

function readStoredTenantSlug(): string {
  try {
    return localStorage.getItem(TENANT_SLUG_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistTenantSlug(slug: string | undefined): void {
  try {
    if (slug === undefined || slug === '') {
      localStorage.removeItem(TENANT_SLUG_STORAGE_KEY);
    } else {
      localStorage.setItem(TENANT_SLUG_STORAGE_KEY, slug);
    }
  } catch {
    // kalıcılık best-effort — hata yut
  }
}

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const login = useLogin();
  const [forgotOpen, setForgotOpen] = useState(false);

  /**
   * ADR-002 §13.5 (Amd7) — oturum sunucu tarafından sonlandırıldıysa sebebi
   * söyle. Bayrak `lib/api.ts` interceptor'ında yazıldı ve araya giren TAM
   * SAYFA RELOAD'u `sessionStorage` sayesinde aştı.
   *
   * 🔑 Toast DEĞİL kalıcı şerit: reload'dan sonra mount olan bir toast
   * otomatik kapanır ve kullanıcı sebebi kaçırabilir.
   *
   * 🔑 Okuma YAN ETKİSİZ (silmez) — mount sayısı deterministik değil, bkz.
   * `lib/api.ts` `SESSION_ENDED_TTL_MS` docblock'u. Bayrak başarılı girişte
   * geçersiz kılınır, ayrıca penceresi dolunca kendiliğinden susar.
   */
  const [sessionEnded] = useState(() => wasSessionRecentlyEnded());

  const [storedSlug] = useState(readStoredTenantSlug);
  const [slugOpen, setSlugOpen] = useState(false);
  const [loginFailed, setLoginFailed] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { email: '', password: '', tenantSlug: storedSlug || undefined },
  });

  /**
   * Panel elle açılabilir, ama İKİ durumda **kendiliğinden** açılır:
   *
   * 1. `errors.tenantSlug` — biçim hatası. Panel kapalıyken hata görünmezdi;
   *    kullanıcı "Giriş Yap"a basar, `noValidate` yüzünden tarayıcı da bir şey
   *    söylemez ve **hiçbir şey olmaz**. Bozuk bir `localStorage` değeri bu
   *    duruma tek başına yol açabilir (alan varsayılanı oradan geliyor).
   * 2. `loginFailed` — 401 sonrası. Sunucu bilerek ayırt edici hata vermiyor
   *    (enumeration savunması), ama İSTEMCİ kodun kullanılıp kullanılmadığını
   *    biliyor. Panel açılıp kalıcı ipucu gösterilir; yoksa kullanıcı şifreyi
   *    suçlar ve yanlış/bayat kodu asla aklına getirmez.
   */
  const slugPanelOpen = slugOpen || errors.tenantSlug !== undefined || loginFailed;

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const onSubmit = handleSubmit((values) => {
    login.mutate(values, {
      onSuccess: () => {
        // Başarılı giriş "oturum sona erdi" bilgisini geçersiz kılar.
        clearSessionEndedFlag();
        setLoginFailed(false);
        // Kod YALNIZ başarılı girişten sonra hatırlanır — yanlış yazılmış bir
        // kodu kalıcılaştırmak, kullanıcıyı her girişte aynı hataya düşürürdü.
        persistTenantSlug(values.tenantSlug);
        navigate('/dashboard', { replace: true });
      },
      onError: (err) => {
        setLoginFailed(true);
        toast.error(getErrorMessage(err));
      },
    });
  });

  return (
    <AuthLayout>
      <div className="rounded-2xl border border-white/60 bg-white/75 p-8 shadow-[0_20px_60px_-15px_rgba(180,83,9,0.20)] backdrop-blur-xl sm:p-10">
        <div className="mb-8 flex flex-col items-center text-center">
          {/* S106 — jenerik ChefHat kutusu gerçek restoran logosuyla değişti. */}
          <img
            src="/brand/favicon.svg"
            alt=""
            aria-hidden="true"
            className="mb-4 h-16 w-16 rounded-2xl shadow-md shadow-amber-500/20"
          />
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {t('auth.login.title')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('auth.login.subtitle')}</p>
        </div>

        {/*
          hci kapısı: ton BİLGİ, hata DEĞİL. "Oturumunuz sona erdi" kullanıcının
          hatası değil; `destructive`/kırmızı suçlayıcı okunur ve gerçek alan
          hatalarıyla (aşağıdaki `text-destructive` mesajları) karışır. Amber
          giriş kartının mevcut temasıyla da uyumlu.

          `role="status"` + `aria-live="polite"`: `role="alert"` assertive'dir ve
          sayfa yüklenirken HAZIR bulunan bir canlı bölge genelde hiç
          duyurulmaz — bu şerit tam olarak yükleme anında var oluyor.
        */}
        {sessionEnded && (
          <div
            role="status"
            aria-live="polite"
            data-testid="session-ended-banner"
            className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {t('auth.error.tokenInvalid')}
          </div>
        )}

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

          {/*
            ADR-042 K1.7 — işletme kodu. VARSAYILAN OLARAK KAPALI bir açılır
            bölümde durur; boş bırakmak geçerli bir giriştir (sunucu varsayılan
            işletmeye düşer). Gerekçe: bugün tek işletme var ve alan her gün
            kullanılan bu ekrana sıfır fayda katacaktı — ADR'nin kendi hedefi de
            "steady-state'te garson fazladan hiçbir şey yazmaz". İkinci şube
            geldiğinde kod hatırlandığı için yine tek tık bile gerekmez; özet
            satırı hangi işletmeye girileceğini gösterir.
          */}
          <div className="rounded-md border border-border/60 bg-muted/20">
            <button
              type="button"
              onClick={() => setSlugOpen((v) => !v)}
              aria-expanded={slugPanelOpen}
              aria-controls="tenant-slug-panel"
              className="flex min-h-11 w-full items-center gap-2 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 rounded-md"
            >
              <Store aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">
                {storedSlug !== ''
                  ? t('auth.login.tenantSlug.current', { slug: storedSlug })
                  : t('auth.login.tenantSlug.toggle')}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 shrink-0 transition-transform ${slugPanelOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {slugPanelOpen && (
              <div id="tenant-slug-panel" className="space-y-2 px-3 pb-3">
                <Label htmlFor="tenantSlug" className="text-sm font-medium">
                  {t('auth.login.tenantSlug.label')}
                </Label>
                <Input
                  id="tenantSlug"
                  type="text"
                  inputMode="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="organization"
                  placeholder={t('auth.login.tenantSlug.placeholder')}
                  aria-invalid={errors.tenantSlug ? 'true' : 'false'}
                  aria-describedby="tenantSlug-hint"
                  className="h-12 transition-all focus-visible:ring-2 focus-visible:ring-orange-500/40"
                  {...register('tenantSlug', {
                    // 🔑 Boş string UNDEFINED'a çevrilir. Şema `.optional()` ama
                    // regex'li: '' doğrulamadan GEÇMEZ ve "boş bırakmak geçerli"
                    // kuralı sessizce kırılır, kullanıcı gönderemez.
                    // Ayrıca ADR'nin istediği istemci-tarafı normalize burada
                    // yapılır (sunucu da ayrıca normalize eder — tek tarafa
                    // güvenilmez).
                    setValueAs: (v: unknown) => {
                      if (typeof v !== 'string') return undefined;
                      const n = normalizeTenantSlugInput(v);
                      return n === '' ? undefined : n;
                    },
                  })}
                />
                <p id="tenantSlug-hint" className="text-xs text-muted-foreground">
                  {t('auth.login.tenantSlug.hint')}
                </p>
                {loginFailed && errors.tenantSlug === undefined && (
                  // Kalıcı satır, toast DEĞİL: toast kaybolur ve kullanıcı
                  // sebebi kaçırır. Metin işletmenin VARLIĞI hakkında hiçbir
                  // şey söylemez → enumeration savunması zayıflamaz.
                  <p
                    role="alert"
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                  >
                    {t('auth.login.tenantSlug.checkAfterFailure')}
                  </p>
                )}
                {errors.tenantSlug && (
                  <p className="text-xs text-destructive" role="alert">
                    {t('auth.login.tenantSlug.invalid')}
                  </p>
                )}
              </div>
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
