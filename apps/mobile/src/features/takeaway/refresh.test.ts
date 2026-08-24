import { describe, expect, it } from 'vitest';

import { KDS_ORDERS_KEY } from '../kitchen/keys';
import {
  invalidateAfterTakeawaySave,
  type InvalidatingClient,
} from './refresh';

/**
 * ADR-039 DoD 23b — kaydetme sonrası Mutfak listesi TAZELENİR.
 *
 * K5.5: garson paket siparişi açar ama yönetemez (K6 asimetrisi); tek
 * telafisi kaydettiğini döndüğü listede anında görmesidir. Bu invalidate
 * düşerse garson "sipariş gitmedi mi?" diye ikinci kez kaydetmeye kalkar.
 */
describe('invalidateAfterTakeawaySave (ADR-039 K5.5)', () => {
  it('Mutfak (KDS) sorgusunu tazeler', () => {
    const calls: readonly unknown[][] = [];
    const client: InvalidatingClient = {
      invalidateQueries: (filters) => {
        (calls as unknown[][]).push([...filters.queryKey]);
        return undefined;
      },
    };

    invalidateAfterTakeawaySave(client);

    expect(calls).toContainEqual([...KDS_ORDERS_KEY]);
  });

  it('açık sipariş sorgularını da tazeler', () => {
    const calls: unknown[][] = [];
    const client: InvalidatingClient = {
      invalidateQueries: (filters) => {
        calls.push([...filters.queryKey]);
        return undefined;
      },
    };

    invalidateAfterTakeawaySave(client);

    expect(calls).toContainEqual(['orders']);
  });
});
