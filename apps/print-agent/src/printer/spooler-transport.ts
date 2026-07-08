import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import type { SpoolerPrinterConfig } from './config.js';

/**
 * ADR-004 Amendment 4 — Windows Spooler RAW pass-through transport.
 *
 * ESC/POS byte akışını Windows print spooler'a `RAW` datatype ile yollar.
 * Node'da yerleşik winspool yok → küçük, runtime-bağımsız yardımcı exe
 * (`spooler-raw.exe`, C# NativeAOT, vendored) `child_process` ile spawn
 * edilir: byte'lar **stdin**, `printerName` **argv[1]**. Yardımcı içeride
 * Win32 zincirini yürütür: `OpenPrinter → StartDocPrinter(DOC_INFO_1{
 * pDatatype="RAW" }) → StartPagePrinter → WritePrinter(stdin) →
 * EndPagePrinter/EndDocPrinter/ClosePrinter`.
 *
 * Neden yardımcı exe (ADR-004 Amd4 §2): agent `@yao-pkg/pkg` ile tek exe'ye
 * derleniyor ve `usb` addon'unu zaten `pkg.assets`'e gömüyor; 2. bir native
 * Node addon eklemek pkg native-addon riskini ikiye katlardı. Yardımcı exe
 * Node tarafında **sıfır yeni addon** getirir. Byte'lar stdin'den (disk'e fiş
 * yazılmaz — KVKK-hijyen, atomik).
 *
 * Neden Zadig'siz (birincil hedef): spooler aynı Windows sürücüsünü kullanır
 * → kasa yazıcısının sürücüsü değişmez → aynı kuyruğa basan başka POS
 * (Adisyo) bozulmaz. S87'de POS-80'de ampirik doğrulandı (CP857/ESC t 61
 * byte'ları kusursuz Türkçe bastı, round-trip sonrası Adisyo hâlâ basıyor).
 *
 * Platform: yalnız Windows. `process.platform !== 'win32'` →
 * `SPOOLER_ERROR_UNSUPPORTED_PLATFORM` (schema portable kalır, guard
 * transport'ta — usb-transport'un tipli-hata paterni).
 *
 * Hata türleri (yardımcı non-zero exit code + stderr → tipli hata; caller
 * retry kararı verir — Agent main loop log'lar ve `failed` raporlar,
 * server-side retry Migration 036):
 *   - `SPOOLER_ERROR_PRINTER_NOT_FOUND` → OpenPrinter fail / yanlış queue adı
 *     (Win32 `ERROR_INVALID_PRINTER_NAME` 1801). Yardımcı exit 2.
 *   - `SPOOLER_ERROR_ACCESS_DENIED` → `ERROR_ACCESS_DENIED` (5); queue izinleri
 *     / başka process kilidi. Yardımcı exit 3.
 *   - `SPOOLER_ERROR_WRITE` → StartDoc/StartPage/WritePrinter/EndDoc başarısız.
 *     Yardımcı exit 4.
 *   - `SPOOLER_ERROR_TIMEOUT` → yardımcı `config.timeoutMs`'i aştı → agent
 *     child'ı öldürür (tcp/usb tek-bütçe paritesi).
 *   - `SPOOLER_ERROR_SPAWN` → yardımcı exe bulunamadı/başlatılamadı
 *     (yol/kurulum sorunu — 'error' event'i).
 *
 * Race condition önlemi: tek `settled` flag ile timeout/error/close
 * event'lerinin çok seferli resolve/reject etmesi engellenir; her yolda
 * child öldürülür (timeout'ta çalışan child, başarıda no-op) — dangling
 * process önlenir. tcp/usb settle paritesi. Transport tek deneme yapar.
 */
export async function sendToSpoolerPrinter(
  bytes: Uint8Array,
  config: SpoolerPrinterConfig,
): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error(
      '[print-agent] Spooler transport yalnız Windows platformunda çalışır — SPOOLER_ERROR_UNSUPPORTED_PLATFORM',
    );
  }

  const helperPath = resolveHelperPath();

  return new Promise<void>((resolve, reject) => {
    // spawn ENOENT/exe-yok durumunu senkron THROW etmez, 'error' event'i
    // ile bildirir → `const child` definite-assigned, settle güvenle kill'ler.
    const child = spawn(helperPath, [config.printerName], {
      windowsHide: true,
    });
    let settled = false;
    let stderr = '';

    const timer = setTimeout(() => {
      settle(
        new Error(
          `[print-agent] Spooler yazma zaman aşımı (${config.timeoutMs.toString()}ms) — SPOOLER_ERROR_TIMEOUT`,
        ),
      );
    }, config.timeoutMs);

    const settle = (err?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Hata/timeout'ta child hâlâ çalışıyorsa öldür (dangling process
      // önlenir); başarıyla çıktıysa kill no-op. tcp/usb settle paritesi.
      child.kill();
      if (err !== undefined) reject(err);
      else resolve();
    };

    // ENOENT (yardımcı exe yok) / spawn başlatma hatası buradan gelir.
    child.on('error', (err) => {
      settle(
        new Error(
          `[print-agent] Spooler yardımcı exe başlatılamadı (${helperPath}): ${err.message} — SPOOLER_ERROR_SPAWN`,
        ),
      );
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    // Tüm stdio kapandı + exit code hazır. 0 → success; non-zero → tipli hata.
    child.on('close', (code) => {
      if (code === 0) {
        settle();
        return;
      }
      settle(new Error(classifyExitCode(code ?? -1, stderr.trim())));
    });

    // Byte'ları stdin'e yaz + EOF. Child erken ölürse stdin EPIPE verebilir;
    // gerçek hatayı 'close'/'error' raporlar → buradaki EPIPE yutulur.
    child.stdin.on('error', () => {
      /* EPIPE: child stdin'i okumadan çıktı; close/error settle eder. */
    });
    child.stdin.write(Buffer.from(bytes));
    child.stdin.end();
  });
}

/** Vendored yardımcı exe adı (MSI agent exe ile aynı dizine kurar). */
const SPOOLER_HELPER_EXE_NAME = 'spooler-raw.exe';

/**
 * Yardımcı exe yolunu çözer: `PRINT_AGENT_SPOOLER_HELPER_PATH` env override →
 * yoksa agent çalıştırılabilirinin komşusu (sibling) `spooler-raw.exe`.
 *
 * MSI kurulumu yardımcıyı agent exe ile aynı dizine (INSTALLFOLDER) koyar →
 * sibling default doğru çözer: `process.execPath` = pkg .exe'nin GERÇEK disk
 * yolu (pkg virtual FS'i değil) → `CreateProcess` sorunsuz. dev/`tsx`
 * çalıştırmasında `process.execPath` node.exe olur → env override şart.
 */
function resolveHelperPath(): string {
  const override = process.env['PRINT_AGENT_SPOOLER_HELPER_PATH'];
  if (override !== undefined && override !== '') return override;
  return join(dirname(process.execPath), SPOOLER_HELPER_EXE_NAME);
}

/**
 * Yardımcı exe'nin non-zero exit code'unu tipli `SPOOLER_ERROR_*` mesajına
 * çevirir (ADR-004 Amd4 §5). Yardımcı Win32 `GetLastError`'a göre distinct
 * kod döndürür; stderr Win32 detayını taşır.
 *   1 → USAGE (argv/printerName eksik — programlama/kurulum hatası)
 *   2 → PRINTER_NOT_FOUND (OpenPrinter fail; ERROR_INVALID_PRINTER_NAME 1801)
 *   3 → ACCESS_DENIED (ERROR_ACCESS_DENIED 5; queue izni / başka proses kilidi)
 *   4 → WRITE (StartDoc/StartPage/WritePrinter/EndDoc başarısız)
 */
function classifyExitCode(code: number, stderr: string): string {
  const detail = stderr === '' ? '' : `: ${stderr}`;
  switch (code) {
    case 1:
      return `[print-agent] Spooler yardımcı kullanım hatası — SPOOLER_ERROR_USAGE${detail}`;
    case 2:
      return `[print-agent] Yazıcı kuyruğu bulunamadı — SPOOLER_ERROR_PRINTER_NOT_FOUND${detail}`;
    case 3:
      return `[print-agent] Yazıcı kuyruğuna erişim reddedildi — SPOOLER_ERROR_ACCESS_DENIED${detail}`;
    case 4:
      return `[print-agent] Yazıcıya yazma başarısız — SPOOLER_ERROR_WRITE${detail}`;
    default:
      return `[print-agent] Spooler yardımcı beklenmeyen çıkış (exit ${code.toString()})${detail}`;
  }
}
