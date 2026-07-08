import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendToSpoolerPrinter } from './spooler-transport.js';

/**
 * Gerçek vendored `spooler-raw.exe` (NativeAOT) opt-in smoke — spawn-mock
 * DEĞİL, gerçek binary. NativeAOT derlemesinin fiilen çalıştığını + winspool
 * `OpenPrinter` P/Invoke'unun gerçekten çağrıldığını + Win32 hata kodu → exit
 * code → tipli hata zincirini FİZİKSEL YAZICI OLMADAN doğrular (native-interop
 * dersi: [[feedback_native_interop_verify_against_sdk]] — "P/Invoke
 * uydurma-ama-derlenir" riskini kapatır; DllImport runtime-çözümlü, build/mock
 * yakalamaz). Fiziksel baskı (WritePrinter tam yol) cutover'da gerçek
 * KASA-2026'da doğrulanır.
 *
 * skipIf: yalnız Windows'ta + exe vendored ise koşar. CI (Linux) atlar
 * (exe Windows PE — vendored ama Linux'ta çalışmaz). Dev Windows'ta çalışır.
 */
const HELPER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'installer',
  'vendor',
  'spooler-raw.exe',
);
const CAN_RUN = process.platform === 'win32' && existsSync(HELPER);

describe.skipIf(!CAN_RUN)('spooler-raw.exe (gerçek NativeAOT binary)', () => {
  it('yanlış queue → SPOOLER_ERROR_PRINTER_NOT_FOUND (gerçek winspool OpenPrinter, Win32 1801)', async () => {
    process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'] = HELPER;
    try {
      await expect(
        sendToSpoolerPrinter(new Uint8Array([0x1b, 0x40, 0x41]), {
          type: 'spooler',
          printerName: 'NONEXISTENT_QUEUE_ZZZ',
          timeoutMs: 5000,
        }),
      ).rejects.toThrow(/SPOOLER_ERROR_PRINTER_NOT_FOUND/);
    } finally {
      delete process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'];
    }
  });
});
