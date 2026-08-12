/**
 * ADR-015 Amendment 8 — trend serisi gün etiketleri.
 *
 * Backend `YYYY-MM-DD` (tenant TZ takvim günü) gönderir. Etiket üretirken
 * `new Date('2026-08-11')` KULLANILMAZ: o ifade UTC gece yarısı olarak
 * parse edilir ve UTC-batısı bir tarayıcıda bir gün geriye kayar. Öğle
 * (`T12:00:00`) sabitlemesi her yerel saat diliminde aynı takvim gününü verir.
 */

/** `YYYY-MM-DD` → yerel-kaymasız `Date` (öğle sabitlemesi). */
function parseCalendarDate(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

/** `2026-08-11` → `11 Ağu` (grafik ekseni). */
export function formatDayShort(date: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
  }).format(parseCalendarDate(date));
}

/** `2026-08-11` → `11 Ağustos 2026 Salı` (tooltip / ekran okuyucu). */
export function formatDayLong(date: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  }).format(parseCalendarDate(date));
}
