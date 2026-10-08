import {
  classifyRefreshFailure,
  type RefreshFailure,
} from '@restoran-pos/shared-domain';
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { env } from './env';
import { useAuthStore } from '../store/auth';

/**
 * Axios instance for the cloud backend.
 * - withCredentials: true → refresh httpOnly cookie is sent automatically.
 * - Authorization header injected from in-memory access token (Zustand).
 * - 401 interceptor: single-flight refresh + retry; on refresh failure → clear + redirect.
 *
 * ADR-002 §3 (token transport), ADR-011 §3 (auth flow).
 */
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * Refresh çağrısının timeout'u. `api` instance'ının timeout'u düz
 * `axios.post`'a uygulanmadığı için AÇIKÇA verilmek zorunda (ADR-002 §13.4).
 * Değer `apiRequest`/instance ile aynı tutuluyor — tutarlılık; refresh'i daha
 * kısa tutmak ayrı bir karar ister.
 */
const REFRESH_TIMEOUT_MS = REQUEST_TIMEOUT_MS;

/**
 * Oturumun sunucu tarafından sonlandırıldığını giriş sayfasına taşıyan
 * tek-kullanımlık bayrak (ADR-002 §13.5).
 *
 * 🔑 NEDEN `sessionStorage`, NEDEN STORE DEĞİL: `useAuthStore` persist
 * EDİLMİYOR (`store/auth.ts` — salt bellekte) ve aşağıdaki yönlendirme
 * `window.location.href` ile **tam sayfa reload** yapıyor → store sıfırlanır,
 * bayrak kaybolur. `sessionStorage` sekme ömrü boyunca yaşar, sekme kapanınca
 * gider — geçici bir UI bilgisi için doğru yer.
 */
const SESSION_ENDED_FLAG = 'auth.sessionEnded';

/** Bayrağı yaz. Depolama engelliyse (private mode) akışı BOZMA. */
function markSessionEnded(): void {
  try {
    sessionStorage.setItem(SESSION_ENDED_FLAG, '1');
  } catch {
    // Bayrak kaybolur, kullanıcı açıklama görmez — ama çıkış akışı sürer.
  }
}

/** Bayrağı oku ve SİL (tek kullanımlık). LoginPage mount'ta çağırır. */
export function consumeSessionEndedFlag(): boolean {
  try {
    const found = sessionStorage.getItem(SESSION_ENDED_FLAG) === '1';
    if (found) sessionStorage.removeItem(SESSION_ENDED_FLAG);
    return found;
  } catch {
    return false;
  }
}

export const api = axios.create({
  baseURL: env.VITE_API_BASE_URL,
  withCredentials: true,
  timeout: REQUEST_TIMEOUT_MS,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  // CSRF-lite (backend auth.ts:164): /auth/refresh çağrılarında zorunlu header.
  if (config.url === '/auth/refresh') {
    config.headers.set('X-Refresh-Request', '1');
  }
  return config;
});

interface RetryableConfig extends AxiosRequestConfig {
  _retry?: boolean;
  url?: string;
}

let refreshPromise: Promise<string> | null = null;

async function performRefresh(): Promise<string> {
  // Plain axios call (no interceptor recursion).
  // CSRF-lite (backend auth.ts:164): X-Refresh-Request header şart.
  const res = await axios.post<{ accessToken: string }>(
    `${env.VITE_API_BASE_URL}/auth/refresh`,
    {},
    {
      withCredentials: true,
      headers: { 'X-Refresh-Request': '1' },
      // 🔴 TIMEOUT AÇIKÇA VERİLİR — ADR-002 §13.4.
      // Bu DÜZ `axios.post`, yukarıdaki `api` instance'ı DEĞİL → instance'ın
      // `timeout: 15_000`'i buraya UYGULANMAZ ve axios varsayılanı sınırsızdır.
      // Asıl kazanç beklemeyi kısaltmak değil **canlılık (liveness)**: çağıran
      // `refreshPromise ??= performRefresh().finally(() => refreshPromise = null)`
      // ile single-flight yapıyor ve `finally` yalnız promise SETTLE olunca
      // koşuyor. Timeout yokken takılan bağlantıda promise settle olmaz →
      // `refreshPromise` null'a dönmez → sonraki her 401 aynı ölü promise'i
      // bekler → uygulama SESSİZCE kilitlenir.
      timeout: REFRESH_TIMEOUT_MS,
    },
  );
  const newToken = res.data.accessToken;
  useAuthStore.getState().setAccessToken(newToken);
  return newToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetryableConfig | undefined;
    const status = error.response?.status;

    const isRefreshable =
      status === 401 &&
      !!original &&
      !original._retry &&
      original.url !== '/auth/refresh' &&
      original.url !== '/auth/login';

    if (!isRefreshable) {
      return Promise.reject(error);
    }

    original._retry = true;

    refreshPromise ??= performRefresh().finally(() => {
      refreshPromise = null;
    });

    try {
      const token = await refreshPromise;
      const headers = original.headers ?? {};
      // axios v1 supports plain object header assignment.
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
      original.headers = headers;
      return api(original);
    } catch (refreshErr) {
      // ADR-002 §13 (Amd7) — AĞ HATASI İLE 401 BURADA AYRILIR.
      //
      // Önceden bu `catch` ayrım yapmıyordu: refresh'in HER hatası
      // `clearAuth()` + tam sayfa reload demekti. Şebeke bir an titrediğinde
      // kasiyer, token'ı sunucuda hâlâ GEÇERLİ olmasına rağmen sipariş
      // ortasında giriş ekranına atılıyor ve in-memory state'i kaybediyordu.
      const status = (refreshErr as AxiosError).response?.status;
      const failure: RefreshFailure =
        status === undefined
          ? // Yanıt YOK → ağ hatası / timeout / abort.
            { kind: 'network' }
          : { kind: 'http', status };

      if (classifyRefreshFailure(failure) === 'keep-session') {
        // Oturuma DOKUNMA, yönlendirme YOK. Hata olduğu gibi reject edilir →
        // `lib/error.ts` `getErrorMessage` yanıt yokluğunu görüp mevcut
        // `auth.error.networkError` metnini gösterir. Yeni metin gerekmez.
        return Promise.reject(refreshErr);
      }

      // Oturum gerçekten bitti: sebebi reload'un ötesine taşı, sonra mevcut
      // yönlendirme akışını DEĞİŞTİRMEDEN sürdür (mekanizma değişikliği
      // kapsam dışı — ADR §13.5/§13.8).
      markSessionEnded();
      useAuthStore.getState().clearAuth();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(refreshErr);
    }
  },
);
