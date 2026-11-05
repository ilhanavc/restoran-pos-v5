/**
 * @vitest-environment jsdom
 *
 * ADR-004 Amendment 14 ertelenmiş işi — **kilit açma onayı**.
 *
 * Neden kilit AÇMAK da onay istiyor: kilitliyken bu yazıcıya pinlenmiş işler
 * kuyrukta birikir; kilit açılır açılmaz ajan hepsini arka arkaya çeker ve
 * **biriken fişler topluca basılır**. Müdür kaç fiş çıkacağını önceden
 * bilmeli.
 *
 * Kilitlenen kurallar:
 *   1. Uyarı bloğu her zaman görünür (bu dialog yalnız `> 0` iken açılır).
 *   2. Onay `onConfirm`i çağırır; iptal ÇAĞIRMAZ.
 *   3. Gönderim sürerken onay kapalıdır (çift açma yok).
 *   4. Metinlerin gerçek Türkçe karşılığı vardır ve sayı değişkeni
 *      `{{jobCount}}`tır (`count` olsaydı i18next çoğul anahtar arardı).
 *   5. Onay düğmesi YIKICI DEĞİL: kilit açmak geri alınabilir ve işleri
 *      kurtarır — kırmızı düğme yanlış zihinsel model verirdi.
 *
 * `t` anahtarı aynen döndürür (metin kalitesi turkish-ux-reviewer'ın işi);
 * iddia 4 bunun İSTİSNASI ve sözlüğü doğrudan okur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import tr from '../i18n/locales/tr.json';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { UnrevokePrinterDialog } = await import(
  '../features/admin/printers/components/UnrevokePrinterDialog'
);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

async function mount(
  onConfirm: () => Promise<void>,
  opts: { isSubmitting?: boolean; pinnedPendingJobs?: number } = {},
): Promise<{ onOpenChange: ReturnType<typeof vi.fn> }> {
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <UnrevokePrinterDialog
        open
        onOpenChange={onOpenChange}
        fallbackLabel="Fırın"
        pinnedPendingJobs={opts.pinnedPendingJobs ?? 4}
        isSubmitting={opts.isSubmitting ?? false}
        onConfirm={onConfirm}
      />,
    );
  });
  return { onOpenChange };
}

/**
 * Onay düğmesi metninden bulunur. "Son düğme" DEĞİL: Radix `DialogContent`
 * kapatma (X) düğmesini çocuklardan SONRA render ediyor, yani son düğme
 * X'tir ve `disabled` iddiaları sessizce yanlış sonuç verirdi.
 */
function submitButton(): HTMLButtonElement {
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog === null) throw new Error('dialog açılmadı');
  // Gönderim sürerken etiket `confirmSubmit` → `submitting` olur; ikisini de
  // kabul et, yoksa `isSubmitting` iddiası düğmeyi hiç bulamaz.
  const match = Array.from(dialog.querySelectorAll('button')).find((b) => {
    const text = b.textContent ?? '';
    return (
      text.startsWith('admin.printers.unrevoke.confirmSubmit') ||
      text.startsWith('admin.printers.unrevoke.submitting')
    );
  });
  if (match === undefined) throw new Error('onay düğmesi bulunamadı');
  return match;
}

function cancelButton(): HTMLButtonElement {
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog === null) throw new Error('dialog açılmadı');
  const match = Array.from(dialog.querySelectorAll('button')).find((b) =>
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

describe('UnrevokePrinterDialog (ADR-004 Amd14 ertelenmiş iş)', () => {
  it('toplu baskı uyarısı görünür', async () => {
    await mount(vi.fn(async () => undefined), { pinnedPendingJobs: 12 });

    const dialog = document.querySelector('[role="dialog"]');
    const warning = dialog?.querySelector('[data-testid="burst-warning"]');
    expect(warning, 'toplu baskı uyarısı render edilmedi').toBeTruthy();
    expect(warning?.textContent).toContain('unrevoke.burstWarningTitle');
    expect(warning?.textContent).toContain('unrevoke.burstWarningBody');
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

  it('gönderim sürerken onay kapalıdır (çift açma yok)', async () => {
    const onConfirm = vi.fn(async () => undefined);
    await mount(onConfirm, { isSubmitting: true });

    expect(submitButton().disabled).toBe(true);
    await act(async () => submitButton().click());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('onay düğmesi YIKICI görünmez (kilit açmak geri alınabilir)', async () => {
    await mount(vi.fn(async () => undefined));
    expect(submitButton().className).not.toContain('destructive');
  });

  it('metinlerin gerçek Türkçe karşılığı vardır ve sayı {{jobCount}}', () => {
    const un = tr.admin.printers.unrevoke as Record<string, unknown>;
    for (const key of [
      'confirmTitle',
      'confirmDescription',
      'burstWarningTitle',
      'burstWarningBody',
      'confirmSubmit',
    ]) {
      const text = un[key];
      expect(text, `tr.json'da eksik: unrevoke.${key}`).toBeTruthy();
      expect(String(text)).not.toContain('admin.printers');
    }
    expect(String(un['burstWarningTitle'])).toContain('{{jobCount}}');
    expect(String(un['confirmDescription'])).toContain('{{device}}');
  });
});
