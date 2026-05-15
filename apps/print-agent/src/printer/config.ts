import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * ADR-004 §5 + §Phase 3 PR-5b — Printer config schema.
 *
 * Phase 3 PR-5b scope: TCP 9100 + USB transport. `PrinterConfigSchema`
 * `z.discriminatedUnion('type', [Tcp, Usb])` ile genişledi; mevcut
 * `config.json` dosyaları (`type: 'tcp'`) geriye dönük uyumlu.
 *
 * Schema runtime + compile-time tip güvencesi sağlar; invalid config dosyası
 * boot'ta hata fırlatır → main loop register'a giremeden durdurur.
 *
 * USB transport: `findByIds(vendorId, productId)` ile cihaz bulunur, opsiyonel
 * `serialNumber` çoklu cihaz disambiguator. vendorId/productId 16-bit unsigned
 * integer (USB descriptor standardı). Detay: `./usb-transport.ts`.
 */

const TcpPrinterConfigSchema = z.object({
  type: z.literal('tcp'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  timeoutMs: z.number().int().min(100).max(60000).default(10000),
});

const UsbPrinterConfigSchema = z.object({
  type: z.literal('usb'),
  /** USB vendor ID (16-bit unsigned, descriptor `idVendor`). */
  vendorId: z.number().int().min(0x0000).max(0xffff),
  /** USB product ID (16-bit unsigned, descriptor `idProduct`). */
  productId: z.number().int().min(0x0000).max(0xffff),
  /** Çoklu aynı-model cihaz disambiguator (opsiyonel). */
  serialNumber: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(60000).default(10000),
});

export const PrinterConfigSchema = z.discriminatedUnion('type', [
  TcpPrinterConfigSchema,
  UsbPrinterConfigSchema,
]);
export type PrinterConfig = z.infer<typeof PrinterConfigSchema>;
export type TcpPrinterConfig = z.infer<typeof TcpPrinterConfigSchema>;
export type UsbPrinterConfig = z.infer<typeof UsbPrinterConfigSchema>;

export const AgentConfigSchema = z.object({
  printer: PrinterConfigSchema,
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Config dosyasının beklendiği Windows yolu (MSI installer Phase 4+ yazar). */
const WINDOWS_CONFIG_RELATIVE = ['restoran-pos', 'print-agent.json'] as const;
/** Unix/dev fallback yol parçası (kullanıcı home altında). */
const UNIX_CONFIG_RELATIVE = ['.restoran-pos', 'print-agent.json'] as const;

/**
 * Verilen yoldaki JSON dosyasını okuyup `AgentConfigSchema` ile parse eder.
 * Dosya yoksa `null` döner — yukarıdaki fallback'lara devam edilir.
 * Schema ihlali fırlar (boot'ta config bozuk → kasıtlı fail-fast).
 */
function tryLoadFromPath(filePath: string): PrinterConfig | null {
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  return AgentConfigSchema.parse(raw).printer;
}

/**
 * Config yükleme öncelik sırası:
 *   1. `PRINT_AGENT_CONFIG_PATH` env varsa o dosya
 *   2. Windows: `%PROGRAMDATA%/restoran-pos/print-agent.json`
 *      (MSI installer Phase 4+ buraya yazar)
 *   3. Unix/dev fallback: `$HOME/.restoran-pos/print-agent.json`
 *   4. Env-var compose: `PRINT_AGENT_PRINTER_HOST` + `PRINT_AGENT_PRINTER_PORT`
 *      (dev/test için yeterli; CI mock TCP server'a yönlendirir; TCP-only).
 *      USB yapılandırması config dosyası ile yapılır (env compose USB
 *      desteklemez — vendorId/productId integer yorumlama hatasını önler).
 *
 * Tüm yollar dener; hiçbiri tutmazsa açıklayıcı `Error` fırlatır. Bu hata
 * `main()`'in en başında oluşur — register'a girmeden agent durur.
 */
export function loadPrinterConfig(): PrinterConfig {
  // 1. Custom path override (CI / debug için kullanışlı)
  const customPath = process.env['PRINT_AGENT_CONFIG_PATH'];
  if (customPath !== undefined && customPath !== '') {
    const cfg = tryLoadFromPath(customPath);
    if (cfg !== null) return cfg;
  }

  // 2. Windows: %PROGRAMDATA%
  const programData = process.env['PROGRAMDATA'];
  if (programData !== undefined && programData !== '') {
    const winPath = join(programData, ...WINDOWS_CONFIG_RELATIVE);
    const cfg = tryLoadFromPath(winPath);
    if (cfg !== null) return cfg;
  }

  // 3. Unix/dev: $HOME
  const home = process.env['HOME'];
  if (home !== undefined && home !== '') {
    const unixPath = join(home, ...UNIX_CONFIG_RELATIVE);
    const cfg = tryLoadFromPath(unixPath);
    if (cfg !== null) return cfg;
  }

  // 4. Env-var compose (dev/test/CI) — TCP-only. USB için config dosyası şart
  // (vendorId/productId integer; env'de hex string yorumlama hataya açık).
  const host = process.env['PRINT_AGENT_PRINTER_HOST'];
  const portStr = process.env['PRINT_AGENT_PRINTER_PORT'];
  if (
    host !== undefined &&
    host !== '' &&
    portStr !== undefined &&
    portStr !== ''
  ) {
    const portNum = Number(portStr);
    return PrinterConfigSchema.parse({
      type: 'tcp',
      host,
      port: portNum,
    });
  }

  throw new Error(
    '[print-agent] Printer config yok. PRINT_AGENT_CONFIG_PATH veya ' +
      'PRINT_AGENT_PRINTER_HOST + PRINT_AGENT_PRINTER_PORT env ile ' +
      'tanımla. (MSI installer Phase 4+ %PROGRAMDATA% yolu yazar.)',
  );
}
