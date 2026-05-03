import { describe, expect, it } from 'vitest';
import { getCalendarDayWindow } from './business-day';

/**
 * ADR-015 Karar 2 — getCalendarDayWindow unit tests.
 * IANA TZ + anki UTC zamanı → yerel takvim günü [00:00, 24:00) UTC bound'ları.
 */
describe('getCalendarDayWindow', () => {
  it('Europe/Istanbul (UTC+3, no DST) — 03 Mayıs 14:00 UTC → 02 May 21:00..03 May 21:00', () => {
    const w = getCalendarDayWindow(
      'Europe/Istanbul',
      new Date('2026-05-03T14:00:00Z'),
    );
    expect(w.startUtc.toISOString()).toBe('2026-05-02T21:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-05-03T21:00:00.000Z');
  });

  it('UTC TZ — 24 saatlik pencere UTC takvim günü ile aynı', () => {
    const w = getCalendarDayWindow('UTC', new Date('2026-05-03T12:34:56Z'));
    expect(w.startUtc.toISOString()).toBe('2026-05-03T00:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-05-04T00:00:00.000Z');
  });

  it('TR yerel gece yarısından sonra (UTC 22:00 = TR 01:00 ertesi gün)', () => {
    const w = getCalendarDayWindow(
      'Europe/Istanbul',
      new Date('2026-05-02T22:00:00Z'),
    );
    // TR'de 03 Mayıs 01:00 → window 03 Mayıs
    expect(w.startUtc.toISOString()).toBe('2026-05-02T21:00:00.000Z');
  });

  it('endUtc - startUtc tipik gün için 24 saat (no DST)', () => {
    const w = getCalendarDayWindow(
      'Europe/Istanbul',
      new Date('2026-05-15T10:00:00Z'),
    );
    const diffH = (w.endUtc.getTime() - w.startUtc.getTime()) / 3_600_000;
    expect(diffH).toBe(24);
  });
});
