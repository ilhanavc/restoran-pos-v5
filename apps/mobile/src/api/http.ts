import {
  classifyRefreshFailure,
  type RefreshFailure,
} from '@restoran-pos/shared-domain';
import { RefreshResponseSchema } from '@restoran-pos/shared-types';

import { API_BASE_URL } from '../config';
import { useAuthStore } from '../store/auth';
import { ApiError } from './errors';

/**
 * Low-level HTTP transport (ADR-026 K8 + Amendment 2026-06-29 PR-5d C).
 *
 * A thin `fetch` wrapper (no axios) that mirrors the web client's contract:
 *  - injects `Authorization: Bearer <accessToken>` from the in-memory auth store,
 *  - normalizes the backend error envelope `{ error: { code } }` into an
 *    {@link ApiError} carrying just the code (never PII / never the body),
 *  - on a 401 runs a SINGLE-FLIGHT silent refresh (mobile body-refresh: header
 *    `X-Refresh-Request: 1` + `{ refreshToken }`), rotates the stored tokens and
 *    retries the original request once; if refresh fails it logs the waiter out
 *    so the navigator gate falls back to Login.
 *
 * Transport failures (no connection / timeout) surface as `ApiError('NETWORK_ERROR')`
 * so screens show a "check your connection" message rather than a wrong-password one.
 */

const REFRESH_PATH = '/auth/refresh';
const LOGIN_PATH = '/auth/login';
const LOGOUT_PATH = '/auth/logout';
const REQUEST_TIMEOUT_MS = 15_000;

/** Transport-layer error code (no backend equivalent — local only). */
const NETWORK_ERROR = 'NETWORK_ERROR';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /**
   * Gövde NESNE olarak verilir — `apiRequest` kendisi `JSON.stringify` eder.
   * Önceden `unknown`'dı; çağıran yanlışlıkla stringify edilmiş bir değer
   * geçince (`JSON.stringify({...})`) gövde çift kodlanıp üst-seviye JSON
   * string'ine dönüşüyor, `express.json({strict})` bunu reddediyordu → istek
   * sunucuya hiç ulaşmadan patlıyordu. `object` tipi bunu derleme anında
   * imkânsız kılar (string primitive'i atanamaz).
   */
  body?: object;
  /** Attach the Bearer access token (default true). Login/refresh pass false. */
  auth?: boolean;
  /** Extra request headers (e.g. `X-Client: mobile` on login). */
  headers?: Record<string, string>;
  /** Internal: set on the post-refresh retry to prevent an infinite loop. */
  _retry?: boolean;
}

/** Single-flight guard: concurrent 401s share one refresh round-trip. */
let refreshPromise: Promise<string> | null = null;

/** Map a non-2xx Response to an ApiError carrying the backend error code. */
async function toApiError(res: Response): Promise<ApiError> {
  let code = `HTTP_${String(res.status)}`;
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    if (typeof body.error?.code === 'string') {
      code = body.error.code;
    }
  } catch {
    // Non-JSON error body — keep the generic HTTP_<status> code.
  }
  return new ApiError(code);
}

/**
 * `performRefresh`'in fırlattığı hata — çağıran `classifyRefreshFailure` ile
 * oturumu düşürüp düşürmeyeceğine karar verebilsin diye SEBEBİ taşır.
 * ADR-002 §13.
 */
class RefreshFailedError extends Error {
  constructor(readonly failure: RefreshFailure) {
    super('refresh failed');
    this.name = 'RefreshFailedError';
  }
}

async function performRefresh(): Promise<string> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (refreshToken === null) {
    // Token yok → yenilenecek bir şey yok, oturum gerçekten bitti.
    throw new RefreshFailedError({ kind: 'http', status: 401 });
  }

  // 🔴 TIMEOUT ŞART — ADR-002 §13.4. Buradaki asıl kazanç beklemeyi kısaltmak
  // DEĞİL, **canlılık (liveness)**: çağıran `refreshPromise ??= performRefresh()
  // .finally(() => { refreshPromise = null })` deseniyle single-flight yapıyor
  // ve `finally` yalnız promise SETTLE olunca koşuyor. Timeout yokken takılan
  // bir bağlantıda promise hiç settle olmaz → `refreshPromise` null'a dönmez →
  // sonraki her 401 aynı ölü promise'i bekler → uygulama SESSİZCE kilitlenir.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${REFRESH_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // CSRF-lite guard required by the backend (auth.ts).
        'X-Refresh-Request': '1',
      },
      body: JSON.stringify({ refreshToken }),
      signal: controller.signal,
    });
  } catch {
    // Abort (timeout) veya ağ hatası → token'ın geçerliliği hakkında bilgi YOK.
    throw new RefreshFailedError({ kind: 'network' });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new RefreshFailedError({ kind: 'http', status: res.status });
  }
  const parsed = RefreshResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    // ⚠️ DAVRANIŞ DEĞİŞİKLİĞİ (Amd7): eskiden burada `AUTH_REFRESH_INVALID`
    // fırlatılıyordu ve bu ZORLA ÇIKIŞ demekti. Artık 2xx statüsü taşındığı
    // için sınıflandırma `keep-session` veriyor.
    // Gerekçe 5xx'le AYNI: sunucu 2xx döndüyse kimlik doğrulaması geçmiştir;
    // gövdenin kontrata uymaması bir **sunucu/deploy uyumsuzluğudur**, kimlik
    // sorunu değil. Bozuk bir deploy'da tüm personeli çıkışa zorlamak arızayı
    // büyütür (ADR-002 §13.3'ün 5xx muhakemesi).
    // Bedeli açık: kontrat düzelene kadar istek başarısız olmaya devam eder
    // (kullanıcı bağlantı hatası görür) ama servis ortasında giriş ekranına
    // atılmaz. `!_retry` guard'ı yüzünden sıkı bir döngü oluşmaz.
    throw new RefreshFailedError({ kind: 'http', status: res.status });
  }
  await useAuthStore
    .getState()
    .setTokens(parsed.data.accessToken, parsed.data.refreshToken);
  return parsed.data.accessToken;
}

/**
 * Çıkış: yerel durumu HEMEN temizle, refresh token'ı sunucuda arkada revoke et.
 * ADR-002 §12.6. Her çıkış yolu (kullanıcı düğmesi + zorunlu çıkış) bunu çağırır.
 *
 * ⚠️ NEDEN VAR — S137'ye kadar mobil çıkış sunucuyu HİÇ çağırmıyordu: yalnız
 * SecureStore siliniyordu, dolayısıyla token sunucuda 30 gün daha geçerli
 * kalıyordu (cihaz el değiştirirse / token kopyalanmışsa erişim sürüyordu).
 *
 * 🔴 SIRA BAĞLAYICI: `logout()` ÖNCE, revoke SONRA (güvenlik denetimi C-2).
 * Ters sırada `fetch` `REQUEST_TIMEOUT_MS`(15 sn) kadar bekleyebilir ve ekran o
 * süre boyunca Ayarlar'da kilitli kalır — garson "Çıkış"a basar, hiçbir şey
 * olmaz, **sahipsiz telefon 15 sn kullanılabilir durumda durur**. Yerel
 * temizlik erişimi anında kestiği için beklemenin güvenlik faydası YOK.
 * `void` ile ateşlenir: çağıran revoke'u beklemez.
 *
 * 🔑 BEST-EFFORT, BİLİNÇLİ: sunucu çağrısı başarısız olsa bile (çevrimdışı
 * garson, 5xx, timeout) yerel temizlik yapılmış olur. Aksi halde çevrimdışı bir
 * garson çıkış yapamaz ve uygulama kullanılamaz hale gelir. Bedeli kayda geçer:
 * çevrimdışı çıkışta sunucudaki token 30 gün yaşar (v5.1: revoke kuyruğu).
 *
 * 🔑 ZORUNLU ÇIKIŞ DA BUNU KULLANIR (güvenlik denetimi C-3). "Refresh zaten
 * başarısız oldu, token geçersizdir" gerekçesi YALNIZ 401 için doğru:
 * `performRefresh`'in `fetch`'i try'ın İÇİNDE olduğu için **ağ hatası** da aynı
 * `catch`'e düşer ve o durumda token sunucuda CANLIDIR. 401 hâlinde revoke ucuz
 * bir no-op'tur (`revokeByTokenHash` `revoked_at IS NULL` ile filtreler).
 */
export async function logoutAndRevoke(): Promise<void> {
  // Token'ı temizlikten ÖNCE yakala — `logout()` store'u sıfırlıyor.
  const refreshToken = useAuthStore.getState().refreshToken;

  await useAuthStore.getState().logout();

  if (refreshToken === null) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      await fetch(`${API_BASE_URL}${LOGOUT_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Best-effort: ağ/timeout/sunucu hatası yutulur (docblock'a bkz.).
  }
}

/**
 * Perform a JSON request and return the parsed body (or `undefined` for 204).
 * Throws {@link ApiError} on a non-2xx response or transport failure.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, headers = {}, _retry = false } =
    options;

  const finalHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token !== null) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // Aborted (timeout) or network failure — no PII to surface.
    throw new ApiError(NETWORK_ERROR);
  } finally {
    clearTimeout(timeoutId);
  }

  // 401 → single-flight refresh + retry once (auth endpoints excluded).
  if (
    res.status === 401 &&
    auth &&
    !_retry &&
    path !== REFRESH_PATH &&
    path !== LOGIN_PATH
  ) {
    try {
      refreshPromise ??= performRefresh().finally(() => {
        refreshPromise = null;
      });
      await refreshPromise;
    } catch (err) {
      // ADR-002 §13 (Amd7) — AĞ HATASI İLE 401 BURADA AYRILIR.
      //
      // Önceden bu `catch` ayrım yapmıyordu: `performRefresh`'in HER hatası
      // çıkışa yol açıyordu. Şebeke bir an titrediğinde garson, token'ı
      // sunucuda hâlâ GEÇERLİ olmasına rağmen oturumdan atılıyordu.
      const failure: RefreshFailure =
        err instanceof RefreshFailedError ? err.failure : { kind: 'network' };

      if (classifyRefreshFailure(failure) === 'keep-session') {
        // Oturuma DOKUNMA. İstek başarısız sayılır, ekranlar mevcut
        // `NETWORK_ERROR` metnini ("Sunucuya bağlanılamadı…") gösterir.
        // 🔑 Amd6 §12.6'nın "zorunlu çıkış da revoke eder" hükmünün AĞ dalı
        // buraya düştüğü için artık çağrılmıyor — doğrusu da bu: token canlı,
        // revoke edilecek bir şey yok. 401 dalı aşağıda aynen sürüyor.
        throw new ApiError(NETWORK_ERROR);
      }

      // Oturum gerçekten bitti. Sebebi giriş ekranına taşı — ⚠️ SIRA: `logout()`
      // store'u sıfırlıyor, bu yüzden sebep ONDAN SONRA yazılır (ADR §13.6).
      await logoutAndRevoke();
      useAuthStore.getState().setLogoutReason('session-ended');
      throw new ApiError('AUTH_TOKEN_INVALID');
    }
    return apiRequest<T>(path, { ...options, _retry: true });
  }

  if (!res.ok) {
    throw await toApiError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
