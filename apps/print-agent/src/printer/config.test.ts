import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPrinterConfig } from './config.js';

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
});
