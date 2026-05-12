import { describe, expect, it } from 'vitest';
import {
  getCalendarDayWindow,
  resolveRangeWindow,
  type RangeKind,
} from './business-day';

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

/**
 * ADR-015 Amendment 2 (2026-05-12) — resolveRangeWindow unit tests.
 *
 * Preset semantik:
 *   today     = bugünün takvim günü
 *   yesterday = dünün takvim günü (DST-aware)
 *   last7     = bugün dahil son 7 gün
 *   last30    = bugün dahil son 30 gün
 *   custom    = [from 00:00, (to+1) 00:00) — `to` günü dahil
 */
describe('resolveRangeWindow', () => {
  const TZ_IST = 'Europe/Istanbul';
  const TZ_UTC = 'UTC';

  it('range=today returns same window as getCalendarDayWindow', () => {
    const now = new Date('2026-05-03T14:00:00Z');
    const w = resolveRangeWindow({ range: 'today', tz: TZ_IST, now });
    const ref = getCalendarDayWindow(TZ_IST, now);
    expect(w.startUtc.toISOString()).toBe(ref.startUtc.toISOString());
    expect(w.endUtc.toISOString()).toBe(ref.endUtc.toISOString());
  });

  it('range=yesterday returns previous calendar day window', () => {
    // 03 Mayıs 14:00 UTC = 03 Mayıs 17:00 TR → bugün 03 May; dün 02 May.
    const now = new Date('2026-05-03T14:00:00Z');
    const w = resolveRangeWindow({ range: 'yesterday', tz: TZ_IST, now });
    expect(w.startUtc.toISOString()).toBe('2026-05-01T21:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-05-02T21:00:00.000Z');
  });

  it('range=last7 spans bugün dahil 7 calendar days', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const w = resolveRangeWindow({ range: 'last7', tz: TZ_IST, now });
    // Bugün 15 May → last7 = [09 May 00:00 TR, 16 May 00:00 TR)
    // 09 May 00:00 TR = 08 May 21:00 UTC
    // 16 May 00:00 TR = 15 May 21:00 UTC
    expect(w.startUtc.toISOString()).toBe('2026-05-08T21:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-05-15T21:00:00.000Z');
    const days = (w.endUtc.getTime() - w.startUtc.getTime()) / 86_400_000;
    expect(days).toBe(7);
  });

  it('range=last30 spans bugün dahil 30 calendar days', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const w = resolveRangeWindow({ range: 'last30', tz: TZ_IST, now });
    // Bugün 15 May → last30 = [16 Nis 00:00 TR, 16 May 00:00 TR)
    // 16 Nisan 00:00 TR = 15 Nisan 21:00 UTC
    expect(w.startUtc.toISOString()).toBe('2026-04-15T21:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-05-15T21:00:00.000Z');
    const days = (w.endUtc.getTime() - w.startUtc.getTime()) / 86_400_000;
    expect(days).toBe(30);
  });

  it('range=custom with from===to returns 1-day window (`to` inclusive)', () => {
    const w = resolveRangeWindow({
      range: 'custom',
      from: '2026-05-03',
      to: '2026-05-03',
      tz: TZ_IST,
    });
    expect(w.startUtc.toISOString()).toBe('2026-05-02T21:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-05-03T21:00:00.000Z');
  });

  it('range=custom 90-day window calculates correctly', () => {
    const w = resolveRangeWindow({
      range: 'custom',
      from: '2026-01-01',
      to: '2026-03-31',
      tz: TZ_UTC,
    });
    expect(w.startUtc.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    const days = (w.endUtc.getTime() - w.startUtc.getTime()) / 86_400_000;
    expect(days).toBe(90);
  });

  it('UTC TZ — range=today is plain UTC calendar day', () => {
    const w = resolveRangeWindow({
      range: 'today',
      tz: TZ_UTC,
      now: new Date('2026-05-03T14:00:00Z'),
    });
    expect(w.startUtc.toISOString()).toBe('2026-05-03T00:00:00.000Z');
    expect(w.endUtc.toISOString()).toBe('2026-05-04T00:00:00.000Z');
  });

  it('throws when range=custom missing from/to', () => {
    expect(() =>
      resolveRangeWindow({ range: 'custom', tz: TZ_IST }),
    ).toThrow(/from.*to/);
  });

  it('throws when range=custom has only `from`', () => {
    expect(() =>
      resolveRangeWindow({ range: 'custom', from: '2026-05-01', tz: TZ_IST }),
    ).toThrow(/from.*to/);
  });

  it('throws when range value is unknown (defensive)', () => {
    // TS strict — `as unknown as RangeKind` deliberate test cast.
    const bad = 'unknown' as unknown as RangeKind;
    expect(() => resolveRangeWindow({ range: bad, tz: TZ_IST })).toThrow();
  });

  // ─── DST edge cases ─────────────────────────────────────────────────────
  // Europe/Istanbul: 2026 yılında DST yok (Türkiye 2016'da kalıcı UTC+3).
  // Yine de Pacific gibi DST'li bir TZ ile DST aware testi.
  it('range=yesterday DST sınırında doğru gün döner (Pacific/Auckland)', () => {
    // Pacific/Auckland 2026-04-05 03:00 → 02:00 (DST end). Bu sınırın "yarın"ı.
    // 2026-04-05 12:00 UTC (Auckland 01:00 AM 06 Nisan local).
    const now = new Date('2026-04-05T12:00:00Z');
    const tz = 'Pacific/Auckland';
    const yWindow = resolveRangeWindow({ range: 'yesterday', tz, now });
    const todayWindow = resolveRangeWindow({ range: 'today', tz, now });
    // yesterday.endUtc == today.startUtc — sınır temas eder, çakışmaz.
    expect(yWindow.endUtc.getTime()).toBe(todayWindow.startUtc.getTime());
    // yesterday.startUtc < yesterday.endUtc (pozitif window).
    expect(yWindow.startUtc.getTime()).toBeLessThan(yWindow.endUtc.getTime());
  });

  it('range=last7 endUtc === today endUtc (window kapanışı bugün biter)', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const last7 = resolveRangeWindow({ range: 'last7', tz: TZ_IST, now });
    const today = resolveRangeWindow({ range: 'today', tz: TZ_IST, now });
    expect(last7.endUtc.getTime()).toBe(today.endUtc.getTime());
  });

  it('range=custom 1 günlük window 24h sürer (TR no DST)', () => {
    const w = resolveRangeWindow({
      range: 'custom',
      from: '2026-06-15',
      to: '2026-06-15',
      tz: TZ_IST,
    });
    const hours = (w.endUtc.getTime() - w.startUtc.getTime()) / 3_600_000;
    expect(hours).toBe(24);
  });
});
