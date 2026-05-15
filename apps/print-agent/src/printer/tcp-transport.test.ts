import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { sendToTcpPrinter } from './tcp-transport.js';
import type { TcpPrinterConfig } from './config.js';

/**
 * tcp-transport unit testleri — gerçek printer YOK. `net.createServer`
 * ephemeral port'ta dinleyen mock TCP server kurar; sendToTcpPrinter onun
 * üzerine yazar. Gerçek printer smoke test'i kullanıcı eşliği gerektirir
 * (Phase 4+ deploy hazırlığı), unit seviye burada mock sürer.
 *
 * Senaryolar:
 *   1. küçük byte stream → server alır, byte için byte assertion
 *   2. connection refused → reject (kapalı port, ECONNREFUSED)
 *   3. büyük payload (10 KB) → chunked recv toplamı eşit
 */
describe('sendToTcpPrinter', () => {
  let mockServer: Server;
  let mockPort: number;
  let receivedBytes: Buffer[] = [];

  beforeEach(async () => {
    receivedBytes = [];
    mockServer = createServer((socket) => {
      socket.on('data', (chunk) => receivedBytes.push(chunk));
    });
    await new Promise<void>((resolve, reject) => {
      mockServer.once('error', reject);
      mockServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = mockServer.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error('mock server address beklenmedik şekil');
    }
    mockPort = addr.port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  /**
   * Receiving side asenkron data event'lerini bitirmesi için kısa gecikme
   * verir. Socket close ile server tarafındaki 'data' eventleri arasında
   * Node event loop'unda race olabilir.
   */
  async function waitForRecv(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  it('küçük ESC-POS byte stream başarıyla yollanır', async () => {
    const bytes = new Uint8Array([0x1b, 0x40, 0x48, 0x69]); // ESC @ "Hi"
    const config: TcpPrinterConfig = {
      type: 'tcp',
      host: '127.0.0.1',
      port: mockPort,
      timeoutMs: 2000,
    };
    await sendToTcpPrinter(bytes, config);
    await waitForRecv();
    const received = Buffer.concat(receivedBytes);
    expect(received.length).toBe(4);
    expect(Array.from(received)).toEqual([0x1b, 0x40, 0x48, 0x69]);
  });

  it('connection refused (kapalı port) → reject', async () => {
    // Mock server'ı kapat ki port artık dinlenmesin.
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    const config: TcpPrinterConfig = {
      type: 'tcp',
      host: '127.0.0.1',
      port: mockPort,
      timeoutMs: 1000,
    };
    await expect(
      sendToTcpPrinter(new Uint8Array([0x01]), config),
    ).rejects.toThrow();
  });

  it('büyük payload (10 KB) chunked recv toplamı match', async () => {
    // 10 KB deterministic pattern — KDS fiş 1-2 KB civarı, 10 KB headroom
    // testi (printer driver max packet ≥ 1.5 KB tipik MTU).
    const size = 10_000;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      bytes[i] = i % 256;
    }
    const config: TcpPrinterConfig = {
      type: 'tcp',
      host: '127.0.0.1',
      port: mockPort,
      timeoutMs: 2000,
    };
    await sendToTcpPrinter(bytes, config);
    await waitForRecv();
    const received = Buffer.concat(receivedBytes);
    expect(received.length).toBe(size);
    // İlk + son birkaç byte spot-check (tam buffer compare slow on 10K assert).
    expect(received[0]).toBe(0x00);
    expect(received[255]).toBe(0xff);
    expect(received[size - 1]).toBe((size - 1) % 256);
  });

  it('write hata fırlatmadan promise resolve eder (mock akış)', async () => {
    // Idempotency-ish: aynı transport iki kez çağrılabilir, ikinci de
    // bağımsız resolve eder (caller retry pattern'i için garanti).
    const config: TcpPrinterConfig = {
      type: 'tcp',
      host: '127.0.0.1',
      port: mockPort,
      timeoutMs: 2000,
    };
    await sendToTcpPrinter(new Uint8Array([0xaa]), config);
    await sendToTcpPrinter(new Uint8Array([0xbb]), config);
    await waitForRecv();
    const received = Buffer.concat(receivedBytes);
    expect(received.length).toBe(2);
    expect(Array.from(received)).toEqual([0xaa, 0xbb]);
  });
});
