/**
 * @vitest-environment jsdom
 *
 * Toast konumu davranış sözleşmesi (§9 — Toast + ErrorBoundary).
 *
 * Kilitlenen kurallar:
 *   1. Global varsayılan `bottom-right`: seçenek verilmeyen toast sağ-alt
 *      konteynerde çıkar (ürün sahibi kararı, 2026-09-03).
 *   2. Sayfa-özel override: toast-BAŞINA `position` verilebilir; o toast kendi
 *      konteynerine gider, global varsayılan DEĞİŞMEZ. Sipariş ekranı mobilde
 *      bunu kullanır (altta sabit tutar barı var, sağ-alt toast onu örtüyordu).
 *   3. Override edilen toast TEK KEZ render edilir.
 *   4. Regresyon kapanı: ikinci bir <Toaster> mount etmek konumu "ezmez",
 *      aynı toast'ı ÇOĞALTIR. sonner 2.0.7'de her Toaster global store'a ayrı
 *      abone olur (`sonner/dist/index.mjs:957`); "son mount kazanır" davranışı
 *      YOKTUR. Bu test, blocker'ı "ikinci Toaster ekleyerek" çözmeye kalkan bir
 *      değişikliği kırmak için var.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Toaster, toast } from 'sonner';

// Proje deseni (bkz. print-target-dialog.test.tsx): act(...) uyarısını sustur.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** sonner abonelikte setTimeout + flushSync kullanır — bir tur beklet. */
async function flushToasts(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(ui: React.ReactElement): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
}

/** Toast'ın hangi konum konteynerinde durduğunu döndürür ('bottom-right'). */
function positionsOfRenderedToasts(): string[] {
  return Array.from(
    document.querySelectorAll('[data-sonner-toast]'),
  ).map((el) => {
    const list = el.closest('[data-sonner-toaster]');
    return `${list?.getAttribute('data-y-position')}-${list?.getAttribute(
      'data-x-position',
    )}`;
  });
}

afterEach(async () => {
  toast.dismiss();
  await flushToasts();
  if (root !== null) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

describe('toast konumu', () => {
  it('seçeneksiz toast global bottom-right konteynerine gider', async () => {
    mount(<Toaster position="bottom-right" />);

    act(() => {
      toast.success('kaydedildi');
    });
    await flushToasts();

    expect(positionsOfRenderedToasts()).toEqual(['bottom-right']);
  });

  it('toast-başına position override üste alır ve TEK kopya render eder', async () => {
    mount(<Toaster position="bottom-right" />);

    act(() => {
      toast.success('kaydedildi', { position: 'top-center' });
    });
    await flushToasts();

    // Sipariş ekranı mobil senaryosu: alt bar örtülmesin diye üstte çıkar.
    expect(positionsOfRenderedToasts()).toEqual(['top-center']);
  });

  it('override sonrası global varsayılan bottom-right kalır', async () => {
    mount(<Toaster position="bottom-right" />);

    act(() => {
      toast.success('once ustte', { position: 'top-center' });
    });
    await flushToasts();
    act(() => {
      toast.success('sonra varsayilan');
    });
    await flushToasts();

    // Override sadece kendi toast'ını taşır; sonraki toast yine sağ-altta.
    expect(positionsOfRenderedToasts().sort()).toEqual([
      'bottom-right',
      'top-center',
    ]);
  });

  it('REGRESYON: ikinci <Toaster> konumu ezmez, toast’ı çoğaltır', async () => {
    mount(
      <>
        <Toaster position="bottom-right" />
        <Toaster position="top-center" />
      </>,
    );

    act(() => {
      toast.success('kaydedildi');
    });
    await flushToasts();

    // "Son mount kazanır" OLSAYDI beklenen ['top-center'] olurdu. Gerçekte iki
    // Toaster da aynı toast'ı render eder → çift toast. Bu yüzden sipariş
    // ekranında ikinci Toaster değil, toast-başına position kullanıyoruz.
    expect(positionsOfRenderedToasts()).toHaveLength(2);
  });
});
