import { describe, it, expect } from 'vitest';
import {
  DailyCloseQuerySchema,
  ReportRangeQuerySchema,
  yyyyMmDd,
} from './reports.js';
import { OrderListQuerySchema } from './order.js';

/**
 * Denetim bulgusu SD-T-C-01 (Blok 2, 2026-07-11) — `^\d{4}-\d{2}-\d{2}$`
 * yalnız ŞEKLİ doğrular, TAKVİM geçerliliğini doğrulamaz. "2026-02-30" gibi
 * bir tarih regex'i geçip Postgres DATE cast'inde ya throw eder ya da JS
 * `Date` overflow'la SESSİZCE başka bir güne kayar (Z-raporu/rapor penceresi
 * yanlış gün okur). Fix: `.refine` ile yıl/ay/gün'ün round-trip ettiği
 * (overflow olmadığı) doğrulanıyor.
 */
describe('yyyyMmDd — takvim-geçerli tarih doğrulaması (denetim SD-T-C-01)', () => {
  it('geçerli tarih kabul edilir', () => {
    expect(yyyyMmDd.safeParse('2026-07-27').success).toBe(true);
  });

  it('takvimde OLMAYAN gün reddedilir (Şubat 30)', () => {
    expect(yyyyMmDd.safeParse('2026-02-30').success).toBe(false);
  });

  it('takvimde OLMAYAN ay reddedilir (ay 13)', () => {
    expect(yyyyMmDd.safeParse('2026-13-01').success).toBe(false);
  });

  it('artık yıl 29 Şubat kabul edilir (2024 artık yıl)', () => {
    expect(yyyyMmDd.safeParse('2024-02-29').success).toBe(true);
  });

  it('artık OLMAYAN yılda 29 Şubat reddedilir (2026 artık yıl değil)', () => {
    expect(yyyyMmDd.safeParse('2026-02-29').success).toBe(false);
  });

  it('şekli bozuk girdi hâlâ regex aşamasında reddedilir', () => {
    expect(yyyyMmDd.safeParse('26-07-27').success).toBe(false);
    expect(yyyyMmDd.safeParse('not-a-date').success).toBe(false);
  });

  it('ReportRangeQuerySchema custom range takvim-geçersiz tarihi reddeder', () => {
    const result = ReportRangeQuerySchema.safeParse({
      range: 'custom',
      from: '2026-04-31', // Nisan 30 gün çeker
      to: '2026-05-01',
    });
    expect(result.success).toBe(false);
  });

  it('DailyCloseQuerySchema takvim-geçersiz tarihi reddeder', () => {
    expect(DailyCloseQuerySchema.safeParse({ date: '2026-06-31' }).success).toBe(
      false,
    );
  });

  it('OrderListQuerySchema storeDate takvim-geçersiz tarihi reddeder', () => {
    expect(
      OrderListQuerySchema.safeParse({ storeDate: '2026-09-31' }).success,
    ).toBe(false);
  });
});
