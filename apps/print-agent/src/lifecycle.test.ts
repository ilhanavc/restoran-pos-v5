import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeBackoff, registerLifecycleHandlers } from './lifecycle.js';

/**
 * P11-A-03 + P11-B-02 regresyon kilidi — ağ-backoff artış/cap/reset mantığı +
 * süreç yaşam-döngüsü handler kaydı. Saf/izole (main() yan-etkisi yok).
 */
describe('computeBackoff (P11-A-03)', () => {
  it('reset (0) → taban 1000ms', () => {
    expect(computeBackoff(0)).toBe(1000);
  });

  it('ardışık hata 3x artar: 1000→3000→9000', () => {
    expect(computeBackoff(1000)).toBe(3000);
    expect(computeBackoff(3000)).toBe(9000);
  });

  it('15000ms cap aşılmaz (hot-loop yerine sabit tavan)', () => {
    expect(computeBackoff(9000)).toBe(15000);
    expect(computeBackoff(15000)).toBe(15000);
    expect(computeBackoff(999999)).toBe(15000);
  });

  it('negatif prev (reset sinyali) → taban', () => {
    expect(computeBackoff(-1)).toBe(1000);
  });
});

describe('registerLifecycleHandlers (P11-B-02)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SIGTERM/SIGINT/unhandledRejection/uncaughtException handler kaydeder', () => {
    // process.on'u mock'la → gerçek handler eklenmesin (test process'ini korur).
    const spy = vi.spyOn(process, 'on').mockReturnValue(process);
    registerLifecycleHandlers();
    const events = spy.mock.calls.map((c) => c[0]);
    expect(events).toContain('SIGTERM');
    expect(events).toContain('SIGINT');
    expect(events).toContain('unhandledRejection');
    expect(events).toContain('uncaughtException');
  });
});
