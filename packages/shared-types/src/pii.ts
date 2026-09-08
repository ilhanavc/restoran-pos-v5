/**
 * ADR-040 Güvenlik/KVKK — PII redaksiyon politikası (TEK KAYNAK).
 *
 * Hem api (pino redact + Sentry beforeSend) hem web (Sentry beforeSend) bu
 * dosyadan tüketir → iki yerde ayrı liste tutulmaz, drift olmaz
 * ([[feedback_adr_sibling_drift]]).
 *
 * İki katmanlı temizlik:
 *  1. Anahtar-tabanlı: adı hassas listede olan alanın DEĞERİ maskelenir.
 *  2. Serbest-metin: her string leaf, gömülü e-posta / uzun rakam dizisi
 *     (telefon, TCKN, kart, IBAN) için regex ile maskelenir. Anahtar-tabanlı
 *     scrub'ın kaçırdığı exception mesajı, breadcrumb URL query, request.url
 *     gibi vektörleri kapatır (security-reviewer HIGH-1).
 */

/** PII / kimlik-bilgisi taşıyan gövde alan adları. */
export const SENSITIVE_BODY_KEYS = [
  'password',
  'email',
  'phone',
  'token',
  'refresh_token',
  'refreshToken',
  'accessToken',
  'currentPassword',
  'newPassword',
  'cardNumber',
  'cvv',
  'pan',
  'iban',
  'tckn',
] as const;

/** Hassas HTTP header adları (küçük harf). */
export const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'set-cookie',
] as const;

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_SET = new Set<string>(
  [...SENSITIVE_BODY_KEYS, ...SENSITIVE_HEADER_KEYS].map((k) => k.toLowerCase()),
);

// E-posta.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// 10+ rakamlık dizi (araya boşluk / - . ( ) izinli): telefon, TCKN(11),
// kart(16), IBAN rakamları. 10 rakam eşiği tarih (YYYY-MM-DD = 8 rakam) ve
// kısa sayıları HARİÇ tutar → yanlış-pozitif düşük.
const LONG_DIGITS_RE = /(?:\d[\s().-]?){10,}/g;

/** Bir string içindeki gömülü PII'yi maskeler. */
export function redactPiiString(input: string): string {
  return input.replace(EMAIL_RE, REDACTED).replace(LONG_DIGITS_RE, REDACTED);
}

const MAX_DEPTH = 8;

/**
 * Herhangi bir değeri derinlemesine temizler: hassas ANAHTARLARIN değerini
 * maskeler + her string leaf'te serbest-metin PII redaksiyonu uygular.
 * Sentry event'i, log objesi veya herhangi bir payload için güvenli.
 */
export function deepRedact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactPiiString(value);
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_SET.has(key.toLowerCase())
      ? REDACTED
      : deepRedact(val, depth + 1);
  }
  return out;
}
