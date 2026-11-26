/**
 * @vitest-environment jsdom
 *
 * 2026-11-26 (ürün sahibi) — anasayfa "Tahsil Edilecek" kartı masa + PAKET.
 *
 * Doğrulanan sözleşme:
 *   - Kart etiketi `dashboard.kpi.openTab` ("Tahsil Edilecek").
 *   - Değer `GET /reports/kpi/open-orders-total` → `openTotalCents` (masa +
 *     paket kalanı); eski kaynak `GET /tables` ARTIK çağrılmaz (paketleri
 *     göremiyordu).
 *   - Uç hata verirse kart "—" gösterir, sayfa çökmez.
 *
 * Paneller (grafik / listeler) başka yerde test edilir → passthrough mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const apiGet = vi.fn();
vi.mock('../../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) as unknown },
}));
vi.mock('../../components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./components/HourlyRevenueChart', () => ({ HourlyRevenueChart: () => null }));
vi.mock('./components/PaymentDistributionPanel', () => ({
  PaymentDistributionPanel: () => null,
}));
vi.mock('./components/TopSellingPanel', () => ({ TopSellingPanel: () => null }));
vi.mock('./components/RecentOrdersPanel', () => ({ RecentOrdersPanel: () => null }));
vi.mock('./components/ClosedOrdersPanel', () => ({ ClosedOrdersPanel: () => null }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { role: 'admin', fullName: 'Test' } }),
}));

const i18n = (await import('../../i18n/init')).default;
const DashboardPage = (await import('./DashboardPage')).default;
const { formatTryFromCents } = await import('./lib/format');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** Yalnız KPI uçları cevaplanır; panel uçları mock'lu olduğu için çağrılmaz. */
function routeApi(openOrders: 'ok' | 'error') {
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/reports/kpi/open-orders-total')) {
      return openOrders === 'ok'
        ? Promise.resolve({
            data: { data: { openTotalCents: 275000, openOrderCount: 3, asOf: '2026-11-26T10:00:00.000Z' } },
          })
        : Promise.reject(new Error('boom'));
    }
    if (path.startsWith('/reports/kpi/today-revenue')) {
      return Promise.resolve({
        data: { data: { totalRevenueCents: 0, paidOrderCount: 0, asOf: 'x', windowStart: 'x', windowEnd: 'x' } },
      });
    }
    if (path.startsWith('/reports/kpi/average-bill')) {
      return Promise.resolve({ data: { data: { averageBillCents: 0, sampleSize: 0, asOf: 'x' } } });
    }
    return Promise.reject(new Error(`beklenmeyen istek: ${path}`));
  });
}

async function render(): Promise<void> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  // react-query çözümlemeleri için birkaç mikro-görev turu
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('DashboardPage — "Tahsil Edilecek" (masa + paket)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('tr');
    apiGet.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('etiket "Tahsil Edilecek", değer open-orders-total ucundan; /tables çağrılmaz', async () => {
    routeApi('ok');
    await render();

    const text = container.textContent ?? '';
    expect(text).toContain(i18n.t('dashboard.kpi.openTab'));
    expect(i18n.t('dashboard.kpi.openTab')).toBe('Tahsil Edilecek');
    expect(text).toContain(formatTryFromCents(275000));

    const paths = apiGet.mock.calls.map((c) => String(c[0]));
    expect(paths).toContain('/reports/kpi/open-orders-total');
    expect(paths.some((p) => p.startsWith('/tables'))).toBe(false);
  });

  it('uç hata verirse kart "—" gösterir, sayfa çökmez', async () => {
    routeApi('error');
    await render();

    const label = [...container.querySelectorAll('*')].find(
      (el) => el.children.length === 0 && el.textContent === i18n.t('dashboard.kpi.openTab'),
    );
    expect(label).toBeDefined();
    const card = label!.closest('div.rounded-2xl') ?? label!.parentElement!.parentElement!;
    expect(card.textContent).toContain('—');
    expect(container.textContent).not.toContain(formatTryFromCents(275000));
  });
});
