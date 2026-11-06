/**
 * @vitest-environment jsdom
 *
 * ADR-044 K4 — yazıcı kartının sürüm satırı + "güncel değil" çipi.
 *
 * Kilitlenen kurallar:
 *   1. Sürüm varsa satır sürümü BASAR (interpolasyon gerçekten bağlanıyor).
 *   2. Sürüm NULL ise "bildirilmedi" anahtarı kullanılır — boş satır değil.
 *   3. Çip YALNIZ `versionStale` true iken DOM'a girer (kural sunucuda; env
 *      boşken sunucu daima false döndürür, yani çip hiç yanmaz).
 *   4. Metinlerin gerçek Türkçe karşılığı var ve interpolasyon değişkeni
 *      `{{version}}` — `count` OLSAYDI i18next çoğul anahtar arardı (S148
 *      dersi; `revoke.orphanWarning` bu yüzden `jobCount` kullanıyor).
 *   5. Ekranda "agent"/"ajan" kelimesi GEÇMEZ (ADR-032 Amd2 K1 dil kuralı).
 *
 * `t` anahtarı aynen döndürür (metin kalitesi turkish-ux-reviewer'ın işi);
 * iddia 4-5 bunun İSTİSNASI ve sözlüğü doğrudan okur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import tr from '../i18n/locales/tr.json';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts === undefined ? key : `${key}|${JSON.stringify(opts)}`,
  }),
}));

const { PrinterVersionLine, PrinterVersionStaleChip } = await import(
  '../features/admin/printers/components/PrinterVersion'
);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('PrinterVersionLine (ADR-044 K4)', () => {
  it('sürüm varsa değeri interpolasyonla basar', async () => {
    await act(async () => {
      root.render(<PrinterVersionLine agentVersion="0.0.5" />);
    });
    const line = container.querySelector('[data-testid="printer-version-line"]');
    expect(line?.textContent).toContain('admin.printers.agentVersion');
    expect(line?.textContent).toContain('0.0.5');
  });

  it('sürüm NULL ise "bildirilmedi" anahtarı kullanılır (boş satır değil)', async () => {
    await act(async () => {
      root.render(<PrinterVersionLine agentVersion={null} />);
    });
    const line = container.querySelector('[data-testid="printer-version-line"]');
    expect(line?.textContent).toBe('admin.printers.versionUnknown');
  });
});

describe('PrinterVersionStaleChip (ADR-044 K4)', () => {
  it('render edilince uyarı çipi DOM\'a girer', async () => {
    await act(async () => {
      root.render(<PrinterVersionStaleChip />);
    });
    const chip = container.querySelector('[data-testid="version-stale-chip"]');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toBe('admin.printers.versionStale');
  });

  it('karttaki mevcut uyarı çipiyle AYNI görsel dil (yeni stil icat edilmedi)', async () => {
    await act(async () => {
      root.render(<PrinterVersionStaleChip />);
    });
    const chip = container.querySelector<HTMLElement>(
      '[data-testid="version-stale-chip"]',
    );
    // `filterless-chip` ile birebir: amber zemin + koyu amber metin.
    expect(chip?.style.background).toBe('rgb(254, 243, 199)');
    expect(chip?.style.color).toBe('rgb(146, 64, 14)');
  });
});

describe('sözlük (tr.json) — ADR-044 K4 anahtarları', () => {
  const printers = tr.admin.printers as Record<string, unknown>;

  it('üç anahtar da var ve Türkçe', () => {
    // Metinler turkish-ux-reviewer kapısında (2026-11-06) değişti:
    // "yazılım" → "sürüm" ("yazılım" yazıcının firmware'iyle karışıyordu) ·
    // "bildirilmedi" → "henüz bilinmiyor" (eksiklik değil, GEÇİCİ durum) ·
    // "güncel değil" → "Güncelleme bekliyor" (uyarı acil DEĞİL; yazıcı
    // çalışmaya devam ediyor, metin sorun değil durum bildirir).
    expect(printers['agentVersion']).toBe('Yazıcı sürümü: {{version}}');
    expect(printers['versionUnknown']).toBe('Yazıcı sürümü: henüz bilinmiyor');
    expect(printers['versionStale']).toBe('Güncelleme bekliyor');
  });

  it('interpolasyon değişkeni `count` DEĞİL (çoğul anahtar tuzağı)', () => {
    expect(printers['agentVersion']).toContain('{{version}}');
    expect(printers['agentVersion']).not.toContain('{{count}}');
  });

  it('kullanıcıya "agent"/"ajan" kelimesi gösterilmez', () => {
    for (const key of ['agentVersion', 'versionUnknown', 'versionStale']) {
      expect(String(printers[key]).toLocaleLowerCase('tr')).not.toMatch(
        /agent|ajan/,
      );
    }
  });
});
