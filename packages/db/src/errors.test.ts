/**
 * mapPgError sanitize regresyonu — denetim DB-SEC-01 / API-CORE-01
 * (response-PII ailesi, docs/audit/00-summary.md §2.1).
 *
 * İnvariant: PG constraint-ihlali detail'inin SATIR DEĞERİ (e-posta/telefon
 * gibi PII) RepositoryError'a — dolayısıyla log'a (Error.message) ve HTTP
 * error-body'ye — asla taşınmaz; yalnız kolon adları veya constraint adı.
 * Saf unit — DB gerektirmez.
 */
import { describe, expect, it } from 'vitest';
import { mapPgError } from './errors';

const pgErr = (over: Record<string, unknown>) => ({
  code: '23505',
  message: 'duplicate key value violates unique constraint',
  ...over,
});

describe('mapPgError PII sanitize (DB-SEC-01/API-CORE-01)', () => {
  it('23505: detail değeri (e-posta) taşınmaz, yalnız kolon adı kalır', () => {
    const mapped = mapPgError(
      pgErr({
        detail: 'Key (email)=(gizli@musteri.com) already exists.',
        constraint: 'users_tenant_email_ci_idx',
      }),
    );
    expect(mapped?.cause).toBe('unique');
    expect(mapped?.detail).toBe('email');
    expect(mapped?.message).not.toContain('@');
    expect(JSON.stringify({ ...mapped, message: mapped?.message })).not.toContain(
      'gizli@musteri.com',
    );
  });

  it('23505: çok-kolonlu detail → kolon listesi, değerler yok', () => {
    const mapped = mapPgError(
      pgErr({ detail: 'Key (tenant_id, phone)=(t1, 05551234567) already exists.' }),
    );
    expect(mapped?.detail).toBe('tenant_id, phone');
    expect(mapped?.message).not.toContain('0555');
  });

  it('23505: bilinmeyen detail formatı → constraint adına düşer (ham metin taşınmaz)', () => {
    const mapped = mapPgError(
      pgErr({
        detail: 'unexpected wording with secret@leak.com value',
        constraint: 'payments_tenant_idempotency_key_uq',
      }),
    );
    expect(mapped?.detail).toBe('payments_tenant_idempotency_key_uq');
    expect(mapped?.message).not.toContain('secret@leak.com');
  });

  it('23503: FK detail değeri (uuid) taşınmaz', () => {
    const mapped = mapPgError(
      pgErr({
        code: '23503',
        detail:
          'Key (customer_id)=(7c9e6679-7425-40de-944b-e07fc1f90ae7) is not present in table "customers".',
      }),
    );
    expect(mapped?.cause).toBe('foreign_key');
    expect(mapped?.detail).toBe('customer_id');
    expect(mapped?.message).not.toContain('7c9e6679');
  });

  it('23514: constraint adı davranışı değişmedi', () => {
    const mapped = mapPgError(
      pgErr({ code: '23514', constraint: 'orders_total_cents_check' }),
    );
    expect(mapped?.cause).toBe('check');
    expect(mapped?.detail).toBe('orders_total_cents_check');
  });

  it('bilinmeyen kod → null (yutma yasak sözleşmesi değişmedi)', () => {
    expect(mapPgError(pgErr({ code: '40001' }))).toBeNull();
  });
});
