/**
 * @vitest-environment jsdom
 *
 * 2026-11-26 (ürün sahibi) — Raporlar özet kartlarına "Şu An Tahsil Edilecek"
 * (masa + paket, `GET /reports/kpi/open-orders-total`).
 *
 * Doğrulanan sözleşme:
 *   - Kart etiketi `reports.kpi.openOrders` ("Şu An Tahsil Edilecek"), değer
 *     `openTotalCents`.
 *   - Kart sayfanın tarih aralığı filtresine BAĞLI DEĞİL: aralık değişince
 *     open-orders-total isteği aralık parametresi TAŞIMAZ ve değer aynı kalır
 *     (canlı gösterge; ciro kartları ise aralıkla yeniden istenir).
 *
 * Paneller ve başlık düğmeleri başka yerde test edilir → passthrough mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';

const apiGet = vi.fn();
vi.mock('../../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) as unknown },
}));
vi.mock('../../components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
// Aralığı testten değiştirebilmek için RangeFilter tek düğmeye indirgenir.
vi.mock('./components/RangeFilter', () => ({
  RangeFilter: ({ onChange }: { onChange: (q: ReportRangeQuery) => void }) => (
    <button type="button" data-testid="range-last7" onClick={() => onChange({ range: 'last7' })} />
  ),
}));
vi.mock('../dashboard/components/HourlyRevenueChart', () => ({ HourlyRevenueChart: () => null }));
vi.mock('../dashboard/components/PaymentDistributionPanel', () => ({
  PaymentDistributionPanel: () => null,
}));
vi.mock('../dashboard/components/TopSellingPanel', () => ({ TopSellingPanel: () => null }));
vi.mock('./components/CategorySalesPanel', () => ({ CategorySalesPanel: () => null }));
vi.mock('./components/UserPerformancePanel', () => ({ UserPerformancePanel: () => null }));
vi.mock('./components/TrendPanel', () => ({ TrendPanel: () => null }));
vi.mock('./components/TipsPanel', () => ({ TipsPanel: () => null }));
vi.mock('./components/AnomaliesDetailPanel', () => ({ AnomaliesDetailPanel: () => null }));
vi.mock('./components/CsvDownloadButton', () => ({ CsvDownloadButton: () => null }));
vi.mock('./components/SnapshotButton', () => ({ SnapshotButton: () => null }));
vi.mock('./components/DailyCloseButton', () => ({ DailyCloseButton: () => null }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { role: 'admin' } }),
}));

const i18n = (await import('../../i18n/init')).default;
const ReportsPage = (await import('./ReportsPage')).default;
const { formatTryFromCents } = await import('../dashboard/lib/format');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function routeApi() {
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/reports/kpi/open-orders-total')) {
      return Promise.resolve({
        data: { data: { openTotalCents: 275000, openOrderCount: 3, asOf: '2026-11-26T10:00:00.000Z' } },
      });
    }
    if (path.startsWith('/reports/kpi/today-revenue')) {
      return Promise.resolve({
        data: { data: { totalRevenueCents: 0, paidOrderCount: 0, asOf: 'x', windowStart: 'x', windowEnd: 'x' } },
      });
    }
    if (path.startsWith('/reports/kpi/order-count')) {
      return Promise.resolve({
        data: { data: { totalOrders: 0, byStatus: { open: 0, paid: 0, cancelled: 0 }, asOf: 'x', windowStart: 'x', windowEnd: 'x' } },
      });
    }
    if (path.startsWith('/reports/kpi/average-bill')) {
      return Promise.resolve({ data: { data: { averageBillCents: 0, sampleSize: 0, asOf: 'x' } } });
    }
    if (path.startsWith('/reports/anomalies')) {
      return Promise.resolve({ data: { data: { summary: { cancelCount: 0 } } } });
    }
    return Promise.reject(new Error(`beklenmeyen istek: ${path}`));
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('ReportsPage — "Şu An Tahsil Edilecek" (masa + paket, canlı)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('tr');
    apiGet.mockReset();
    routeApi();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <ReportsPage />
        </QueryClientProvider>,
      );
    });
    await flush();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('kart etiketi ve değeri open-orders-total ucundan', () => {
    expect(i18n.t('reports.kpi.openOrders')).toBe('Şu An Tahsil Edilecek');
    const text = container.textContent ?? '';
    expect(text).toContain(i18n.t('reports.kpi.openOrders'));
    expect(text).toContain(formatTryFromCents(275000));
  });

  it('tarih aralığı değişince bu kart aralık parametresi almaz, değeri aynı kalır', async () => {
    const button = container.querySelector<HTMLButtonElement>('[data-testid="range-last7"]')!;
    await act(async () => {
      button.click();
    });
    await flush();

    const paths = apiGet.mock.calls.map((c) => String(c[0]));
    // Ciro kartı aralıkla YENİDEN istendi (filtre gerçekten değişti)…
    expect(paths.some((p) => p.startsWith('/reports/kpi/today-revenue') && p.includes('range=last7'))).toBe(true);
    // …ama tahsil edilecek ucu hiçbir zaman aralık taşımaz.
    const openCalls = paths.filter((p) => p.startsWith('/reports/kpi/open-orders-total'));
    expect(openCalls.length).toBeGreaterThan(0);
    expect(openCalls.every((p) => p === '/reports/kpi/open-orders-total')).toBe(true);
    expect(container.textContent).toContain(formatTryFromCents(275000));
  });
});
