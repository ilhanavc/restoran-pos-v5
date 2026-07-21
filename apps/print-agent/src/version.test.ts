import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version.js';
import packageJson from '../package.json' with { type: 'json' };

/**
 * Versiyon üç yerde yaşıyor: `package.json` (tek kaynak) · `version.ts` (runtime,
 * boot log'u basar) · `print-agent.wxs` (MSI paket sürümü). İlk ikisi kod
 * seviyesinde bağlı; WiX XML'i bağlı DEĞİL, elle senkron tutuluyor.
 *
 * Bu testin varlık sebebi operasyonel: dükkan PC'sinde exe ELLE kopyalanarak
 * güncelleniyor ve "hangi binary çalışıyor" sorusunun tek ucuz cevabı boot
 * log'undaki versiyon. Bump unutulursa yeni exe ile eski exe ayırt edilemez
 * (S83'te MSI tarafında tam olarak bu yaşandı: bump'sız upgrade sessiz no-op).
 */
describe('VERSION', () => {
  it('package.json ile birebir aynıdır', () => {
    expect(VERSION).toBe(packageJson.version);
  });

  it('WiX paket sürümüyle senkrondur (elle tutulan kopya)', () => {
    const wxsPath = fileURLToPath(
      new URL('../installer/print-agent.wxs', import.meta.url),
    );
    const wxs = readFileSync(wxsPath, 'utf8');
    const match = /\n\s*Version="([^"]+)"/.exec(wxs);

    expect(match, 'print-agent.wxs içinde Version="..." bulunamadı').not.toBe(
      null,
    );
    expect(match?.[1]).toBe(VERSION);
  });
});
