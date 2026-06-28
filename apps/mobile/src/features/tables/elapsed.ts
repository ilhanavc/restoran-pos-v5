/** Open-table threshold past which a card turns red (ADR-026 K2). 60 minutes. */
export const LONG_OPEN_MS = 60 * 60 * 1000;

/**
 * Format an open-order duration the way the table board shows it (web
 * `formatElapsed` parity). User-visible units are hard-coded Turkish suffixes
 * ("dk" / "sn" / "sa" / "gün") that are abbreviation glyphs, not translatable
 * sentences — i18n carries the wrapping label; the numeric suffix stays inline.
 *
 *   < 1 saat   -> "37 dk 17 sn"
 *   1-24 saat  -> "2 sa 5 dk 3 sn"
 *   24+ saat   -> "1 gün 2 sa 5 dk 3 sn"
 */
export function formatElapsed(ms: number): string {
  if (ms < 0) {
    return '0 dk 0 sn';
  }
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const totalHour = Math.floor(totalMin / 60);
  const hour = totalHour % 24;
  const day = Math.floor(totalHour / 24);

  if (day > 0) {
    return `${day} gün ${hour} sa ${min} dk ${sec} sn`;
  }
  if (totalHour > 0) {
    return `${totalHour} sa ${min} dk ${sec} sn`;
  }
  return `${totalMin} dk ${sec} sn`;
}
