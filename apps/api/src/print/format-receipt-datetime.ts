/**
 * Fiş tarih-saat formatlayıcı — ADR-004 Amd5 K9 (paylaşılan, tenant-timezone).
 *
 * ISO timestamp'i verilen IANA timezone'da (`tenant_settings.timezone`, ör.
 * "Europe/Istanbul") GERÇEK yerel duvar-saatine çevirir: `dd.MM.yyyy HH:mm:ss`.
 * Mutfak fişi ham ISO-UTC, kasa fişi (eski `formatBillDate`) UTC-slice
 * basıyordu — Istanbul 3 saat geride görünüyordu (operasyonel hata). İki print
 * ailesi de artık bu tek helper'ı kullanır (divergence yok).
 *
 * Geçersiz timezone değeri print job'ı öldürmesin diye UTC'ye düşer
 * (tenant_settings değerleri validasyonlu; bu yalnız defansif ağ).
 */
export function formatReceiptDateTime(iso: string, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = buildParts(iso, timeZone);
  } catch {
    parts = buildParts(iso, 'UTC');
  }
  const get = (type: Intl.DateTimeFormatPart['type']): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function buildParts(iso: string, timeZone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
}
