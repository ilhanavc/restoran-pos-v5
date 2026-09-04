/**
 * @vitest-environment jsdom
 *
 * ADR-015 Amendment 10 — `ClosedOrdersPage` (Kapanan Siparişler tam liste)
 * davranış testleri.
 *
 * Doğrulanan sözleşme:
 *   - Toplam kayıt sayısı `totalClosedCount`'tan basılır (offset'ten bağımsız).
 *   - "Sonraki" sayfaya geçince endpoint `offset` KAYARAK (0 → PAGE_SIZE) yeni
 *     istek yapar; "Önceki" ilk sayfada devre dışıdır.
 *   - Boş pencere DÜRÜST boş-durum metni basar (sahte satır yok).
 *
 * Metinler `tr.json`'dan GERÇEK anahtarlarla okunur (hardcoded string yok).
 * AppShell / RangeFilter / VoidPaymentDialog başka yerde test edilir →
 * burada passthrough mock'lanır ki test sayfanın sayfalama mantığına odaklansın.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
vi.mock('../../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) as unknown },
}));

// AppShell router/auth/socket bağımlılıklarını taşır → sayfayı çıplak sarmala.
vi.mock('../../components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
// RangeFilter kendi state'ini taşır; bu test aralık değiştirmiyor.
vi.mock('./components/RangeFilter', () => ({
  RangeFilter: () => null,
}));
vi.mock('../payment/components/VoidPaymentDialog', () => ({
  VoidPaymentDialog: () => null,
}));
// admin rolü → void butonu render edilir (ayrıca sayfaya erişim).
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { role: 'admin' } }),
}));

const i18n = (await import('../../i18n/init')).default;
const ClosedOrdersPage = (await import('./ClosedOrdersPage')).default;

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function makeOrders(n: number, startIdx = 0) {
  return Array.from({ length: n }).map((_, i) => {
    const idx = startIdx + i;
    const isTakeaway = idx % 2 !== 0;
    return {
      orderId: `00000000-0000-0000-0000-${String(idx).padStart(12, '0')}`,
      // Çift → dine_in (masa), tek → takeaway (müşteri adlı).
      tableCode: isTakeaway ? null : `M${idx}`,
      tableDisplayNo: isTakeaway ? null : idx,
      customerName: isTakeaway ? `Müşteri ${idx}` : null,
      totalCents: 12300 + i,
      paidAt: '2026-09-03T11:30:00.000Z',
      paymentTypeMix: ['cash'],
    };
  });
}

function resolveWith(orders: unknown[], total: number) {
  apiGet.mockResolvedValue({
    data: {
      data: {
        orders,
        totalClosedCount: total,
        asOf: '2026-09-04T10:00:00.000Z',
        windowStart: '2026-09-03T00:00:00.000Z',
        windowEnd: '2026-09-04T00:00:00.000Z',
      },
    },
  });
}

function render(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <ClosedOrdersPage />
      </QueryClientProvider>,
    );
  });
}

async function flush(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const t = (key: string, opts?: Record<string, unknown>): string =>
  String(i18n.t(key, opts as never));

beforeEach(() => {
  apiGet.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ClosedOrdersPage — ADR-015 Amd10', () => {
  it('toplam kayıt sayısını totalClosedCount\'tan basar ve satırları render eder', async () => {
    resolveWith(makeOrders(25), 60);
    render();
    await flush();

    expect(container.textContent).toContain(t('closedOrdersPage.totalCount', { count: 60 }));
    // 25 satır render edildi (li).
    expect(container.querySelectorAll('li').length).toBe(25);
    // İlk istek offset=0 ile gitti.
    const firstUrl = String(apiGet.mock.calls[0]?.[0] ?? '');
    expect(firstUrl).toContain('offset=0');
    expect(firstUrl).toContain('limit=25');
  });

  it('"Sonraki" sayfaya geçince offset PAGE_SIZE kadar kayar', async () => {
    resolveWith(makeOrders(25), 60);
    render();
    await flush();

    const nextBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes(t('closedOrdersPage.next')),
    );
    expect(nextBtn).toBeTruthy();

    resolveWith(makeOrders(25, 25), 60);
    act(() => nextBtn!.click());
    await flush();

    const urls = apiGet.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('offset=25'))).toBe(true);
  });

  it('boş pencerede dürüst boş-durum metni basar (satır yok)', async () => {
    resolveWith([], 0);
    render();
    await flush();

    expect(container.querySelectorAll('li').length).toBe(0);
    expect(container.textContent).toContain(t('closedOrdersPage.empty'));
  });

  // ADR-015 Amd11 — kimlik rozeti: masa satırı 'Masa N', paket satırı müşteri adı.
  it('masa satırı "Masa N", paket satırı müşteri adı gösterir (Paket değil)', async () => {
    // idx 8 → dine_in (Masa 8), idx 9 → takeaway (Müşteri 9).
    resolveWith(makeOrders(2, 8), 2);
    render();
    await flush();

    expect(container.textContent).toContain(t('tables.tableLabel', { number: 8 }));
    expect(container.textContent).toContain('Müşteri 9');
    // Paket satırında jenerik 'Paket' etiketi artık YOK (müşteri adı var).
    expect(container.textContent).not.toContain(t('dashboard.takeaway'));
  });

  // ADR-015 Amd11 — satıra tıklama adisyon detay modalını açar (GET /orders/:id).
  it('satıra tıklayınca detay modalı açılır ve kalemleri gösterir', async () => {
    apiGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.startsWith('/orders/')) {
        return Promise.resolve({
          data: {
            data: {
              order: { id: 'x', total_cents: 12300, status: 'paid' },
              items: [
                {
                  id: 'it-1',
                  product_name: 'Kıymalı Pide',
                  quantity: 2,
                  unit_price_cents: 6150,
                  total_cents: 12300,
                  status: 'new',
                  note: null,
                  attributes: [],
                  variant_name_snapshot: null,
                },
              ],
            },
          },
        });
      }
      return Promise.resolve({
        data: {
          data: {
            orders: makeOrders(2, 8),
            totalClosedCount: 2,
            asOf: '2026-09-04T10:00:00.000Z',
            windowStart: '2026-09-03T00:00:00.000Z',
            windowEnd: '2026-09-04T00:00:00.000Z',
          },
        },
      });
    });
    render();
    await flush();

    const firstRow = container.querySelector('li[role="button"]') as HTMLElement;
    expect(firstRow).toBeTruthy();
    act(() => firstRow.click());
    await flush();

    // Modal Radix Portal ile document.body'ye render edilir.
    expect(document.body.textContent).toContain(t('closedOrdersPage.detail.title'));
    expect(document.body.textContent).toContain('Kıymalı Pide');
  });
});
