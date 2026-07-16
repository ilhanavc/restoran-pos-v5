import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { AckResult } from './ack.js';
import { processJob } from './process-job.js';

/**
 * ADR-004 Amd6 Bölüm B regresyon kilidi — job işleme akışı (P11-A-01/A-02).
 *
 * Kritik davranış: başarılı fiziksel baskıdan SONRA gelen ack hatası ASLA
 * 'failed' olarak raporlanmamalı. Eski akış ack'i printer-dispatch `try`'ının
 * İÇİNDE yapıyordu → ack ağ-hatası catch'e düşüp 'failed' raporlanıyor →
 * server re-queue → basılmış fiş İKİNCİ KEZ basılıyordu.
 *
 * index.ts modül-seviyesinde main() çağırdığı için import edilemez → akış
 * ack.ts/lifecycle.ts desenindeki gibi ayrı modülde test edilir (dispatch +
 * report inject edilir; gerçek fetch/printer yok).
 */

const BYTES_B64 = Buffer.from([0x1b, 0x40, 0x41]).toString('base64');

interface Recorder {
  dispatched: Uint8Array[];
  reports: Array<[status: string, errorText?: string]>;
  order: string[];
}

function makeDeps(
  rec: Recorder,
  opts: {
    dispatchImpl?: () => Promise<void>;
    ackResult?: AckResult;
    reportImpl?: () => Promise<AckResult>;
  } = {},
) {
  return {
    dispatch: async (bytes: Uint8Array): Promise<void> => {
      rec.dispatched.push(bytes);
      rec.order.push('dispatch');
      if (opts.dispatchImpl) await opts.dispatchImpl();
    },
    report: async (
      status: 'success' | 'failed',
      errorText?: string,
    ): Promise<AckResult> => {
      rec.reports.push([status, errorText]);
      rec.order.push(`report:${status}`);
      if (opts.reportImpl) return opts.reportImpl();
      return Promise.resolve(opts.ackResult ?? 'acked');
    },
  };
}

const newRec = (): Recorder => ({ dispatched: [], reports: [], order: [] });

describe('processJob — mutlu yol', () => {
  it('dispatch OK → report("success") TEK kez ve dispatch SONRASI çağrılır', async () => {
    const rec = newRec();
    const outcome = await processJob(
      { id: 'job-1', payload: { bytesBase64: BYTES_B64 } },
      makeDeps(rec),
    );
    expect(outcome).toBe('ok');
    expect(rec.dispatched).toHaveLength(1);
    expect(Array.from(rec.dispatched[0]!)).toEqual([0x1b, 0x40, 0x41]);
    expect(rec.reports).toEqual([['success', undefined]]);
    expect(rec.order).toEqual(['dispatch', 'report:success']);
  });

  it('ack "acked" → outcome "ok" (backoff yok)', async () => {
    const rec = newRec();
    const outcome = await processJob(
      { id: 'job-2', payload: { bytesBase64: BYTES_B64 } },
      makeDeps(rec, { ackResult: 'acked' }),
    );
    expect(outcome).toBe('ok');
  });

  it('ack "gave-up" → outcome "error" (main backoff tetiklenir)', async () => {
    const rec = newRec();
    const outcome = await processJob(
      { id: 'job-3', payload: { bytesBase64: BYTES_B64 } },
      makeDeps(rec, { ackResult: 'gave-up' }),
    );
    expect(outcome).toBe('error');
  });
});

describe('processJob — printer hatası', () => {
  it('dispatch fırlatır → report("failed", mesaj); "success" ASLA raporlanmaz', async () => {
    const rec = newRec();
    const outcome = await processJob(
      { id: 'job-4', payload: { bytesBase64: BYTES_B64 } },
      makeDeps(rec, {
        dispatchImpl: () => Promise.reject(new Error('kağıt bitti')),
      }),
    );
    expect(rec.reports).toEqual([['failed', 'kağıt bitti']]);
    expect(rec.reports.some(([s]) => s === 'success')).toBe(false);
    // Printer arızası ağ sorunu DEĞİL: ack başarılıysa outcome 'ok' kalır →
    // main-loop backoff'u gereksiz yere claim'i yavaşlatmaz.
    expect(outcome).toBe('ok');
  });
});

describe('processJob — P11-A-01 çift-basma kilidi (ASIL REGRESYON)', () => {
  it('baskı BAŞARILI + ack ağ-hatası → ASLA "failed" raporlanmaz (yalnız "success" denenir)', async () => {
    // Eski akış: ack, dispatch-try'ının İÇİNDEydi → report'un fetch'i throw
    // edince catch'e düşer → report('failed') → server re-queue → BASILMIŞ FİŞ
    // İKİNCİ KEZ BASILIR. Bu test o regresyonu kilitler: report sözleşme-dışı
    // throw etse bile 'failed' raporlanmamalı.
    const rec = newRec();
    const outcome = await processJob(
      { id: 'job-5', payload: { bytesBase64: BYTES_B64 } },
      makeDeps(rec, {
        reportImpl: () => Promise.reject(new Error('ECONNRESET')),
      }),
    );
    expect(rec.dispatched).toHaveLength(1);
    expect(rec.reports).toEqual([['success', undefined]]);
    expect(rec.reports.some(([s]) => s === 'failed')).toBe(false);
    // Ack teslim edilemedi → reclaim devralacak (B1 at-least-once) + ağ
    // sinyali main-loop'a taşınır.
    expect(outcome).toBe('error');
  });

  it('report sözleşme-dışı fırlatsa da processJob reject ETMEZ (döngü ölmez)', async () => {
    const rec = newRec();
    await expect(
      processJob(
        { id: 'job-6', payload: { bytesBase64: BYTES_B64 } },
        makeDeps(rec, {
          reportImpl: () => {
            throw new Error('senkron patlama');
          },
        }),
      ),
    ).resolves.toBe('error');
  });
});

describe('processJob — bozuk payload', () => {
  it('bytesBase64 yok → report("failed") ve dispatch ASLA çağrılmaz', async () => {
    const rec = newRec();
    const outcome = await processJob(
      { id: 'job-7', payload: {} },
      makeDeps(rec),
    );
    expect(rec.dispatched).toHaveLength(0);
    expect(rec.reports).toEqual([
      ['failed', 'payload.bytesBase64 missing or empty'],
    ]);
    expect(outcome).toBe('ok');
  });

  it('bytesBase64 boş string → report("failed"), dispatch yok', async () => {
    const rec = newRec();
    await processJob({ id: 'job-8', payload: { bytesBase64: '' } }, makeDeps(rec));
    expect(rec.dispatched).toHaveLength(0);
    expect(rec.reports[0]?.[0]).toBe('failed');
  });

  it('bytesBase64 string değil → report("failed"), dispatch yok', async () => {
    const rec = newRec();
    await processJob(
      { id: 'job-9', payload: { bytesBase64: 42 } },
      makeDeps(rec),
    );
    expect(rec.dispatched).toHaveLength(0);
    expect(rec.reports[0]?.[0]).toBe('failed');
  });

  it('bozuk payload + ack gave-up → outcome "error"', async () => {
    const rec = newRec();
    const outcome = await processJob(
      { id: 'job-10', payload: {} },
      makeDeps(rec, { ackResult: 'gave-up' }),
    );
    expect(outcome).toBe('error');
  });
});
