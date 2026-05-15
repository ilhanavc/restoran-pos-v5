import { Socket } from 'node:net';
import type { TcpPrinterConfig } from './config.js';

/**
 * ESC/POS byte stream'i TCP 9100 (raw print) üzerinden printer'a yollar.
 *
 * Kullanım kaynağı: ADR-004 §5 (USB öncelikli + TCP fallback). MVP'de
 * USB transport PR-5b'ye ertelendi; PR-5a yalnız TCP. Çoğu network thermal
 * printer (Epson TM serisi, Star, generic ESC-POS) port 9100'ü raw print
 * akışı için açık tutar — istek headerı yok, sadece byte stream + EOF.
 *
 * Davranış:
 *   - Connect timeout: `config.timeoutMs` (default 10sn)
 *   - Write timeout: aynı; toplam operasyon süresi tek bir bütçe
 *   - Success: socket başarıyla `end()` edilip kapanırsa (no app-layer ack —
 *     printer protokolünde upstream ack yok; TCP transport seviyesindeki
 *     successful close yeterli sayılır)
 *
 * Hata durumları (caller retry kararı verir — Agent main loop log'lar ve
 * `failed` raporlar, server-side retry policy Migration 036 kapsamında):
 *   - `ECONNREFUSED`  → printer offline / yanlış IP
 *   - `ETIMEDOUT`     → ağ / printer cevap vermiyor
 *   - `EHOSTUNREACH`  → routing problem
 *   - `EPIPE` / `ECONNRESET` → printer driver crash / kablo çıktı
 *   - Schema dışı durumlarda da `Error` fırlatılır (caller log'lar).
 *
 * Race condition önlemi: tek `settled` flag ile timeout/error/close
 * event'lerinin çok seferli resolve/reject etmesi engellenir. Promise
 * her durumda tam bir kez settle olur, socket her durumda destroy edilir
 * (dangling FD önlenir).
 */
export async function sendToTcpPrinter(
  bytes: Uint8Array,
  config: TcpPrinterConfig,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;

    const settle = (err?: Error): void => {
      if (settled) return;
      settled = true;
      // destroy() socket'i kapatır + FD'yi serbest bırakır; pending
      // event'ler bu noktadan sonra settled flag ile no-op olur.
      socket.destroy();
      if (err !== undefined) reject(err);
      else resolve();
    };

    socket.setTimeout(config.timeoutMs);
    socket.on('timeout', () => settle(new Error('TCP timeout')));
    socket.on('error', (err) => settle(err));
    // Normal end-of-stream: printer akışı kabul etti, kapatıldı → success.
    socket.on('close', () => settle());

    socket.connect(config.port, config.host, () => {
      // Connected — payload'ı yolla, ardından half-close (FIN) gönder.
      socket.write(Buffer.from(bytes), (err) => {
        if (err !== undefined && err !== null) {
          settle(err);
          return;
        }
        // write callback success ≠ peer flush; gerçek başarı socket.end()
        // sonrası 'close' event'idir. end() FIN paketi yollar, printer
        // tarafı stream'i kapatır.
        socket.end();
      });
    });
  });
}
