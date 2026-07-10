import { describe, expect, it } from 'vitest';
import { CRON_LOCK_IDS } from './lock-ids.js';

/**
 * packages/shared-domain/src/cron/lock-ids.ts — ADR-002 §13.2.E.
 * İLK test dosyası (Blok 1 derin denetim, Hat C item 6d).
 *
 * `pg_try_advisory_lock(bigint)` tek-shot 64-bit key alır. İki cron task
 * AYNI id'yi paylaşırsa birbirini KİLİTLER — sinsi prod bug'ı: hata mesajı
 * vermez, sadece ikinci task "lock alamadı" sanıp sessizce o turu atlar
 * (TTL cleanup gibi bir cron için "sessizce hiç çalışmadı" günlerce fark
 * edilmeyebilir).
 */
describe('CRON_LOCK_IDS — uniqueness (ADR-002 §13.2.E)', () => {
  const entries = Object.entries(CRON_LOCK_IDS);
  const values = Object.values(CRON_LOCK_IDS);

  it('registry en az 1 id içerir (boş registry testi anlamsız kılmaz)', () => {
    expect(values.length).toBeGreaterThan(0);
  });

  it('TÜM lock id değerleri birbirinden FARKLI (çakışma = iki cron birbirini kilitler)', () => {
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it.each(entries)('%s: değer bigint tipinde (number DEĞİL — pg_try_advisory_lock(bigint) imzasıyla eşleşmeli)', (_name, value) => {
    expect(typeof value).toBe('bigint');
  });

  it.each(entries)('%s: pozitif ve PostgreSQL bigint aralığında (0 < id <= 2^63-1)', (_name, value) => {
    expect(value > 0n).toBe(true);
    expect(value <= 2n ** 63n - 1n).toBe(true);
  });

  it.each(entries)('%s: "4_201_xxx" numaralama düzenine uyar (registry JSDoc konvansiyonu)', (_name, value) => {
    // Dosya JSDoc: "4" cron, "201" TTL cleanup family. Konvansiyon ihlali,
    // gelecekte başka bir ailenin id aralığıyla çakışma riskini artırır.
    expect(value >= 4_201_000n && value < 4_202_000n).toBe(true);
  });

  it('registry değerleri referans-kararlı (aynı property tekrar okununca aynı değer — "as const" garantisi)', () => {
    const a = CRON_LOCK_IDS.TTL_CLEANUP_AUDIT_LOGS;
    const b = CRON_LOCK_IDS.TTL_CLEANUP_AUDIT_LOGS;
    expect(a).toBe(b);
  });

  it('int32 aralığını (2^31-1) aşan değer YOK (bilgi amaçlı — bigint kullanıldığı için zorunlu değil ama sürpriz olmamalı)', () => {
    for (const v of values) {
      expect(v).toBeLessThan(2n ** 31n - 1n);
    }
  });
});
