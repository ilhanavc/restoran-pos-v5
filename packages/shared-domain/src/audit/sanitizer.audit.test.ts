import { describe, expect, it } from 'vitest';
import { sanitize } from './sanitizer.js';

/**
 * Blok 1 derin denetim (Hat C) — sanitizer sınır-zorlama + davranış
 * karakterizasyonu. Bu dosyadaki testler YEŞİL beklenir; ama birkaçı
 * (array-whitelist bypass, döngüsel referans guard'ı yokluğu, Map/Set opak
 * geçiş, array sığ-referans) BİLİNEN mimari zayıflıkları belgeler — assert
 * edilen şey "şu an ne oluyor", "ne olmalıydı" değil. Severity/öneri raporda
 * (qa-C-pii-report.md, MEDIUM bulgular SD-S-09..12).
 */

describe('sanitizer — key alias / case sınırları', () => {
  it('deny-list case-insensitive: karışık-case "TeLeFoN" throws', () => {
    expect(() => sanitize('auth.login', { TeLeFoN: '05320000000' })).toThrow(
      'error.audit.piiDetected',
    );
  });

  it.each(['phoneNumber', 'phone_number', 'gsm', 'tel', 'msisdn', 'customer_phone', 'raw_phone'])(
    'alias anahtar "%s" DENY_LIST\'te literal olarak YOK — auth.login whitelist\'inde de yok → throw ETMEDEN sessizce düşürülür (leak yok, ama "bilinen PII adı" garantisi de yok)',
    (alias) => {
      const out = sanitize('auth.login', {
        success: true,
        [alias]: '05320000000',
      } as unknown as Record<string, unknown>);
      expect(out).toEqual({ success: true });
      expect(Object.keys(out)).not.toContain(alias);
    },
  );
});

describe('sanitizer — nested/array derinlik davranışı', () => {
  it('nested plain object: iç içe iki seviye deny-list hâlâ yakalanır', () => {
    expect(() =>
      sanitize('auth.login', {
        reason_code: { success: { phone: '0532...' } } as unknown as string,
      }),
    ).toThrow('error.audit.piiDetected');
  });

  it('ARRAY WHITELIST BYPASS (mimari zayıflık, SD-S-09): dizi elemanlarındaki whitelist-dışı-ama-deny-list-dışı anahtarlar FİLTRELENMEDEN geçer', () => {
    // scanForDenyList yalnız DENY_LIST'te literal olan anahtarları arar.
    // Nested OBJECT path'inin aksine (sanitizeRecord recursion, allowedKeys
    // uygulanır), ARRAY path'inde (`out[key] = value` — ham değer) whitelist
    // HİÇ uygulanmaz. Bugün canlıda tüm `changed_fields` çağrıları string[]
    // kullanıyor (apps/api grep doğrulaması, bkz. rapor) — o yüzden bu YEŞİL
    // bir karakterizasyon; ama fonksiyonun kendisi bu garantiyi ZORLAMIYOR.
    const out = sanitize('auth.login', {
      success: true,
      reason_code: [
        { note: 'internal detail', arbitrary_field: 'should not normally pass' },
      ] as unknown as string,
    });
    expect(out).toEqual({
      success: true,
      reason_code: [
        { note: 'internal detail', arbitrary_field: 'should not normally pass' },
      ],
    });
  });

  it('array value under allowed key: clean string array aynen geçer (regresyon — mevcut sanitizer.test.ts ile tutarlı)', () => {
    const out = sanitize('auth.login', {
      success: true,
      reason_code: ['OK', 'RETRY'] as unknown as string,
    });
    expect(out).toEqual({ success: true, reason_code: ['OK', 'RETRY'] });
  });
});

describe('sanitizer — mutasyon ve referans güvenliği', () => {
  it('girdi objesi mutate edilmez (top-level)', () => {
    const raw = { success: true, foo: 'drop-me' };
    const snapshot = { ...raw };
    sanitize('auth.login', raw, () => {});
    expect(raw).toEqual(snapshot);
  });

  it('nested obje mutate edilmez — YENİ obje üretilir (deep-equal ama farklı referans)', () => {
    const nested = { success: true, foo: 'drop-me' };
    const raw = { reason_code: nested as unknown as string };
    const out = sanitize('auth.login', raw, () => {});
    expect((out as unknown as Record<string, unknown>)['reason_code']).not.toBe(nested);
  });

  it('DİZİ SIĞ-REFERANS (SD-S-12, LOW/MEDIUM): çıktı orijinal array referansını PAYLAŞIR, deep-clone edilmez', () => {
    const arr = ['OK'];
    const out = sanitize('auth.login', {
      success: true,
      reason_code: arr as unknown as string,
    });
    // Snapshot ilkesi (§7) açısından risk: sanitize() dönüşünden SONRA
    // orijinal `arr` mutate edilirse, "sanitized" olarak loglanan veri de
    // (henüz JSON.stringify edilmediyse) değişir.
    expect((out as unknown as Record<string, unknown>)['reason_code']).toBe(arr);
  });
});

describe('sanitizer — opak konteyner tipleri (SD-S-11, MEDIUM): Map/Set/Date içeriği taranmaz', () => {
  it('Map değeri hiç incelenmeden aynen geçer — içindeki "phone" anahtarı deny-list taramasından muaf kalır', () => {
    const piiMap = new Map([['phone', '05320000000']]);
    const out = sanitize('auth.login', {
      success: true,
      reason_code: piiMap as unknown as string,
    });
    // isPlainRecord(Map) === false (prototip Object.prototype değil) ve
    // Array.isArray(Map) === false → ne recurse ne deny-scan edilir, aynen kopyalanır.
    expect((out as unknown as Record<string, unknown>)['reason_code']).toBe(piiMap);
  });
});

describe('sanitizer — döngüsel referans (SD-S-10, MEDIUM): guard YOK, kontrolsüz RangeError', () => {
  it('döngüsel array (kendine referans) → RangeError (stack overflow) — sanitize() bunu yakalayıp kontrollü hata üretmiyor', () => {
    const circular: unknown[] = [];
    circular.push(circular);
    expect(() =>
      sanitize('auth.login', {
        success: true,
        reason_code: circular as unknown as string,
      }),
    ).toThrow(RangeError);
  });
});

describe('sanitizer — __proto__ anahtarı (pozitif güvenlik testi, temiz çıkar)', () => {
  it('JSON.parse ile gelen "__proto__" own-property\'si whitelist-miss olarak sessizce düşer, prototip kirlenmesi OLMAZ', () => {
    const raw = JSON.parse('{"success":true,"__proto__":{"polluted":true}}') as Record<
      string,
      unknown
    >;
    const out = sanitize('auth.login', raw);
    expect(out).toEqual({ success: true });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
