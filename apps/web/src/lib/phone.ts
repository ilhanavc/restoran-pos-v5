/**
 * Türkiye cep telefonu numarası gösterim formatı.
 *
 * Backend `normalizePhoneTr` çıktısı (11 hane, `05XXXXXXXXX`) → kullanıcıya
 * okunabilir gruplama: `0539 840 08 56`. ADR-016 §11 — UI sadece
 * normalized değeri gösterir; raw input modemden gelen kirli string olabilir.
 *
 * Diğer formatlar (sabit hat, kısa kodlar) olduğu gibi döner.
 */
export function formatTrPhone(normalized: string): string {
  if (!/^05\d{9}$/.test(normalized)) return normalized;
  return `${normalized.slice(0, 4)} ${normalized.slice(4, 7)} ${normalized.slice(7, 9)} ${normalized.slice(9)}`;
}
