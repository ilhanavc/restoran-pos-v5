import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REFRESH_GRACE_MS,
  MAX_REFRESH_GRACE_MS,
  resolveRefreshGraceMs,
} from './authConfig';

describe('resolveRefreshGraceMs (ADR-002 §11.2)', () => {
  it('env yoksa varsayılan 60 saniye döner', () => {
    expect(resolveRefreshGraceMs(undefined)).toBe(DEFAULT_REFRESH_GRACE_MS);
    expect(resolveRefreshGraceMs('')).toBe(DEFAULT_REFRESH_GRACE_MS);
    expect(resolveRefreshGraceMs('   ')).toBe(DEFAULT_REFRESH_GRACE_MS);
  });

  it('geçerli değeri aynen döner (grace kapalı = 0 dahil)', () => {
    expect(resolveRefreshGraceMs('0')).toBe(0);
    expect(resolveRefreshGraceMs('15000')).toBe(15_000);
    expect(resolveRefreshGraceMs(String(MAX_REFRESH_GRACE_MS))).toBe(
      MAX_REFRESH_GRACE_MS,
    );
  });

  it('üst sınırı aşan değeri reddeder (yanlış yapılandırma koruması)', () => {
    expect(() => resolveRefreshGraceMs(String(MAX_REFRESH_GRACE_MS + 1))).toThrow(
      /ust siniri asiyor/,
    );
  });

  it('sayı olmayan / negatif / ondalık değeri reddeder', () => {
    expect(() => resolveRefreshGraceMs('abc')).toThrow(/gecersiz/);
    expect(() => resolveRefreshGraceMs('-1')).toThrow(/gecersiz/);
    expect(() => resolveRefreshGraceMs('1.5')).toThrow(/gecersiz/);
  });
});
