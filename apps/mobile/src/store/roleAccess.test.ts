import { describe, expect, it } from 'vitest';

import { canCreateTakeaway, type SessionRole } from './roleAccess';

/**
 * ADR-039 DoD 23a — "Paket Sipariş" FAB'ının rol görünürlüğü.
 *
 * **Bu testin neden var olduğunu okuyan kişi bilmeli:** Mutfak sekmesi
 * `MainTabs.tsx`'te KOŞULSUZ kayıtlıdır (Amd5 K7 — aşçı kuyruğu görmeye devam
 * etsin). Yani `kitchen` rolüyle giren kullanıcı bu ekranı AÇAR. Dolayısıyla
 * "mutfak terminaline sipariş oluşturma yetkisi vermeme" garantisinin istemci
 * tarafındaki TEK hattı `canCreateTakeaway`'dir. Bu koşul sessizce
 * gevşetilirse (ör. biri `kitchen`'ı kümeye eklerse) yalnız bu test kırılır.
 */
describe('canCreateTakeaway (ADR-039 K10.2/K10.4)', () => {
  it.each<SessionRole>(['admin', 'cashier', 'waiter'])(
    '%s → FAB GÖRÜNÜR',
    (role) => {
      expect(canCreateTakeaway(role)).toBe(true);
    },
  );

  it('kitchen → FAB GÖRÜNMEZ (mutfak terminali sipariş oluşturmaz)', () => {
    expect(canCreateTakeaway('kitchen')).toBe(false);
  });

  it('rol null (profil tazelenemedi) → FAB GİZLİ (güvenli yön)', () => {
    expect(canCreateTakeaway(null)).toBe(false);
  });

  it('rol undefined (profil hiç yüklenmedi) → FAB GİZLİ', () => {
    expect(canCreateTakeaway(undefined)).toBe(false);
  });
});
