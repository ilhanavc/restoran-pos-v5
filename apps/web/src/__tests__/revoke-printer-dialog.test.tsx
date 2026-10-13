/**
 * @vitest-environment jsdom
 *
 * ADR-004 Amendment 14 (K1) — yazıcı kilitleme onayının davranış sözleşmesi.
 *
 * Kilitlenen kurallar:
 *   1. Gerekçe seçilmeden kilitlenemez (onay düğmesi kapalı, `onConfirm` yok).
 *   2. `onConfirm` SABİT LİSTEDEN gelen enum değeriyle çağrılır — serbest
 *      metin yoktur (gerekçe `audit_logs.payload`'a uzun retention ile
 *      yazıldığı için KVKK gereği enum; `packages/shared-types/src/printer.ts`).
 *   3. Dropdown `PRINTER_REVOKE_REASONS`'tan TÜRER — listeye yeni gerekçe
 *      eklenip UI'da görünmemesi sessiz bir boşluk olurdu.
 *   4. Her gerekçenin GERÇEK bir Türkçe etiketi vardır (ham anahtar değil).
 *      Şema listesi tek başına yeterli değil: yeni gerekçe eklenip i18n
 *      etiketi unutulursa yönetici dropdown'da `admin.printers.revoke...`
 *      görür. Bu iddia gerçek sözlüğü okur, `t`-sondası ile ÖLÇÜLEMEZ.
 *   5. Dialog her açılışta gerekçeyi sıfırlar — önceki yazıcının gerekçesi
 *      yanlışlıkla bir başkasına uygulanmaz (yıkıcı aksiyon).
 *
 * `t` anahtarı aynen döndürür (metin kalitesi turkish-ux-reviewer'ın işi);
 * iddia 4 bunun İSTİSNASI ve sözlüğü doğrudan okur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  PRINTER_REVOKE_REASONS,
  type PrinterRevokeReason,
} from '@restoran-pos/shared-types';
import tr from '../i18n/locales/tr.json';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { RevokePrinterDialog } = await import(
  '../features/admin/printers/components/RevokePrinterDialog'
);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

async function mount(
  onConfirm: (r: PrinterRevokeReason) => Promise<void>,
  opts: { open?: boolean; isSubmitting?: boolean } = {},
): Promise<void> {
  await act(async () => {
    root.render(
      <RevokePrinterDialog
        open={opts.open ?? true}
        onOpenChange={() => undefined}
        fallbackLabel="Fırın"
        isSubmitting={opts.isSubmitting ?? false}
        onConfirm={onConfirm}
      />,
    );
  });
}

function reasonSelect(): HTMLSelectElement {
  const el = document.querySelector<HTMLSelectElement>(
    '#printer-revoke-reason',
  );
  if (el === null) throw new Error('gerekçe seçimi render edilmedi');
  return el;
}

/**
 * Onay düğmesi metninden bulunur. "Dialog içindeki son düğme" DEĞİL: Radix
 * `DialogContent` kapatma (X) düğmesini çocuklardan SONRA render ediyor, yani
 * son düğme X'tir — metni boş ve her zaman etkin olduğundan `disabled`
 * iddiaları sessizce yanlış yeşil/kırmızı verirdi (ampirik olarak ölçüldü).
 */
function submitButton(): HTMLButtonElement {
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog === null) throw new Error('dialog açılmadı');
  const match = Array.from(dialog.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').startsWith('admin.printers.revoke.submit'),
  );
  if (match === undefined) throw new Error('onay düğmesi bulunamadı');
  return match;
}

async function pickReason(value: string): Promise<void> {
  const select = reasonSelect();
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
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

describe('RevokePrinterDialog (ADR-004 Amd14 K1)', () => {
  it('gerekçe seçilmeden kilitlenemez — onay kapalı, onConfirm çağrılmaz', async () => {
    const onConfirm = vi.fn(async () => undefined);
    await mount(onConfirm);

    const submit = submitButton();
    expect(submit.disabled).toBe(true);

    await act(async () => submit.click());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('gerekçe seçilince onConfirm ENUM değeriyle çağrılır', async () => {
    const onConfirm = vi.fn(async () => undefined);
    await mount(onConfirm);

    await pickReason('stolen_or_lost');
    expect(submitButton().disabled).toBe(false);

    await act(async () => submitButton().click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('stolen_or_lost');
  });

  it('dropdown şemadaki TÜM gerekçeleri içerir (ne eksik ne fazla)', async () => {
    await mount(vi.fn(async () => undefined));

    const values = Array.from(reasonSelect().options)
      .map((o) => o.value)
      .filter((v) => v !== ''); // placeholder

    expect(values).toEqual([...PRINTER_REVOKE_REASONS]);
  });

  it('her gerekçenin gerçek Türkçe etiketi vardır (i18n drift kapısı)', () => {
    const labels = tr.admin.printers.revoke.reasons as Record<string, string>;
    for (const reason of PRINTER_REVOKE_REASONS) {
      const label = labels[reason];
      expect(label, `tr.json'da eksik gerekçe etiketi: ${reason}`).toBeTruthy();
      // Ham anahtar sızmasın ("admin.printers..." gibi) ve anlamlı olsun.
      expect(label).not.toContain('admin.printers');
      expect((label ?? '').trim().length).toBeGreaterThan(2);
    }
  });

  it('kapanıp yeniden açılınca gerekçe sıfırlanır', async () => {
    const onConfirm = vi.fn(async () => undefined);
    await mount(onConfirm);
    await pickReason('compromised');
    expect(reasonSelect().value).toBe('compromised');

    await mount(onConfirm, { open: false });
    await mount(onConfirm, { open: true });

    expect(reasonSelect().value).toBe('');
    expect(submitButton().disabled).toBe(true);
  });

  it('gönderim sürerken onay kapalıdır (çift kilitleme yok)', async () => {
    const onConfirm = vi.fn(async () => undefined);
    await mount(onConfirm, { isSubmitting: true });

    await pickReason('decommissioned');
    expect(submitButton().disabled).toBe(true);

    await act(async () => submitButton().click());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
