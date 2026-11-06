import { describe, expect, it } from 'vitest';
import { buildJobsNextQuery, buildRegisterBody } from './agent-request.js';
import { VERSION } from './version.js';

/**
 * ADR-044 K4 — sürümün gerçekten tele bindiğini kilitler.
 *
 * Sürümün gitmemesi sessiz arızadır: sunucu geçersiz/eksik değeri NULL'a
 * düşürüp 200/204 döndürüyor, ajan log'una hiçbir şey düşmüyor ve yazıcı
 * kartında yalnız "bilinmiyor" yazıyor. Yani bu taşıma ancak testle
 * gözlenebilir — [[feedback_realtime_contract_dead_untested]] ile aynı sınıf.
 */
describe('buildJobsNextQuery (ADR-044 K4)', () => {
  it('agentVersion her zaman eklenir ve VERSION ile birebir aynıdır', () => {
    const params = new URLSearchParams(
      buildJobsNextQuery({ longPollSeconds: 20, jobKinds: undefined }),
    );
    expect(params.get('agentVersion')).toBe(VERSION);
  });

  it('mevcut wait + tekrarlı kind kurulumu BOZULMAZ (ADR-032)', () => {
    const params = new URLSearchParams(
      buildJobsNextQuery({
        longPollSeconds: 25,
        jobKinds: ['kitchen', 'grill'],
      }),
    );
    expect(params.get('wait')).toBe('25');
    expect(params.getAll('kind')).toEqual(['kitchen', 'grill']);
    expect(params.get('agentVersion')).toBe(VERSION);
  });

  it('jobKinds undefined iken kind param HİÇ eklenmez (geriye dönük)', () => {
    const params = new URLSearchParams(
      buildJobsNextQuery({ longPollSeconds: 5, jobKinds: undefined }),
    );
    expect(params.getAll('kind')).toEqual([]);
  });

  it('sunucunun kabul ettiği biçimdedir (major.minor.patch)', () => {
    const params = new URLSearchParams(
      buildJobsNextQuery({ longPollSeconds: 5, jobKinds: undefined }),
    );
    // Sunucu bu regex'i geçmeyen değeri NULL'a düşürür → rozet kör kalırdı.
    expect(params.get('agentVersion')).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('buildRegisterBody (ADR-044 K4)', () => {
  it('apiKey + deviceFingerprint korunur, agentVersion eklenir', () => {
    expect(
      buildRegisterBody({ apiKey: 'pk_test', deviceFingerprint: 'fp-1' }),
    ).toEqual({
      apiKey: 'pk_test',
      deviceFingerprint: 'fp-1',
      agentVersion: VERSION,
    });
  });
});
