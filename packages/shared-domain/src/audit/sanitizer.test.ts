import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitize } from './sanitizer.js';

describe('audit sanitizer (ADR-003 §12)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('auth.login: whitelisted keys pass through', () => {
    const out = sanitize('auth.login', {
      success: true,
      reason_code: 'OK',
      ip_hash: 'abc123',
    });
    expect(out).toEqual({
      success: true,
      reason_code: 'OK',
      ip_hash: 'abc123',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('auth.login: non-whitelisted key is dropped with warn', () => {
    const out = sanitize('auth.login', {
      success: true,
      foo: 'bar',
    });
    expect(out).toEqual({ success: true });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("'foo'");
  });

  it('auth.login: nested deny-list hit (snapshot.customer.phone) throws', () => {
    expect(() =>
      sanitize('auth.login', {
        success: true,
        // 'snapshot' is itself non-whitelisted so it'd be dropped before recursion;
        // to actually exercise nested recursion, embed under an allowed key.
        // We intentionally allow 'reason_code' and put a record there with deny key.
        reason_code: { phone: '0532...' } as unknown as string,
      }),
    ).toThrow('error.audit.piiDetected');
  });

  it('auth.login: top-level deny-list hit (email) throws', () => {
    expect(() =>
      sanitize('auth.login', {
        success: true,
        email: 'a@b.com',
      }),
    ).toThrow('error.audit.piiDetected');
  });

  it('auth.login: Türkçe deny-list key (telefon) throws', () => {
    expect(() =>
      sanitize('auth.login', {
        success: true,
        telefon: '05321234567',
      }),
    ).toThrow('error.audit.piiDetected');
  });

  it('auth.login: Türkçe deny-list key (tckn) throws', () => {
    expect(() =>
      sanitize('auth.login', {
        tckn: '12345678901',
      }),
    ).toThrow('error.audit.piiDetected');
  });

  it('audit.purge: expected shape passes through', () => {
    const out = sanitize('audit.purge', {
      table: 'audit_logs',
      deleted_count: 42,
      batch_count: 1,
      duration_ms: 123,
      cutoff_date: '2026-01-01T00:00:00Z',
    });
    expect(out).toEqual({
      table: 'audit_logs',
      deleted_count: 42,
      batch_count: 1,
      duration_ms: 123,
      cutoff_date: '2026-01-01T00:00:00Z',
    });
  });

  it('domain event fallback (order.created): all keys dropped (empty whitelist)', () => {
    const out = sanitize('order.created', {
      order_id: 'uuid-1',
      total: 1000,
    });
    expect(out).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('nested normal object: filters inner keys against same allow-list', () => {
    // 'reason_code' is allowed; inner object: 'success' allowed, 'foo' dropped
    const out = sanitize('auth.login', {
      reason_code: {
        success: false,
        foo: 'drop-me',
      } as unknown as string,
    });
    expect(out).toEqual({
      reason_code: { success: false },
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('auth.logout: empty payload is valid', () => {
    const out = sanitize('auth.logout', {});
    expect(out).toEqual({});
  });

  it('auth.refresh: rotated flag passes', () => {
    const out = sanitize('auth.refresh', { rotated: true });
    expect(out).toEqual({ rotated: true });
  });

  it('PCI deny key (card_number) throws', () => {
    expect(() =>
      sanitize('auth.login', { card_number: '4111111111111111' }),
    ).toThrow('error.audit.piiDetected');
  });

  it('password_hash deny key throws', () => {
    expect(() =>
      sanitize('auth.login', { password_hash: 'bcrypt$...' }),
    ).toThrow('error.audit.piiDetected');
  });

  // FIX 1 — case-insensitive deny-list
  it('case-insensitive: "Phone" (PascalCase) throws', () => {
    expect(() =>
      sanitize('auth.login', { Phone: '05321234567' }),
    ).toThrow('error.audit.piiDetected');
  });

  it('case-insensitive: "EMAIL" (uppercase) throws', () => {
    expect(() =>
      sanitize('auth.login', { EMAIL: 'a@b.com' }),
    ).toThrow('error.audit.piiDetected');
  });

  it('case-insensitive: "Telefon" (Turkish mixed-case) throws', () => {
    expect(() =>
      sanitize('auth.login', { Telefon: '05321234567' }),
    ).toThrow('error.audit.piiDetected');
  });

  // FIX 2 — array traversal: deny-list hit inside array under allowed key
  it('array value under allowed key: [{phone: ...}] throws', () => {
    expect(() =>
      sanitize('auth.login', {
        success: true,
        reason_code: [{ phone: '0532...' }] as unknown as string,
      }),
    ).toThrow('error.audit.piiDetected');
  });

  it('array value under allowed key: nested [{user:{email:...}}] throws', () => {
    expect(() =>
      sanitize('auth.login', {
        success: true,
        reason_code: [{ user: { email: 'a@b.com' } }] as unknown as string,
      }),
    ).toThrow('error.audit.piiDetected');
  });

  it('array value under allowed key: clean array passes through', () => {
    const out = sanitize('auth.login', {
      success: true,
      reason_code: ['OK', 'RETRY'] as unknown as string,
    });
    expect(out).toEqual({ success: true, reason_code: ['OK', 'RETRY'] });
  });
});
