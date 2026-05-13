import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * ADR-004 §5 + §6 Soru #3 — Printer config schema.
 *
 * Phase 3 PR-5a scope: TCP 9100 transport only. USB transport (`type: 'usb'`)
 * PR-5b'de eklenecek (lokal donanım gerek, kullanıcı eşliği şart). MVP 1:1
 * Agent ↔ printer; secondary printer routing v5.1 backlog.
 *
 * Schema runtime + compile-time tip güvencesi sağlar; invalid config dosyası
 * boot'ta hata fırlatır → main loop register'a giremeden durdurur.
 */
export const PrinterConfigSchema = z.object({
  type: z.literal('tcp'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  timeoutMs: z.number().int().min(100).max(60000).default(10000),
});
export type PrinterConfig = z.infer<typeof PrinterConfigSchema>;

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
 *      (dev/test için yeterli; CI mock TCP server'a yönlendirir)
 *
 * Tüm yollar dener; hiçbiri tutmazsa açıklayıcı `Error` fırlatır. Bu hata
 * `main()`'in en başında oluşur — register'a girmeden agent durur.
 *
 * Phase 4+ MSI installer config dosyasını yazıp UI üzerinden host/port
 * güncellemesi sağlayacak (ADR-004 §6 Soru #3). Bu PR'da env override
 * dev/test/CI için yeterlidir.
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

  // 4. Env-var compose (dev/test/CI)
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
