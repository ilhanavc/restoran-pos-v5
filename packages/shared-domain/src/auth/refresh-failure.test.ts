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

    it('SADECE 401 ve 403 — başka hiçbir statü oturumu bitirmez', () => {
      // Kuralı doğrudan çivile: 100-599 arasında yalnız bu ikisi.
      const ended: number[] = [];
      for (let s = 100; s < 600; s += 1) {
        if (classifyRefreshFailure({ kind: 'http', status: s }) === 'session-ended') {
          ended.push(s);
        }
      }
      expect(ended).toEqual([401, 403]);
    });
  });

  /**
   * ⚠️ BU TEST BİR GERİLEMEYİ ÖNLER, "doğru"yu keşfetmez.
   * İlk sürüm "diğer 4xx → session-ended" diyordu ve kendi gerekçesiyle
   * çelişiyordu: Nginx yanlış route / eksik build → `/auth/refresh` **404** →
   * tüm personel servis ortasında çıkışa zorlanır ve token'ları revoke edilir.
   * Bu, 5xx için açıkça reddedilen senaryonun aynısı (güvenlik kapısı
   * CONCERN-2, ADR-002 §13.3 Düzeltme).
   */
  it('404 (bozuk deploy / yanlış route) oturumu DÜŞÜRMEZ', () => {
    expect(classifyRefreshFailure({ kind: 'http', status: 404 })).toBe(
      'keep-session',
    );
  });

  /**
   * 429: ADR-002 Amd8 ile `/auth/*`'a taban kova takıldı → bu uçta 429 artık
   * CANLI bir olasılık. 429 **geçici** bir durumdur ve doğru cevap
   * `keep-session`'dır (ADR-002 §13.3 öncülü §14.6'da teyit edildi).
   */
  it('429 → keep-session (limiter canlı; oturum düşmez)', () => {
    expect(classifyRefreshFailure({ kind: 'http', status: 429 })).toBe(
      'keep-session',
    );
  });

  it('tip daraltması: network şekli status taşımaz', () => {
    const f: RefreshFailure = { kind: 'network' };
    expect(classifyRefreshFailure(f)).toBe('keep-session');
  });
});
