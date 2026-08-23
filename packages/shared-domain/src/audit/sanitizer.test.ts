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

  it('order.created: order_id allowed, non-listed keys dropped (ADR-017 whitelist)', () => {
    const out = sanitize('order.created', {
      order_id: 'uuid-1',
      total: 1000,
    });
    // ADR-017: order.created allowed-keys → order_id, type, customer_id,
    // total_cents, item_count, planned_payment_type. `total` (legacy) listede yok.
    expect(out).toEqual({ order_id: 'uuid-1' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
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

  // FIX 3 (S106) — camelCase varyantları: DENY_LIST tamamen snake_case,
  // ama repo'da TS tarafı camelCase kullanıyor (rawPhone, ipAddress) — eski
  // `.toLowerCase()` exact-match bunları kaçırıyordu ('rawphone' !== 'raw_phone').
  it('camelCase: "rawPhone" throws (raw_phone deny-list eşleşmesi)', () => {
    expect(() =>
      sanitize('auth.login', { rawPhone: '05321234567' }),
    ).toThrow('error.audit.piiDetected');
  });

  it('camelCase: "ipAddress" throws (ip_address deny-list eşleşmesi)', () => {
    expect(() =>
      sanitize('auth.login', { ipAddress: '127.0.0.1' }),
    ).toThrow('error.audit.piiDetected');
  });

  it('camelCase: "cardNumber" throws (card_number deny-list eşleşmesi)', () => {
    expect(() =>
      sanitize('auth.login', { cardNumber: '4111111111111111' }),
    ).toThrow('error.audit.piiDetected');
  });

  it('camelCase: nested array altında "phoneRaw" throws (phone_raw eşleşmesi)', () => {
    expect(() =>
      sanitize('auth.login', {
        success: true,
        reason_code: [{ phoneRaw: '05321234567' }] as unknown as string,
      }),
    ).toThrow('error.audit.piiDetected');
  });

  it('camelCase regresyon-yok: "reasonCode" (deny-list DIŞI) throw etmez', () => {
    expect(() =>
      sanitize('auth.login', { success: true, reasonCode: 'OK' } as never),
    ).not.toThrow();
  });

  it('acronym sınırı: "IPAddress" (PascalCase acronym) throws (ip_address eşleşmesi)', () => {
    expect(() =>
      sanitize('auth.login', { IPAddress: '127.0.0.1' } as never),
    ).toThrow('error.audit.piiDetected');
  });

  it('acronym regresyon-yok: whitelist camelCase anahtarı ("groupId") yanlışlıkla deny-list\'e düşmez', () => {
    // ADR-012 attribute-group whitelist'i (allowed-keys.ts:263) — deny-list'le
    // hiçbir kesişimi olmamalı (security-review false-positive taraması).
    const out = sanitize('attribute_group.updated', {
      groupId: 'uuid-1',
    } as never);
    expect(out).toEqual({ groupId: 'uuid-1' });
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

  // ── ADR-035 S11 — `order_item.moved` üçlü kontratının (b) ayağı ──────────
  // Üçlü kontrat: (a) AuditEventTypeSchema, (b) ALLOWED_KEYS, (c) handler.
  // (b) eksikse handler payload'ı yazar ama sanitizer SESSİZCE düşürür (S104
  // dersi) → forensic iz boş kalır. Aşağıdaki iki test o ayağı kilitler:
  // route'un yazdığı 12 anahtarın tamamı geçmeli, whitelist dışı anahtar
  // düşmeli.
  it('order_item.moved: route payload\'ının TÜM anahtarları whitelist\'ten geçer', () => {
    const raw = {
      order_item_id: '11111111-1111-4111-8111-111111111111',
      product_id: '22222222-2222-4222-8222-222222222222',
      from_order_id: '33333333-3333-4333-8333-333333333333',
      to_order_id: '44444444-4444-4444-8444-444444444444',
      from_table_id: '55555555-5555-4555-8555-555555555555',
      to_table_id: '66666666-6666-4666-8666-666666666666',
      from_table_code: 'M5',
      to_table_code: 'M7',
      quantity: 2,
      amount_cents: 10000,
      source_closed: true,
      target_created: false,
    };
    const out = sanitize('order_item.moved', raw);
    // Hiçbir anahtar düşmedi (eksik ALLOWED_KEYS burada kırmızıya döner).
    expect(out).toEqual(raw);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ── ADR-038 — `customer.history_viewed` üçlü kontratının (b) ayağı ───────
  // PII OKUMA izi (KVKK m.12). Whitelist eksik olsaydı payload sessizce boşalır
  // ve "kimin geçmişine bakıldı" sorusu cevapsız kalırdı.
  it('customer.history_viewed: route payload\'ının TÜM anahtarları geçer', () => {
    const raw = {
      customer_id: '77777777-7777-4777-8777-777777777777',
      items_count: 10,
      paged: true,
    };
    const out = sanitize('customer.history_viewed', raw);
    expect(out).toEqual(raw);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('customer.history_viewed: müşteri adı payload\'a sızamaz', () => {
    const out = sanitize('customer.history_viewed', {
      customer_id: '77777777-7777-4777-8777-777777777777',
      full_name: 'Ahmet Yılmaz',
    });
    expect(out).toEqual({
      customer_id: '77777777-7777-4777-8777-777777777777',
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('order_item.moved: whitelist dışı anahtar (müşteri adı) düşer', () => {
    const out = sanitize('order_item.moved', {
      order_item_id: '11111111-1111-4111-8111-111111111111',
      customer_name: 'Ahmet Yılmaz',
    });
    expect(out).toEqual({
      order_item_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
