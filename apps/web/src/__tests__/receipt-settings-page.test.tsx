/**
 * @vitest-environment jsdom
 *
 * ADR-045 K7 (PR-2b) — Fiş Ayarları ekranının davranış sözleşmesi.
 *
 * Kilitlenen kurallar:
 *   K3.2 — alt bilgi `null` (varsayılan kapanış) ile `[]` (hiç basma) AYRI
 *          isteklerdir; üst bilgi boşsa `null` yollanır.
 *   K6   — sınırı aşan / izinsiz karakterli / boş satır varken kaydedilemez.
 *   K9   — "Varsayılana dön" onay ister ve metin alanlarını `null` yapar.
 *   K7   — deneme fişi onay ister; istek sürerken düğme pasif.
 *
 * API kancaları ve yazıcı seçimi sondalanır; i18n `t` anahtarı aynen döndürür.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReceiptSettings, ReceiptSettingsUpdate } from '@restoran-pos/shared-types';

const state: {
  saved: ReceiptSettings;
  updateCalls: ReceiptSettingsUpdate[];
  testPrintCalls: Array<string | undefined>;
  testPrintPending: boolean;
  loadError: boolean;
  refetchCalls: number;
} = {
  saved: { receiptHeaderLines: null, receiptFooterLines: null, packingAutoPrintEnabled: true },
  updateCalls: [],
  testPrintCalls: [],
  testPrintPending: false,
  loadError: false,
  refetchCalls: 0,
};

vi.mock('../features/admin/receipt-settings/api', () => ({
  useReceiptSettings: () =>
    state.loadError
      ? {
          data: undefined,
          isPending: false,
          isError: true,
          isSuccess: false,
          isFetching: false,
          refetch: async () => {
            state.refetchCalls += 1;
          },
        }
      : { data: state.saved, isPending: false, isError: false, isSuccess: true, isFetching: false },
  useUpdateReceiptSettings: () => ({
    isPending: false,
    mutateAsync: async (body: ReceiptSettingsUpdate) => {
      state.updateCalls.push(body);
      return body;
    },
  }),
  useReceiptTestPrint: () => ({
    isPending: state.testPrintPending,
    mutate: (id: string | undefined) => {
      state.testPrintCalls.push(id);
    },
  }),
}));

// Yazıcı seçimi: istendiği anda tek yazıcıyı seçmiş gibi davranır (K6.3 yolu).
vi.mock('../features/orders/components/PrintTargetDialog', () => ({
  PrintTargetDialog: ({
    requested,
    onResolved,
  }: {
    requested: boolean;
    onResolved: (id: string | undefined) => void;
  }) => {
    if (requested) queueMicrotask(() => onResolved('printer-1'));
    return null;
  },
}));

vi.mock('../components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/layout/PageHeader', () => ({
  PageHeader: () => null,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => () => undefined }));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { default: ReceiptSettingsPage } = await import(
  '../features/admin/receipt-settings/ReceiptSettingsPage'
);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

const byId = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);
const must = (id: string): HTMLElement => {
  const el = byId(id);
  if (el === null) throw new Error(`missing [data-testid="${id}"]`);
  return el;
};

async function click(id: string): Promise<void> {
  await act(async () => {
    must(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function type(id: string, value: string): Promise<void> {
  const input = must(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<ReceiptSettingsPage />);
  });
}

const saveDisabled = () => (must('save-button') as HTMLButtonElement).disabled;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  state.saved = { receiptHeaderLines: null, receiptFooterLines: null, packingAutoPrintEnabled: true };
  state.updateCalls = [];
  state.testPrintCalls = [];
  state.testPrintPending = false;
  state.loadError = false;
  state.refetchCalls = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('Fiş Ayarları — sıfır yapılandırma', () => {
  it('ilk açılış: varsayılan durum, varsayılan kapanış, "Varsayılana dön" yok, kaydet pasif', async () => {
    await mount();
    expect(must('receipt-status').textContent).toContain('admin.printSettings.status.default');
    expect(byId('footer-default')).not.toBeNull();
    expect(byId('reset-button')).toBeNull();
    expect(byId('receipt-kvkk-note')).not.toBeNull();
    expect(saveDisabled()).toBe(true);
  });
});

describe('Fiş Ayarları — durum ve hata', () => {
  it('yükleme hatası → "Tekrar dene" yeniden ister (çıkmaz sokak yok)', async () => {
    state.loadError = true;
    await mount();
    expect(byId('receipt-load-error')).not.toBeNull();
    await click('receipt-retry');
    expect(state.refetchCalls).toBe(1);
  });

  it('üst bilgi yok + alt bilgi [] → "altına hiçbir şey basılmıyor", "metniniz basılıyor" DEĞİL', async () => {
    state.saved = { receiptHeaderLines: null, receiptFooterLines: [], packingAutoPrintEnabled: true };
    await mount();
    expect(must('receipt-status').textContent).toContain('admin.printSettings.status.noFooter');
  });

  it('kendi metni varken durum "custom"', async () => {
    state.saved = { receiptHeaderLines: ['Tel: 1'], receiptFooterLines: null, packingAutoPrintEnabled: true };
    await mount();
    expect(must('receipt-status').textContent).toContain('admin.printSettings.status.custom');
  });
});

describe('Fiş Ayarları — null ile [] ayrı (K3.2)', () => {
  it('kendi alt bilgisi → satırlar dizi olarak; üst bilgi boşsa null', async () => {
    await mount();
    await click('footer-write-own');
    await type('footer-line-1', 'Yine bekleriz');
    await click('save-button');
    expect(state.updateCalls).toEqual([
      { receiptHeaderLines: null, receiptFooterLines: ['Yine bekleriz'], packingAutoPrintEnabled: true },
    ]);
  });

  it('"Alt bilgiyi boşalt" → [] (hiç basma), null DEĞİL', async () => {
    state.saved = { receiptHeaderLines: null, receiptFooterLines: ['Eski'], packingAutoPrintEnabled: true };
    await mount();
    await click('footer-clear');
    await click('save-button');
    expect(state.updateCalls.at(-1)?.receiptFooterLines).toEqual([]);
  });

  it('"Varsayılan kapanışı kullan" → null', async () => {
    state.saved = { receiptHeaderLines: null, receiptFooterLines: ['Eski'], packingAutoPrintEnabled: true };
    await mount();
    await click('footer-use-default');
    await click('save-button');
    expect(state.updateCalls.at(-1)?.receiptFooterLines).toBeNull();
  });
});

describe('Fiş Ayarları — satır doğrulama (K6)', () => {
  it('41 karakter: sayaç 41/40 ve kaydet pasif; 40 karakter: kaydedilebilir', async () => {
    await mount();
    await click('header-add-line');
    await type('header-line-1', 'a'.repeat(41));
    expect(must('header-line-1-counter').textContent).toBe('admin.printSettings.charCounter');
    expect(must('header-line-1').getAttribute('aria-invalid')).toBe('true');
    expect(saveDisabled()).toBe(true);
    await type('header-line-1', 'a'.repeat(40));
    expect(must('header-line-1').getAttribute('aria-invalid')).toBe('false');
    expect(saveDisabled()).toBe(false);
  });

  it('emoji → satır hatalı, kaydet pasif', async () => {
    await mount();
    await click('header-add-line');
    await type('header-line-1', 'Afiyet \u{1F355}');
    expect(must('header-line-1').getAttribute('aria-invalid')).toBe('true');
    expect(saveDisabled()).toBe(true);
  });

  it('boş satır varken kaydedilemez', async () => {
    await mount();
    await click('header-add-line');
    expect(saveDisabled()).toBe(true);
  });

  it('4 satırdan sonra satır eklenemez', async () => {
    await mount();
    for (let i = 0; i < 4; i += 1) await click('header-add-line');
    expect((must('header-add-line') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Fiş Ayarları — varsayılana dön (K9)', () => {
  it('onay olmadan istek yok; onayla metin null, paket anahtarı kayıtlı değerinde', async () => {
    state.saved = {
      receiptHeaderLines: ['Tel: 0212 000 00 00'],
      receiptFooterLines: [],
      packingAutoPrintEnabled: false,
    };
    await mount();
    await click('reset-button');
    expect(state.updateCalls).toHaveLength(0);
    await click('reset-confirm');
    expect(state.updateCalls).toEqual([
      { receiptHeaderLines: null, receiptFooterLines: null, packingAutoPrintEnabled: false },
    ]);
  });

  it('kaydedilmemiş değişiklik varsa onay penceresi silineceğini söyler', async () => {
    state.saved = { receiptHeaderLines: ['Eski'], receiptFooterLines: null, packingAutoPrintEnabled: true };
    await mount();
    await type('header-line-1', 'Yeni');
    await click('reset-button');
    expect(byId('reset-unsaved-note')).not.toBeNull();
  });
});

describe('Fiş Ayarları — deneme fişi (K7)', () => {
  it('onay olmadan basılmaz; onaylayınca seçilen yazıcıya gider', async () => {
    await mount();
    await click('test-print-button');
    expect(state.testPrintCalls).toHaveLength(0);
    await click('test-print-confirm');
    await act(async () => {
      await Promise.resolve();
    });
    expect(state.testPrintCalls).toEqual(['printer-1']);
  });

  it('kaydedilmemiş değişiklik varsa onay penceresi bunu söyler', async () => {
    await mount();
    await click('packing-auto-switch');
    await click('test-print-button');
    expect(byId('test-print-unsaved-note')).not.toBeNull();
  });

  it('istek sürerken düğme pasif', async () => {
    state.testPrintPending = true;
    await mount();
    expect((must('test-print-button') as HTMLButtonElement).disabled).toBe(true);
  });
});
