import { describe, expect, it } from 'vitest';
import { computeBackoff } from './lifecycle.js';
import { PrinterConfigSchema } from './printer/config.js';
import {
  ACK_FETCH_TIMEOUT_MS,
  ACK_MAX_ATTEMPTS,
  ackWithRetry,
  classifyAckHttpStatus,
  type AckAttemptOutcome,
} from './ack.js';

/**
 * ADR-004 Amd6 Bölüm B (B2/B3) regresyon kilidi — reportResult ack'inin
 * sınırlı backoff-retry sarmalayıcısı (P11-A-01/A-02 çift-basma baskın
 * nedeni). Saf/izole: fetch yok, attempt fn + sleepFn inject edilir.
 */
describe('classifyAckHttpStatus (B2)', () => {
  it('5xx → retriable (sunucu geçici hatası)', () => {
    expect(classifyAckHttpStatus(500)).toBe('retriable');
    expect(classifyAckHttpStatus(502)).toBe('retriable');
    expect(classifyAckHttpStatus(503)).toBe('retriable');
  });

  it('408/429 → retriable (timeout / rate-limit)', () => {
    expect(classifyAckHttpStatus(408)).toBe('retriable');
    expect(classifyAckHttpStatus(429)).toBe('retriable');
  });

  it('deterministik 4xx → fatal (aynı POST aynı cevabı verir; bütçe yakılmaz)', () => {
    // 400 PRINT_JOB_NOT_IN_PRINTING_STATE · 404 PRINT_JOB_NOT_FOUND
    // (apps/api routes/print-jobs.ts result kontratı) · 401 auth (refresh
    // main-loop poll yolunda; ack içinde retry etmek bütçeyi boşa yakar).
    expect(classifyAckHttpStatus(400)).toBe('fatal');
    expect(classifyAckHttpStatus(401)).toBe('fatal');
    expect(classifyAckHttpStatus(403)).toBe('fatal');
    expect(classifyAckHttpStatus(404)).toBe('fatal');
  });
});

describe('ackWithRetry (B2 — Tier 1 sınırlı in-process retry)', () => {
  it('saf happy-path: ilk deneme acked → tek çağrı, uyku YOK', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await ackWithRetry(
      () => {
        calls += 1;
        return Promise.resolve('acked' as const);
      },
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    );
    expect(result).toBe('acked');
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('sleepFn reject etse bile ackWithRetry reject ETMEZ ve retry sürer (yapısal no-reject)', async () => {
    const queue: AckAttemptOutcome[] = ['retriable', 'acked'];
    let calls = 0;
    const result = await ackWithRetry(
      () => {
        calls += 1;
        return Promise.resolve(queue.shift() ?? 'acked');
      },
      () => Promise.reject(new Error('uyku iptal edildi')),
    );
    expect(result).toBe('acked');
    expect(calls).toBe(2);
  });

  it('transient hata sonrası başarı: retried → acked (P11-A-01 baskın vaka)', async () => {
    const queue: AckAttemptOutcome[] = ['retriable', 'retriable', 'acked'];
    let calls = 0;
    const sleeps: number[] = [];
    const result = await ackWithRetry(
      () => {
        calls += 1;
        return Promise.resolve(queue.shift() ?? 'acked');
      },
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    );
    expect(result).toBe('acked');
    expect(calls).toBe(3);
    // computeBackoff zinciri: 0→1000→3000 (başarıya ulaşınca durur).
    expect(sleeps).toEqual([1000, 3000]);
  });

  it('kalıcı ağ hatası: bütçe biter → gave-up (reclaim devralır, at-least-once)', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await ackWithRetry(
      () => {
        calls += 1;
        return Promise.resolve('retriable' as const);
      },
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    );
    expect(result).toBe('gave-up');
    expect(calls).toBe(ACK_MAX_ATTEMPTS);
    // Son denemeden sonra uyku YOK (bütçe bitti, hemen dön).
    expect(sleeps).toEqual([1000, 3000, 9000]);
  });

  it('fatal (deterministik 4xx): ANINDA gave-up, retry/uyku yok', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await ackWithRetry(
      () => {
        calls += 1;
        return Promise.resolve('fatal' as const);
      },
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    );
    expect(result).toBe('gave-up');
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('retry ortasında fatal → anında kesilir (bütçe yakılmaz)', async () => {
    const queue: AckAttemptOutcome[] = ['retriable', 'fatal'];
    let calls = 0;
    const sleeps: number[] = [];
    const result = await ackWithRetry(
      () => {
        calls += 1;
        return Promise.resolve(queue.shift() ?? 'acked');
      },
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    );
    expect(result).toBe('gave-up');
    expect(calls).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  it('attempt fırlatırsa retriable sayılır ve ASLA reject etmez (ack-hatası döngüyü öldürmez)', async () => {
    const queue: Array<() => Promise<AckAttemptOutcome>> = [
      () => Promise.reject(new Error('ağ koptu')),
      () => {
        throw new Error('senkron patlama');
      },
      () => Promise.resolve('acked'),
    ];
    const sleeps: number[] = [];
    const result = await ackWithRetry(
      () => (queue.shift() ?? (() => Promise.resolve('acked' as const)))(),
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    );
    expect(result).toBe('acked');
    // throw→'retriable' dönüşümü de backoff uykusundan geçmeli (hot-retry yok).
    expect(sleeps).toEqual([1000, 3000]);
  });

  it('her deneme fırlatsa da resolve eder: gave-up (reject YOK)', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await ackWithRetry(
      () => {
        calls += 1;
        return Promise.reject(new Error('kalıcı ağ hatası'));
      },
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    );
    expect(result).toBe('gave-up');
    expect(calls).toBe(ACK_MAX_ATTEMPTS);
    expect(sleeps).toEqual([1000, 3000, 9000]);
  });
});

describe('B3 — reclaim penceresi koordinasyonu', () => {
  /** apps/api/src/routes/print-jobs.ts → RECLAIM_STALE_SECONDS default 90s. */
  const RECLAIM_STALE_MS_DEFAULT = 90_000;
  const SAFETY_MARGIN_MS = 15_000;

  /** Worst-case ack: her deneme timeout'a düşer + aradaki backoff uykuları. */
  const worstAckMs = (() => {
    let backoff = 0;
    let sleepTotalMs = 0;
    for (let attempt = 1; attempt < ACK_MAX_ATTEMPTS; attempt += 1) {
      backoff = computeBackoff(backoff);
      sleepTotalMs += backoff;
    }
    return ACK_MAX_ATTEMPTS * ACK_FETCH_TIMEOUT_MS + sleepTotalMs;
  })();

  it('DEFAULT config: worst-case ack + transport timeout + marj ≤ 90s', () => {
    // Transport bacağı GERÇEK şemadan türetilir (literal değil) → config
    // default'u yükselirse bu test kırılır ve B3 bilinçli yeniden hesaplanır.
    const defaultTimeoutMs = PrinterConfigSchema.parse({
      type: 'tcp',
      host: '10.0.0.5',
      port: 9100,
    }).timeoutMs;
    expect(defaultTimeoutMs).toBe(10_000);
    expect(
      worstAckMs + defaultTimeoutMs + SAFETY_MARGIN_MS,
    ).toBeLessThanOrEqual(RECLAIM_STALE_MS_DEFAULT);
  });

  it('ŞEMA-MAX transport timeout (60s) default reclaim penceresini AŞAR — bilinçli kalıntı', () => {
    // Şema timeoutMs'e 60s'e kadar izin verir (printer/config.ts). O uçta
    // 60s + 53s = 113s > 90s → basılmış-ama-ack-gecikmiş job reclaim edilebilir
    // (yalnız kind-örtüşen ikinci claimer varsa çift-basma; bugünkü prod
    // topolojisi mutfak='kitchen' / kasa='bill' ayrık, tetiklenemez).
    // KURAL: timeoutMs yükseltilecekse PRINT_AGENT_RECLAIM_STALE_SECONDS de
    // yükseltilmeli — printer/config.ts timeoutMs yorumu + deploy runbook.
    // Bu test o sınırı BELGELER; şema max'ı düşerse/çıkarsa haber verir.
    const maxTimeoutMs = PrinterConfigSchema.parse({
      type: 'tcp',
      host: '10.0.0.5',
      port: 9100,
      timeoutMs: 60_000,
    }).timeoutMs;
    expect(maxTimeoutMs).toBe(60_000);
    expect(worstAckMs + maxTimeoutMs).toBeGreaterThan(RECLAIM_STALE_MS_DEFAULT);
  });
});
