/**
 * @vitest-environment jsdom
 *
 * Regresyon: sipariş ekranı SPA navigasyonunda sepeti SIZDIRMAMALI.
 *
 * Canlı bug (2026-08-11): masaya kaydedilmemiş ürün eklenmişken Caller ID
 * popup'ından "Sipariş Aç" → `navigate('/orders/new?type=takeaway&...')`
 * çağrılıyordu. `/tables/:tableId/order` ve `/orders/new` AYNI
 * `<OrderScreenPage />` elemanını `key` olmadan aynı JSX pozisyonunda render
 * ettiği için React unmount+remount değil "update" yapıyor, sepet (düz
 * `useState`, ADR-013 §1) hayatta kalıyordu.
 *
 * Bu suite router.tsx'teki `routes` tablosunu GERÇEĞİYLE koşar; yalnız
 * `OrderScreenPage` bir sonda ile (bkz. `fixtures/CartProbeScreen.tsx`) ve
 * `ProtectedRoute` geçirgen bir sarmalayıcı ile değiştirilir. `key` kaldırılırsa
 * buradaki dört senaryo da kırmızıya döner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

// Auth store / API bağımlılığı olmadan route ağacını render edebilmek için.
vi.mock('../components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Gerçek sipariş ekranı yerine sepet sondası (aynı local-state şekli).
vi.mock(
  '../features/orders/OrderScreenPage',
  () => import('./fixtures/CartProbeScreen'),
);

const { routes } = await import('../router');
const { probeStats, resetProbeStats } = await import(
  './fixtures/CartProbeScreen'
);

declare global {
  // React 18 `act()` uyarısını susturmak için gereken bayrak.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

type MemoryRouter = ReturnType<typeof createMemoryRouter>;

/** Bekleyen mikro-görevleri (lazy() import promise'i dahil) boşalt. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function mountAt(initialEntry: string): Promise<MemoryRouter> {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  await act(async () => {
    root.render(<RouterProvider router={router} />);
  });
  // `lazy()` ilk render'da suspend eder; modül çözülene kadar bir tur daha.
  await flush();
  return router;
}

async function navigateTo(router: MemoryRouter, to: string): Promise<void> {
  await act(async () => {
    await router.navigate(to);
  });
  await flush();
}

function cartCount(): number {
  const el = container.querySelector('[data-testid="cart-count"]');
  if (el === null) {
    throw new Error('Sepet sayacı DOM’da yok — sipariş ekranı render olmadı');
  }
  return Number(el.textContent);
}

async function addItems(count: number): Promise<void> {
  const btn = container.querySelector('[data-testid="add-item"]');
  if (btn === null) throw new Error('"Ekle" butonu bulunamadı');
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      (btn as HTMLButtonElement).click();
    });
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  resetProbeStats();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('sipariş ekranı route remount sözleşmesi', () => {
  it('masa → paket (Caller ID "Sipariş Aç"): kaydedilmemiş sepet taşınmaz', async () => {
    const router = await mountAt('/tables/masa-1/order');
    expect(cartCount()).toBe(0);

    // Kullanıcı iki ürün ekledi ama KAYDETMEDİ.
    await addItems(2);
    expect(cartCount()).toBe(2);

    // IncomingCallProvider.openOrderForCall → callToTakeawayRoute(...) ile
    // birebir aynı SPA-içi navigasyon (tam sayfa yenileme YOK).
    await navigateTo(router, '/orders/new?type=takeaway&phone=05551112233');

    expect(cartCount()).toBe(0);
    expect(probeStats.mountCount).toBe(2);
  });

  it('paket → masa: ters yönde de sepet taşınmaz', async () => {
    const router = await mountAt('/orders/new?type=takeaway');
    await addItems(3);
    expect(cartCount()).toBe(3);

    await navigateTo(router, '/tables/masa-7/order');

    expect(cartCount()).toBe(0);
    expect(probeStats.mountCount).toBe(2);
  });

  it('masa → başka masa: aynı path şablonu, farklı tableId', async () => {
    const router = await mountAt('/tables/masa-1/order');
    await addItems(1);
    expect(cartCount()).toBe(1);

    await navigateTo(router, '/tables/masa-2/order');

    expect(cartCount()).toBe(0);
    expect(probeStats.mountCount).toBe(2);
  });

  it('paket → paket: AYNI /orders/new path’i, farklı arayan', async () => {
    // İki farklı çağrı arka arkaya gelirse path değişmez, yalnız query değişir.
    const router = await mountAt('/orders/new?type=takeaway&phone=05551112233');
    await addItems(2);
    expect(cartCount()).toBe(2);

    await navigateTo(router, '/orders/new?type=takeaway&phone=05559998877');

    expect(cartCount()).toBe(0);
    expect(probeStats.mountCount).toBe(2);
  });

  it('navigasyon YOKKEN yeniden render sepeti korur (aşırı-remount koruması)', async () => {
    const router = await mountAt('/tables/masa-1/order');
    await addItems(2);
    expect(cartCount()).toBe(2);

    // Aynı location — ekran içi herhangi bir üst-render (realtime event vb.)
    // sepeti sıfırlamamalı; yoksa fix kullanıcının yazdığını siler.
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
    await flush();

    expect(cartCount()).toBe(2);
    expect(probeStats.mountCount).toBe(1);
  });
});
