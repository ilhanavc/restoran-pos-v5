/**
 * @vitest-environment jsdom
 *
 * ADR-044 Amendment 1 K2 — **yazıcı kaydını kaldırma onayı**.
 *
 * Kardeş diyalogların (kilitle / kilidi aç) aksine bu işlem GERİ ALINAMAZ;
 * tek koruma bu diyalog. O yüzden kuralları kilitlenir:
 *   1. Geri alınamazlık uyarısı her zaman görünür.
 *   2. Onay `onConfirm`i çağırır; iptal ÇAĞIRMAZ ve diyalogu kapatır.
 *   3. Gönderim sürerken onay da iptal de kapalıdır (çift silme yok, yarıda
 *      kapatma yok).
 *   4. Onay düğmesi YIKICI görünür (kilit açmanın tersi: orada geri alınabilir
 *      olduğu için kırmızı DEĞİLDİ).
 *   5. "İptal" DOM'da onaydan ÖNCE gelir → diyalog açılınca odak iptale düşer,
 *      Enter'a yanlışlıkla basmak kaydı silmez.
 *   6. Metinlerin gerçek Türkçe karşılığı vardır; cihaz değişkeni `{{device}}`
 *      ve `count` kullanılmaz (i18next çoğul anahtar arardı).
 *
 * `t` anahtarı aynen döndürür (metin kalitesi turkish-ux-reviewer'ın işi);
 * iddia 6 bunun İSTİSNASI ve sözlüğü doğrudan okur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import tr from '../i18n/locales/tr.json';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { RemovePrinterDialog } = await import(
  '../features/admin/printers/components/RemovePrinterDialog'
);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

async function mount(
  onConfirm: () => Promise<void>,
  opts: { isSubmitting?: boolean } = {},
): Promise<{ onOpenChange: ReturnType<typeof vi.fn> }> {
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <RemovePrinterDialog
        open
        onOpenChange={onOpenChange}
        fallbackLabel="bootstrap-initial"
        isSubmitting={opts.isSubmitting ?? false}
        onConfirm={onConfirm}
      />,
    );
  });
  return { onOpenChange };
}

function dialogButtons(): HTMLButtonElement[] {
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog === null) throw new Error('dialog açılmadı');
  return Array.from(dialog.querySelectorAll('button'));
}

/**
 * Onay düğmesi metninden bulunur. "Son düğme" DEĞİL: Radix `DialogContent`
 * kapatma (X) düğmesini çocuklardan SONRA render ediyor.
 */
function submitButton(): HTMLButtonElement {
  const match = dialogButtons().find((b) => {
    const text = b.textContent ?? '';
    return (
      text.startsWith('admin.printers.remove.confirmSubmit') ||
      text.startsWith('admin.printers.remove.submitting')
    );
  });
  if (match === undefined) throw new Error('onay düğmesi bulunamadı');
  return match;
}

function cancelButton(): HTMLButtonElement {
  const match = dialogButtons().find((b) =>
    (b.textContent ?? '').startsWith('common.cancel'),
  );
  if (match === undefined) throw new Error('iptal düğmesi bulunamadı');
  return match;
}

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

describe('RemovePrinterDialog (ADR-044 Amd1 K2)', () => {
  it('geri alınamazlık uyarısı görünür', async () => {
    await mount(vi.fn(async () => undefined));

    const dialog = document.querySelector('[role="dialog"]');
    const warning = dialog?.querySelector(
      '[data-testid="irreversible-warning"]',
    );
    expect(warning, 'geri alınamazlık uyarısı render edilmedi').toBeTruthy();
    expect(warning?.textContent).toContain('remove.irreversibleTitle');
    expect(warning?.textContent).toContain('remove.irreversibleBody');
  });

  it('onay onConfirm çağırır', async () => {
    const onConfirm = vi.fn(async () => undefined);
    await mount(onConfirm);

    await act(async () => submitButton().click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('iptal onConfirm ÇAĞIRMAZ, dialogu kapatır', async () => {
    const onConfirm = vi.fn(async () => undefined);
    const { onOpenChange } = await mount(onConfirm);

    await act(async () => cancelButton().click());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('gönderim sürerken onay ve iptal kapalıdır', async () => {
    const onConfirm = vi.fn(async () => undefined);
    await mount(onConfirm, { isSubmitting: true });

    expect(submitButton().disabled).toBe(true);
    expect(cancelButton().disabled).toBe(true);
    await act(async () => submitButton().click());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('onay düğmesi YIKICI görünür (geri alınamaz)', async () => {
    await mount(vi.fn(async () => undefined));
    expect(submitButton().className).toContain('destructive');
  });

  it('iptal DOM sırasında onaydan önce gelir (odak iptale düşer)', async () => {
    await mount(vi.fn(async () => undefined));
    const buttons = dialogButtons();
    expect(buttons.indexOf(cancelButton())).toBeLessThan(
      buttons.indexOf(submitButton()),
    );
  });

  it('metinlerin gerçek Türkçe karşılığı vardır ve cihaz {{device}}', () => {
    const rm = tr.admin.printers.remove as Record<string, unknown>;
    for (const key of [
      'submitting',
      'success',
      'confirmTitle',
      'confirmDescription',
      'irreversibleTitle',
      'irreversibleBody',
      'confirmSubmit',
      'failed',
    ]) {
      const text = rm[key];
      expect(text, `tr.json'da eksik: remove.${key}`).toBeTruthy();
      expect(String(text)).not.toContain('admin.printers');
      expect(String(text)).not.toContain('{{count}}');
    }
    expect(String(rm['confirmDescription'])).toContain('{{device}}');
    expect(String(rm['success'])).toContain('{{device}}');
    expect(
      (tr.admin.printers.actions as Record<string, unknown>)['remove'],
    ).toBeTruthy();
    expect(
      (tr.admin.printers.errors as Record<string, unknown>)[
        'PRINTER_NOT_REMOVABLE'
      ],
      'sunucunun 409 kodu ham görünmesin',
    ).toBeTruthy();
  });
});
