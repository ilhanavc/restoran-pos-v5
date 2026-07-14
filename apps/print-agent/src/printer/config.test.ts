import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPrinterConfig, PrinterConfigSchema } from './config.js';

/**
 * loadPrinterConfig unit testleri — config dosya öncelik sırası + env-var
 * fallback + schema validation. Her test izole edilmiş tmp directory kullanır
 * (kullanıcı home / PROGRAMDATA dokunulmaz).
 *
 * Test izolasyonu: PRINT_AGENT_*, PROGRAMDATA, HOME env'leri her beforeEach'ta
 * temizlenir → testler arası sızıntı yok. afterEach orijinal env'i geri yükler.
 */
describe('loadPrinterConfig', () => {
  let tmpDir: string;
  // Restore'a giden orijinal env değerleri.
  const SAVED: Record<string, string | undefined> = {};
  const KEYS = [
    'PRINT_AGENT_CONFIG_PATH',
    'PRINT_AGENT_PRINTER_HOST',
    'PRINT_AGENT_PRINTER_PORT',
    'PROGRAMDATA',
    'HOME',
  ];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'print-agent-cfg-'));
    for (const k of KEYS) {
      SAVED[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    for (const k of KEYS) {
      const original = SAVED[k];
      if (original === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = original;
      }
    }
  });

  it('env compose ile config dönmeli (host + port)', () => {
    process.env['PRINT_AGENT_PRINTER_HOST'] = '192.168.1.50';
    process.env['PRINT_AGENT_PRINTER_PORT'] = '9100';
    const cfg = loadPrinterConfig();
    expect(cfg.type).toBe('tcp');
    expect(cfg.host).toBe('192.168.1.50');
    expect(cfg.port).toBe(9100);
    // timeoutMs default 10000
    expect(cfg.timeoutMs).toBe(10000);
  });

  it('hiçbir env yok → açıklayıcı Error fırlatır', () => {
    expect(() => loadPrinterConfig()).toThrowError(
      /Printer config yok.*PRINT_AGENT_PRINTER_HOST/,
    );
  });

  it('PORT="abc" (invalid) → schema validation throw', () => {
    process.env['PRINT_AGENT_PRINTER_HOST'] = '10.0.0.1';
    process.env['PRINT_AGENT_PRINTER_PORT'] = 'abc';
    // Number("abc") → NaN, zod int().min(1) reddetmeli.
    expect(() => loadPrinterConfig()).toThrow();
  });

  it('PRINT_AGENT_CONFIG_PATH ile JSON dosyadan okur', () => {
    const cfgPath = join(tmpDir, 'print-agent.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({
        printer: {
          type: 'tcp',
          host: 'printer.local',
          port: 9100,
          timeoutMs: 5000,
        },
      }),
      'utf8',
    );
    process.env['PRINT_AGENT_CONFIG_PATH'] = cfgPath;
    const cfg = loadPrinterConfig();
    expect(cfg.host).toBe('printer.local');
    expect(cfg.port).toBe(9100);
    expect(cfg.timeoutMs).toBe(5000);
  });

  it('BOM ile başlayan config dosyasını parse eder (P11-B-01, PS5.1 installer regresyonu)', () => {
    const cfgPath = join(tmpDir, 'print-agent.json');
    // PS5.1 `Set-Content -Encoding UTF8` dosyaya UTF-8 BOM (EF BB BF) ekler →
    // BOM strip'siz JSON.parse "Unexpected token" fırlatır → agent boot-loop.
    writeFileSync(
      cfgPath,
      '﻿' +
        JSON.stringify({
          printer: { type: 'tcp', host: 'bom.local', port: 9100 },
        }),
      'utf8',
    );
    process.env['PRINT_AGENT_CONFIG_PATH'] = cfgPath;
    const cfg = loadPrinterConfig();
    expect(cfg.type).toBe('tcp');
    if (cfg.type === 'tcp') expect(cfg.host).toBe('bom.local');
  });

  it('config dosyada port>65535 → schema reject', () => {
    const cfgPath = join(tmpDir, 'bad.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({
        printer: { type: 'tcp', host: 'p', port: 99999 },
      }),
      'utf8',
    );
    process.env['PRINT_AGENT_CONFIG_PATH'] = cfgPath;
    expect(() => loadPrinterConfig()).toThrow();
  });

  it('PROGRAMDATA fallback dosyadan okur (Windows yolu)', () => {
    // %PROGRAMDATA%/restoran-pos/print-agent.json — tmpDir altına simüle
    const restoranDir = join(tmpDir, 'restoran-pos');
    // mkdtempSync zaten tmpDir oluşturdu; alt klasörü manuel açıyoruz.
    mkdirSync(restoranDir, { recursive: true });
    const cfgPath = join(restoranDir, 'print-agent.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({
        printer: { type: 'tcp', host: 'win-printer', port: 9100 },
      }),
      'utf8',
    );
    process.env['PROGRAMDATA'] = tmpDir;
    const cfg = loadPrinterConfig();
    expect(cfg.host).toBe('win-printer');
  });

  it('config dosyadan spooler printer okur (ADR-004 Amd4)', () => {
    const cfgPath = join(tmpDir, 'print-agent.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({
        printer: { type: 'spooler', printerName: 'KASA-2026' },
      }),
      'utf8',
    );
    process.env['PRINT_AGENT_CONFIG_PATH'] = cfgPath;
    const cfg = loadPrinterConfig();
    expect(cfg.type).toBe('spooler');
    if (cfg.type === 'spooler') {
      expect(cfg.printerName).toBe('KASA-2026');
      expect(cfg.timeoutMs).toBe(10000); // schema default
    }
  });

  it('spooler config printerName boş → schema reject', () => {
    const cfgPath = join(tmpDir, 'bad-spooler.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({ printer: { type: 'spooler', printerName: '' } }),
      'utf8',
    );
    process.env['PRINT_AGENT_CONFIG_PATH'] = cfgPath;
    expect(() => loadPrinterConfig()).toThrow();
  });

  it('backward-compat: usb config union dalı eklenince hâlâ parse edilir', () => {
    const cfgPath = join(tmpDir, 'usb.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({
        printer: { type: 'usb', vendorId: 0x0416, productId: 0x5011 },
      }),
      'utf8',
    );
    process.env['PRINT_AGENT_CONFIG_PATH'] = cfgPath;
    const cfg = loadPrinterConfig();
    expect(cfg.type).toBe('usb');
  });

  it('PrinterConfigSchema üç transport tipini kapsar (dispatch exhaustiveness proxy)', () => {
    // Yeni bir transport eklenip bu liste güncellenmezse test kırılır →
    // index.ts dispatch switch'ine dal ekleme hatırlatıcısı.
    const types = PrinterConfigSchema.options.map((opt) => opt.shape.type.value);
    expect([...types].sort()).toEqual(['spooler', 'tcp', 'usb']);
  });

  it('spooler timeoutMs sınır dışı (99 < 100) → schema reject', () => {
    const cfgPath = join(tmpDir, 'bad-timeout.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({
        printer: { type: 'spooler', printerName: 'KASA-2026', timeoutMs: 99 },
      }),
      'utf8',
    );
    process.env['PRINT_AGENT_CONFIG_PATH'] = cfgPath;
    expect(() => loadPrinterConfig()).toThrow();
  });

  it('spooler printerName boşluk-only → schema reject (trim().min(1))', () => {
    const cfgPath = join(tmpDir, 'ws-spooler.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({ printer: { type: 'spooler', printerName: '   ' } }),
      'utf8',
    );
    process.env['PRINT_AGENT_CONFIG_PATH'] = cfgPath;
    expect(() => loadPrinterConfig()).toThrow();
  });
});
