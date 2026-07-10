import { describe, expect, it } from 'vitest';
import { formatReceiptDateTime } from './format-receipt-datetime.js';

/**
 * ADR-004 Amd5 K9 — tenant-timezone fiş tarih formatı.
 */

describe('formatReceiptDateTime', () => {
  it('renders real Istanbul wall-clock (UTC+3), not UTC slice', () => {
    // 2026-07-10 08:53:56 UTC = 11:53:56 Istanbul (yaz DST yok, sabit +3).
    expect(
      formatReceiptDateTime('2026-07-10T08:53:56.428Z', 'Europe/Istanbul'),
    ).toBe('10.07.2026 11:53:56');
  });

  it('crosses the date line correctly near midnight', () => {
    // 22:30 UTC = ertesi gün 01:30 Istanbul.
    expect(
      formatReceiptDateTime('2026-07-10T22:30:00.000Z', 'Europe/Istanbul'),
    ).toBe('11.07.2026 01:30:00');
  });

  it('renders UTC when timezone is UTC', () => {
    expect(formatReceiptDateTime('2026-07-10T08:53:56Z', 'UTC')).toBe(
      '10.07.2026 08:53:56',
    );
  });

  it('falls back to UTC on invalid timezone instead of throwing', () => {
    expect(
      formatReceiptDateTime('2026-07-10T08:53:56Z', 'Not/AZone'),
    ).toBe('10.07.2026 08:53:56');
  });
});
