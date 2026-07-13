/**
 * todayStoreDate tenant-tz regresyonu — denetim R7-TZ-11
 * (docs/audit/00-summary.md §2.4; Blok 7 #335).
 *
 * İnvariant: gün sınırı TENANT TIMEZONE'a göre (DB trigger
 * `populate_order_store_date` ile hizalı). Eski UTC-midnight davranışı
 * İstanbul'da 00:00-03:00 penceresinde önceki günü döndürüyordu.
 * Saf unit — DB gerektirmez; fake-timer ile deterministik.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDateParam, todayStoreDate } from './store-date';

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

describe('todayStoreDate tenant-tz (R7-TZ-11)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gece yarısı penceresi: UTC 22:30 = İstanbul ertesi gün 01:30 → İstanbul günü döner', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T22:30:00.000Z')); // İstanbul: 12 Tem 01:30
    expect(isoDate(todayStoreDate('Europe/Istanbul'))).toBe('2026-07-12');
    // Eski UTC davranışı '2026-07-11' verirdi — tahta dünkü siparişleri gösterirdi.
    expect(isoDate(todayStoreDate('UTC'))).toBe('2026-07-11');
  });

  it('gündüz: UTC ve İstanbul aynı gün → fark yok', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00.000Z')); // İstanbul: 15:00
    expect(isoDate(todayStoreDate('Europe/Istanbul'))).toBe('2026-07-12');
    expect(isoDate(todayStoreDate('UTC'))).toBe('2026-07-12');
  });

  it('batı yarımküre tersi: UTC 01:00 = New York önceki gün 21:00', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T01:00:00.000Z'));
    expect(isoDate(todayStoreDate('America/New_York'))).toBe('2026-07-11');
  });

  it('dönüş DATE-semantiği korur (UTC-midnight temsil)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00.000Z'));
    const d = todayStoreDate('Europe/Istanbul');
    expect(d.toISOString()).toBe('2026-07-12T00:00:00.000Z');
  });

  it('geçersiz IANA tz → RangeError (sessiz yanlış-gün yerine gürültülü hata)', () => {
    expect(() => todayStoreDate('Not/AZone')).toThrow(RangeError);
  });
});

describe('parseDateParam (davranış değişmedi — R7-CSV-04 notu)', () => {
  it('explicit YYYY-MM-DD → UTC midnight (DATE cast doğru)', () => {
    expect(parseDateParam('2026-07-12').toISOString()).toBe(
      '2026-07-12T00:00:00.000Z',
    );
  });
});
