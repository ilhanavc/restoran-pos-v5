/**
 * ADR-004 Amendment 6 — Bölüm B (B2): claim edilmiş bir job'ın işlenme akışı.
 *
 * index.ts'ten ayrık tutulur (ack.ts/lifecycle.ts deseni): index.ts modül
 * seviyesinde `main()` çağırır → doğrudan import agent'ı başlatır. Bu akış
 * çift-basmanın (P11-A-01/A-02) kapandığı yerdir; birim-test edilebilir
 * kalması gerekir. `dispatch` (printer transport) ve `report` (ack) inject
 * edilir → gerçek fetch/printer olmadan davranış kilitlenir.
 */
import { Buffer } from 'node:buffer';
import type { AckResult } from './ack.js';

/**
 * Poll iterasyonunun ağ/sunucu sağlık sinyali (P11-A-03): 'error' → main
 * loop backoff uygular. Job işleme yolunda yalnız ack teslim edilemediğinde
 * (gave-up) 'error' döner — printer arızası ağ sorunu değildir.
 */
export type PollOutcome = 'ok' | 'error';

export interface ProcessJobInput {
  id: string;
  payload: Record<string, unknown>;
}

export interface ProcessJobDeps {
  /** Byte akışını yazıcıya gönderir (transport dispatch). Fırlatabilir. */
  dispatch: (bytes: Uint8Array) => Promise<void>;
  /**
   * Sonucu server'a bildirir. Sözleşme: fırlatmaz (ackWithRetry garantisi);
   * yine de savunma amaçlı sarmalanır (aşağıda) — ack hatası çift-basma
   * üretmemeli.
   */
  report: (
    status: 'success' | 'failed',
    errorText?: string,
  ) => Promise<AckResult>;
}

/**
 * Job'ı işler: payload decode → printer dispatch → sonuç ack'i.
 *
 * **Kritik sıra (P11-A-01):** ack, dispatch `try`'ının DIŞINDADIR. Eski akış
 * ack'i try içinde yapıyordu → başarılı baskıdan sonraki ack ağ-hatası catch'e
 * düşüp `report('failed')` üretiyordu → server re-queue → **basılmış fiş
 * ikinci kez basılırdı.** Burada baskı sonucu (`printError`) ile ack sonucu
 * kesin olarak ayrıştırılmıştır.
 */
export async function processJob(
  job: ProcessJobInput,
  deps: ProcessJobDeps,
): Promise<PollOutcome> {
  const report = async (
    status: 'success' | 'failed',
    errorText?: string,
  ): Promise<PollOutcome> => {
    let ack: AckResult;
    try {
      ack = await deps.report(status, errorText);
    } catch (err) {
      // Sözleşme ihlali (report fırlatmamalı) — döngü yine de ölmez ve
      // ASLA 'failed'e çevrilmez: reclaim devralır (B1 at-least-once).
      console.error(
        `[print-agent] ack beklenmeyen hata jobId=${job.id}:`,
        err instanceof Error ? err.message : err,
      );
      ack = 'gave-up';
    }
    return ack === 'gave-up' ? 'error' : 'ok';
  };

  // `payload` z.record(z.unknown()) — alan tipini runtime'da kontrol et.
  // Malformed payload (alan yok / string değil) → `failed + errorText`.
  const payloadBytes = job.payload['bytesBase64'];
  if (typeof payloadBytes !== 'string' || payloadBytes === '') {
    const reason = 'payload.bytesBase64 missing or empty';
    console.error(`[print-agent] job ${job.id} ${reason}`);
    return report('failed', reason);
  }

  let bytes: Uint8Array;
  try {
    // base64 decode → Buffer → Uint8Array view (zero-copy).
    const buf = Buffer.from(payloadBytes, 'base64');
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    const reason = `base64 decode failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
    console.error(`[print-agent] job ${job.id} ${reason}`);
    return report('failed', reason);
  }

  let printError: string | undefined;
  try {
    await deps.dispatch(bytes);
    console.log(
      `[print-agent] printer OK jobId=${job.id} bytes=${bytes.length.toString()}`,
    );
  } catch (err) {
    printError = err instanceof Error ? err.message : String(err);
    console.error(`[print-agent] printer fail jobId=${job.id}: ${printError}`);
  }

  return printError === undefined
    ? report('success')
    : report('failed', printError);
}
