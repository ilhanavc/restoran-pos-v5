/**
 * Auth ile ilgili ayarlanabilir parametreler (ADR-002 §11.2, Amendment 5).
 *
 * Değerler env'den okunur; yanlış yapılandırma **başlangıçta** reddedilir
 * (`assertAuthConfig()` uygulama açılışında çağrılır) — böylece hatalı bir
 * `AUTH_REFRESH_GRACE_MS` canlıda sessizce güvenlik penceresini genişletemez.
 */

/** RTR reuse-detection grace penceresi varsayılanı (ms) — ADR-002 §11.2. */
export const DEFAULT_REFRESH_GRACE_MS = 60_000;

/** Üst sınır (5 dk). Üstü yanlış yapılandırma sayılır ve reddedilir. */
export const MAX_REFRESH_GRACE_MS = 300_000;

/**
 * Ham env değerini doğrulanmış grace penceresine çevirir.
 *
 * @param raw `AUTH_REFRESH_GRACE_MS` env değeri (tanımsız → varsayılan).
 * @throws Error — sayı değilse, negatifse veya üst sınırı aşıyorsa.
 */
export function resolveRefreshGraceMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_REFRESH_GRACE_MS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `AUTH_REFRESH_GRACE_MS gecersiz: "${raw}" (0 veya pozitif tamsayi ms bekleniyor)`,
    );
  }
  if (parsed > MAX_REFRESH_GRACE_MS) {
    throw new Error(
      `AUTH_REFRESH_GRACE_MS ust siniri asiyor: ${parsed} > ${MAX_REFRESH_GRACE_MS}`,
    );
  }
  return parsed;
}

/**
 * Geçerli grace penceresi (ms). Her çağrıda env okunur — test edilebilirlik ve
 * yeniden başlatmasız yapılandırma tazeliği için; maliyeti ihmal edilebilir
 * (`/auth/refresh` düşük hacimli, ADR-002 §11.5).
 */
export function getRefreshGraceMs(): number {
  return resolveRefreshGraceMs(process.env['AUTH_REFRESH_GRACE_MS']);
}

/** Açılışta fail-fast doğrulama. Geçersiz yapılandırmada throw eder. */
export function assertAuthConfig(): void {
  getRefreshGraceMs();
}
