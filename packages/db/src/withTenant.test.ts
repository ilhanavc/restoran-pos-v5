/**
 * withTenant fail-fast birim testi — ADR-041 Faz 1.
 *
 * Saf unit (DB gerektirmez): geçersiz/boş tenantId verildiğinde transaction'ın
 * HİÇ açılmadığını (context kirlenmez) ve fonksiyonun senkron reddettiğini
 * doğrular. set_config/current_setting davranışı DB-backed entegrasyon testinde
 * (apps/api/src/__tests__/tenant-isolation.test.ts) kanıtlanır.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import type { DB } from './generated';
import { withTenant } from './withTenant';

/**
 * transaction() çağrılırsa `reached` işaretlenir + sentinel fırlatılır.
 * Fail-fast durumunda transaction() HİÇ çağrılmamalı (reached=false).
 */
function trapDb(): { db: Kysely<DB>; reached: () => boolean } {
  let reached = false;
  const db = {
    transaction: () => {
      reached = true;
      throw new Error('__transaction_reached__');
    },
  } as unknown as Kysely<DB>;
  return { db, reached: () => reached };
}

describe('withTenant fail-fast (ADR-041 F1)', () => {
  const invalid = ['', '   ', 'not-a-uuid', '123', '00000000-0000-0000-0000'];

  for (const bad of invalid) {
    it(`geçersiz tenantId reddedilir ve transaction açılmaz: ${JSON.stringify(bad)}`, async () => {
      const { db, reached } = trapDb();
      const fn = vi.fn();
      await expect(withTenant(db, bad, fn)).rejects.toThrow(TypeError);
      expect(fn).not.toHaveBeenCalled();
      expect(reached()).toBe(false);
    });
  }

  it('geçerli UUID biçimi fail-fast tetiklemez (transaction denenir)', async () => {
    const { db, reached } = trapDb();
    // Geçerli UUID → isValidUuid geçer → transaction() çağrılır (reached=true).
    await expect(
      withTenant(db, '7c9e6679-7425-40de-944b-e07fc1f90ae7', async () => 1),
    ).rejects.toThrow('__transaction_reached__');
    expect(reached()).toBe(true);
  });
});
