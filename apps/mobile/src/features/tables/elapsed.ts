/** Open-table threshold past which a card turns red (ADR-026 K2). 60 minutes. */
export const LONG_OPEN_MS = 60 * 60 * 1000;

/** Localized time-unit suffixes for {@link formatElapsed} (i18n: tables.elapsed.*). */
export interface ElapsedLabels {
  day: string;
  hour: string;
  minute: string;
}

/**
 * Format an open-order duration for the (narrow) table card. Shows the two most
 * significant units at minute precision — seconds are omitted so the label fits
 * a 3-column square card and needs no per-second tick. Unit suffixes come from
 * i18n (CLAUDE.md rule 4).
 *
 *   < 1 saat   -> "37 dk"
 *   1-24 saat  -> "2 sa 5 dk"
 *   24+ saat   -> "1 gün 2 sa"
 */
export function formatElapsed(ms: number, labels: ElapsedLabels): string {
  const safeMs = ms < 0 ? 0 : ms;
  const totalMin = Math.floor(safeMs / 60000);
  const min = totalMin % 60;
  const totalHour = Math.floor(totalMin / 60);
  const hour = totalHour % 24;
  const day = Math.floor(totalHour / 24);

  if (day > 0) {
    return `${day} ${labels.day} ${hour} ${labels.hour}`;
  }
  if (totalHour > 0) {
    return `${totalHour} ${labels.hour} ${min} ${labels.minute}`;
  }
  return `${totalMin} ${labels.minute}`;
}
