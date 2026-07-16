import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import {
  PrintJobKindSchema,
  type PrintJobKind,
} from '@restoran-pos/shared-types';

/**
 * ADR-004 §5 + §Phase 3 PR-5b — Printer config schema.
 *
 * Phase 3 PR-5b scope: TCP 9100 + USB transport. `PrinterConfigSchema`
 * `z.discriminatedUnion('type', [Tcp, Usb])` ile genişledi; mevcut
 * `config.json` dosyaları (`type: 'tcp'`) geriye dönük uyumlu.
 *
 * ADR-004 Amendment 4: `spooler` transport (Windows print queue → RAW
 * datatype pass-through) 3. dal olarak eklendi; `printerName` (queue adı,
 * örn. 'KASA-2026') ile tanımlanır. Union'a dal eklemek mevcut tcp/usb
 * config'lerini BOZMAZ. Detay: `./spooler-transport.ts`.
 *
 * Schema runtime + compile-time tip güvencesi sağlar; invalid config dosyası
 * boot'ta hata fırlatır → main loop register'a giremeden durdurur.
 *
 * USB transport: `findByIds(vendorId, productId)` ile cihaz bulunur, opsiyonel
 * `serialNumber` çoklu cihaz disambiguator. vendorId/productId 16-bit unsigned
 * integer (USB descriptor standardı). Detay: `./usb-transport.ts`.
 */

/**
 * Transport yazma timeout'u (üç transport için ortak).
 *
 * ADR-004 Amd6 B3 — reclaim koordinasyonu: agent'ın claim→ack süresi
 * `timeoutMs + worst-case ack bütçesi (53s; ack.ts)` kadar olabilir ve bu
 * süre sunucunun `PRINT_AGENT_RECLAIM_STALE_SECONDS`'ını (default 90s,
 * apps/api/src/routes/print-jobs.ts) AŞMAMALIDIR — aşarsa basılmış ama ack'i
 * gecikmiş job reclaim edilip ikinci kez basılabilir. Default 10s güvenli
 * (10+53+15 marj = 78 ≤ 90). **Bu değeri ~20s üstüne çıkaracaksan sunucuda
 * PRINT_AGENT_RECLAIM_STALE_SECONDS'ı da yükselt** (ack.test.ts B3 testleri
 * bu sınırı belgeler).
 */
const TimeoutMsSchema = z.number().int().min(100).max(60000).default(10000);

const TcpPrinterConfigSchema = z.object({
  type: z.literal('tcp'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  timeoutMs: TimeoutMsSchema,
});

const UsbPrinterConfigSchema = z.object({
  type: z.literal('usb'),
  /** USB vendor ID (16-bit unsigned, descriptor `idVendor`). */
  vendorId: z.number().int().min(0x0000).max(0xffff),
  /** USB product ID (16-bit unsigned, descriptor `idProduct`). */
  productId: z.number().int().min(0x0000).max(0xffff),
  /** Çoklu aynı-model cihaz disambiguator (opsiyonel). */
  serialNumber: z.string().optional(),
  timeoutMs: TimeoutMsSchema,
});

const SpoolerPrinterConfigSchema = z.object({
  type: z.literal('spooler'),
  /**
   * Windows print queue adı (Denetim Masası > Yazıcılar), örn. 'KASA-2026'.
   * VID/PID DEĞİL — yazıcının Windows'a kurulu kuyruk adı. Byte akışı bu
   * kuyruğa RAW datatype ile gönderilir (yardımcı exe; ./spooler-transport.ts).
   */
  printerName: z.string().trim().min(1),
  timeoutMs: TimeoutMsSchema,
});

export const PrinterConfigSchema = z.discriminatedUnion('type', [
  TcpPrinterConfigSchema,
  UsbPrinterConfigSchema,
  SpoolerPrinterConfigSchema,
]);
export type PrinterConfig = z.infer<typeof PrinterConfigSchema>;
export type TcpPrinterConfig = z.infer<typeof TcpPrinterConfigSchema>;
export type UsbPrinterConfig = z.infer<typeof UsbPrinterConfigSchema>;
export type SpoolerPrinterConfig = z.infer<typeof SpoolerPrinterConfigSchema>;

export const AgentConfigSchema = z.object({
  printer: PrinterConfigSchema,
  // ADR-032 — ikincil yazıcı yönlendirmesi: bu agent'ın claim edeceği iş
  // türleri (`GET /jobs/next?kind=`). Yok/undefined → tüm türler (tek-yazıcı
  // kurulum + mevcut bootstrap agent geriye dönük). Boş dizi anlamsız (hiçbir
  // job basmaz) → `.nonempty()` ile boot'ta fail-fast.
  jobKinds: z.array(PrintJobKindSchema).nonempty().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Config dosyasının beklendiği Windows yolu (MSI installer Phase 4+ yazar). */
const WINDOWS_CONFIG_RELATIVE = ['restoran-pos', 'print-agent.json'] as const;
/** Unix/dev fallback yol parçası (kullanıcı home altında). */
const UNIX_CONFIG_RELATIVE = ['.restoran-pos', 'print-agent.json'] as const;

/**
 * Verilen yoldaki JSON dosyasını okuyup tam `AgentConfig` (printer + jobKinds)
 * olarak parse eder. Dosya yoksa `null` döner — çağıran fallback'lara devam
 * eder. Schema ihlali fırlar (boot'ta config bozuk → kasıtlı fail-fast).
 */
function tryLoadFromPath(filePath: string): AgentConfig | null {
  if (!existsSync(filePath)) return null;
  // P11-B-01: PS5.1 `Set-Content -Encoding UTF8` config'e UTF-8 BOM (EF BB BF)
  // ekleyebilir; JSON.parse BOM'da "Unexpected token" fırlatır → boot-loop.
  // BOM'u strip et (agent-tarafı defense-in-depth; installer de utf8NoBOM yazar).
  const raw = JSON.parse(
    readFileSync(filePath, 'utf8').replace(/^﻿/, ''),
  ) as unknown;
  return AgentConfigSchema.parse(raw);
}

/**
 * Config dosyasını öncelik sırasıyla çözer:
 *   1. `PRINT_AGENT_CONFIG_PATH` env varsa o dosya
 *   2. Windows: `%PROGRAMDATA%/restoran-pos/print-agent.json`
 *   3. Unix/dev: `$HOME/.restoran-pos/print-agent.json`
 * İlk bulunan tam `AgentConfig` döner; hiçbiri yoksa `null` (çağıran
 * env-compose'a düşer). Schema ihlali fırlar (fail-fast).
 */
function resolveFileConfig(): AgentConfig | null {
  const customPath = process.env['PRINT_AGENT_CONFIG_PATH'];
  if (customPath !== undefined && customPath !== '') {
    const cfg = tryLoadFromPath(customPath);
    if (cfg !== null) return cfg;
  }
  const programData = process.env['PROGRAMDATA'];
  if (programData !== undefined && programData !== '') {
    const cfg = tryLoadFromPath(join(programData, ...WINDOWS_CONFIG_RELATIVE));
    if (cfg !== null) return cfg;
  }
  const home = process.env['HOME'];
  if (home !== undefined && home !== '') {
    const cfg = tryLoadFromPath(join(home, ...UNIX_CONFIG_RELATIVE));
    if (cfg !== null) return cfg;
  }
  return null;
}

/**
 * Yazıcı config'ini çözer: önce config dosyası ({@link resolveFileConfig}
 * öncelik sırası 1-3), yoksa env-var compose (`PRINT_AGENT_PRINTER_HOST` +
 * `PRINT_AGENT_PRINTER_PORT`, TCP-only — dev/test/CI; USB config dosyası şart,
 * vendorId/productId integer yorumlama hatasını önler). Hiçbiri yoksa
 * açıklayıcı `Error` fırlatır — `main()`'in en başında oluşur, register'a
 * girmeden agent durur (fail-fast).
 */
export function loadPrinterConfig(): PrinterConfig {
  const fileConfig = resolveFileConfig();
  if (fileConfig !== null) return fileConfig.printer;

  const host = process.env['PRINT_AGENT_PRINTER_HOST'];
  const portStr = process.env['PRINT_AGENT_PRINTER_PORT'];
  if (
    host !== undefined &&
    host !== '' &&
    portStr !== undefined &&
    portStr !== ''
  ) {
    return PrinterConfigSchema.parse({
      type: 'tcp',
      host,
      port: Number(portStr),
    });
  }

  throw new Error(
    '[print-agent] Printer config yok. PRINT_AGENT_CONFIG_PATH veya ' +
      'PRINT_AGENT_PRINTER_HOST + PRINT_AGENT_PRINTER_PORT env ile ' +
      'tanımla. (MSI installer Phase 4+ %PROGRAMDATA% yolu yazar.)',
  );
}

/**
 * ADR-032 — bu agent'ın claim edeceği iş türleri (`GET /jobs/next?kind=`
 * filtresi). Öncelik: `PRINT_AGENT_JOB_KINDS` env (CSV, dev/test/CI) → config
 * dosyası `jobKinds` alanı ({@link resolveFileConfig}). Hiçbiri yoksa
 * `undefined` → agent hiçbir `kind` param göndermez, TÜM türleri claim eder
 * (tek-yazıcı / geriye dönük). Geçersiz değer fırlar (boot fail-fast — printer
 * config ile aynı sözleşme). Mutfak yazıcısı `["kitchen"]`, kasa `["bill"]`.
 */
export function loadJobKinds(): readonly PrintJobKind[] | undefined {
  const envRaw = process.env['PRINT_AGENT_JOB_KINDS'];
  if (envRaw !== undefined && envRaw.trim() !== '') {
    const parts = envRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    return z.array(PrintJobKindSchema).nonempty().parse(parts);
  }
  return resolveFileConfig()?.jobKinds ?? undefined;
}
