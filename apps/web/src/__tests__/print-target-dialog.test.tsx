/**
 * @vitest-environment jsdom
 *
 * ADR-032 Amendment 4 (K6) — hedef yazıcı seçim modalinin davranış sözleşmesi.
 *
 * Kilitlenen kurallar:
 *   K6.3 — liste TAM 1 öğe ise modal AÇILMAZ, doğrudan o yazıcıyla basılır.
 *   K6.5 — liste hatası / BOŞ liste → modal açılmaz, baskı HEDEFSİZ gönderilir
 *          (yazıcı listesinin baskıyı bloke etme yetkisi yoktur).
 *   K6.4 — çevrimdışı yazıcı seçilebilir ama KALICI satır-içi uyarı gösterilir.
 *
 * `useAvailablePrinters` sondalanır (ağ yok); i18n `t` anahtarı aynen döndürür
 * (metin doğruluğu i18n-key-checker'ın işi, davranış bu dosyanın işi).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AvailablePrinter } from '@restoran-pos/shared-types';

interface PrintersQueryState {
  data: AvailablePrinter[] | undefined;
  isError: boolean;
  isSuccess: boolean;
}

const queryState: PrintersQueryState = {
  data: undefined,
  isError: false,
  isSuccess: false,
};

vi.mock('../features/payment/api', () => ({
  useAvailablePrinters: (enabled: boolean) =>
    enabled
      ? queryState
      : { data: undefined, isError: false, isSuccess: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { PrintTargetDialog } = await import(
  '../features/orders/components/PrintTargetDialog'
);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

function printer(
  overrides: Partial<AvailablePrinter> & { id: string },
): AvailablePrinter {
  return {
    displayName: `Yazıcı ${overrides.id}`,
    status: 'online',
    isBillPrinter: false,
    ...overrides,
  };
}

async function mount(
  onResolved: (id: string | undefined) => void,
): Promise<void> {
  await act(async () => {
    root.render(
      <PrintTargetDialog
        requested
        onResolved={onResolved}
        onCancel={() => undefined}
      />,
    );
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  queryState.data = undefined;
  queryState.isError = false;
  queryState.isSuccess = false;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('PrintTargetDialog (ADR-032 Amd4 K6)', () => {
  it('K6.3 — tek yazıcı: modal açılmaz, o yazıcıyla doğrudan basar', async () => {
    queryState.data = [printer({ id: 'a1b2c3' })];
    queryState.isSuccess = true;
    const onResolved = vi.fn();

    await mount(onResolved);

    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith('a1b2c3');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('K6.5 — liste hatası: modal açılmaz, HEDEFSİZ istek gönderilir', async () => {
    queryState.isError = true;
    const onResolved = vi.fn();

    await mount(onResolved);

    expect(onResolved).toHaveBeenCalledWith(undefined);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('K6.5 — boş liste: modal açılmaz, HEDEFSİZ istek gönderilir', async () => {
    queryState.data = [];
    queryState.isSuccess = true;
    const onResolved = vi.fn();

    await mount(onResolved);

    expect(onResolved).toHaveBeenCalledWith(undefined);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('birden fazla yazıcı: modal açılır, seçim yapılmadan onay kapalıdır', async () => {
    queryState.data = [
      printer({ id: 'kasa', isBillPrinter: true }),
      printer({ id: 'izgara' }),
    ];
    queryState.isSuccess = true;
    const onResolved = vi.fn();

    await mount(onResolved);

    expect(onResolved).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    // Varsayılan olarak hiçbir satır "onay" konumunda değil (K6.2).
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent === 'order.printTarget.confirm');
    expect(confirm?.disabled).toBe(true);
  });

  it('K6.4 — çevrimdışı yazıcı seçilince kalıcı uyarı görünür, seçim engellenmez', async () => {
    queryState.data = [
      printer({ id: 'kasa', isBillPrinter: true }),
      printer({ id: 'izgara', status: 'offline' }),
    ];
    queryState.isSuccess = true;
    const onResolved = vi.fn();

    await mount(onResolved);

    expect(
      document.querySelector('[data-testid="print-target-offline-warning"]'),
    ).toBeNull();

    const offlineRow = document.querySelector<HTMLButtonElement>(
      '[data-testid="print-target-izgara"]',
    );
    await act(async () => {
      offlineRow!.click();
    });

    // Uyarı KALICI satır-içi metin (toast değil).
    expect(
      document.querySelector('[data-testid="print-target-offline-warning"]')
        ?.textContent,
    ).toContain('order.printTarget.warning.offline');

    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent === 'order.printTarget.confirm');
    expect(confirm?.disabled).toBe(false);
    await act(async () => {
      confirm!.click();
    });
    expect(onResolved).toHaveBeenCalledWith('izgara');
  });
});
