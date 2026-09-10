import { describe, it, expect } from 'vitest';

/**
 * TEST-3 (satın-alma DD triyajı, kova A) — CI'da DB integration testlerinin
 * SESSİZCE SKIP olmasını engelleyen meta-guard.
 *
 * `packages/db` integration testleri `describe.skipIf(!process.env.DATABASE_URL)`
 * kullanır: DATABASE_URL yoksa sessizce atlanır (DB'siz geliştiricide `pnpm test`
 * yeşil kalsın diye — bilinçli lokal kolaylık). RİSK: ci.yml bir gün DATABASE_URL'i
 * düşürürse (env satırı silinir/yanlış isim), TÜM db integration testleri sessizce
 * skip olur ve CI yine "yeşil" görünür → "sahte-yeşil" (DD TEST-3).
 *
 * Bu guard her zaman koşar (skipIf YOK). CI ortamında (GitHub Actions `CI=true`)
 * DATABASE_URL'in DOLU olmasını ZORUNLU kılar → integration testleri gerçekten
 * koşar. Lokal (CI env yok) no-op geçer. Böylece gelecekteki bir ci.yml regresyonu
 * sessiz-skip yerine bu testle GÜRÜLTÜLÜ patlar.
 */
describe('CI DB-test enforcement (TEST-3)', () => {
  it('CI ortamında DATABASE_URL set olmalı (db integration testleri skip olmasın)', () => {
    const isCI = process.env['CI'] === 'true' || process.env['CI'] === '1';
    if (!isCI) return; // lokal: DB'siz geliştirici — bilinçli olarak zorlanmaz
    expect(
      process.env['DATABASE_URL'],
      'CI ortamında DATABASE_URL tanımlı değil → tüm db integration testleri ' +
        'sessizce SKIP olur (sahte-yeşil). ci.yml job env\'ine DATABASE_URL ekle.',
    ).toBeTruthy();
  });
});
