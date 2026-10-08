import { describe, expect, it } from 'vitest';

import {
  classifyRefreshFailure,
  type RefreshFailure,
} from './refresh-failure.js';

/**
 * ADR-002 §13 (Amd7). Bu dosya düzeltmenin GERÇEK kapsamasıdır: iki
 * uygulamanın HTTP katmanı test edilemediği için karar mantığı buraya
 * çekildi (bkz. `refresh-failure.ts` docblock).
 */
describe('classifyRefreshFailure', () => {
  describe('oturum KORUNUR', () => {
    it('ağ hatası (fetch reject / abort / timeout) → keep-session', () => {
      // 🔴 Düzeltmenin kalbi: eskiden bu da oturumu düşürüyordu.
      expect(classifyRefreshFailure({ kind: 'network' })).toBe('keep-session');
    });

    it.each([500, 502, 503, 504])(
      '%i (sunucu arızası) → keep-session',
      (status) => {
        // Kimlik sorunu değil; 5xx'te tüm personeli çıkışa zorlamak arızayı
        // büyütür ve token muhtemelen hâlâ geçerlidir.
        expect(classifyRefreshFailure({ kind: 'http', status })).toBe(
          'keep-session',
        );
      },
    );

    it.each([200, 204, 302])(
      '%i (başarısızlık DEĞİL — çağıran hatası) → keep-session',
      (status) => {
        // Savunmacı: çağıranın kurulum hatası yüzünden kimse çıkışa zorlanmaz.
        expect(classifyRefreshFailure({ kind: 'http', status })).toBe(
          'keep-session',
        );
      },
    );
  });

  describe('oturum BİTER', () => {
    it('401 (sunucu token’ı reddetti) → session-ended', () => {
      expect(classifyRefreshFailure({ kind: 'http', status: 401 })).toBe(
        'session-ended',
      );
    });

    it('403 (AUTH_CSRF_CHECK_FAILED) → session-ended', () => {
      // Her refresh aynı şekilde reddedilir; oturumu sürdürmek anlamsız.
      expect(classifyRefreshFailure({ kind: 'http', status: 403 })).toBe(
        'session-ended',
      );
    });

    it.each([400, 404, 422])(
      '%i (beklenmedik 4xx) → session-ended (muhafazakâr)',
      (status) => {
        expect(classifyRefreshFailure({ kind: 'http', status })).toBe(
          'session-ended',
        );
      },
    );

    /**
     * ⚠️ BU TEST BİLİNÇLİ OLARAK MEVCUT DAVRANIŞI ÇİVİLER, "doğru"yu değil.
     * `/auth/refresh`'te bugün rate-limit YOK → 429 beklenmedik bir durum.
     * Açık rate-limit chip'i limiter eklerse 429 **geçici** bir duruma dönüşür
     * ve beklenti `keep-session`'a çevrilmelidir (ADR-002 §13.3). O işi yapan
     * kişi bu testin kırılmasıyla uyarılmış olur — sessizce geçmesin.
     */
    it('429 → session-ended (rate-limit eklenirse YENİDEN DEĞERLENDİR)', () => {
      expect(classifyRefreshFailure({ kind: 'http', status: 429 })).toBe(
        'session-ended',
      );
    });
  });

  it('sınır: 499 session-ended, 500 keep-session (eşik tam yerinde)', () => {
    // Eşiği çivile — `>= 500` yerine `> 500` yazılırsa bu test kırılır.
    expect(classifyRefreshFailure({ kind: 'http', status: 499 })).toBe(
      'session-ended',
    );
    expect(classifyRefreshFailure({ kind: 'http', status: 500 })).toBe(
      'keep-session',
    );
  });

  it('sınır: 399 keep-session, 400 session-ended', () => {
    expect(classifyRefreshFailure({ kind: 'http', status: 399 })).toBe(
      'keep-session',
    );
    expect(classifyRefreshFailure({ kind: 'http', status: 400 })).toBe(
      'session-ended',
    );
  });

  it('tip daraltması: network şekli status taşımaz', () => {
    const f: RefreshFailure = { kind: 'network' };
    expect(classifyRefreshFailure(f)).toBe('keep-session');
  });
});
