/**
 * @vitest-environment jsdom
 *
 * ADR-038 DoD 21 — `CustomerOrderHistory` davranış testleri.
 *
 * Doğrulanan sözleşme:
 *   - Boş durum DÜRÜSTtür: gerçek Türkçe metin basılır, sahte iskelet satır yok (K7.4)
 *   - Uç hata verirse bölüm SATIR-İÇİ hata gösterir ve **throw ETMEZ** →
 *     çağıran sipariş akışı çalışmaya devam eder (K7.5). Bu testin asıl amacı
 *     budur: geçmiş bir kolaylıktır, sipariş almayı durdurma yetkisi yoktur.
 *   - `enabled=false` iken ağ isteği HİÇ yapılmaz (kapalı drawer yük üretmez)
 *   - Dolu liste tutarı kuruştan TL'ye çevirip iptal satırını işaretler (K7.3)
 *
 * Metinler `tr.json`'dan GERÇEK anahtarlarla okunur (hardcoded string yok);
 * anahtar silinirse/yeniden adlandırılırsa bu testler kırılır.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
vi.mock('../../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args) as unknown,
  },
}));

const i18n = (await import('../../../i18n/init')).default;
const { CustomerOrderHistory } = await import('./CustomerOrderHistory');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function renderHistory(props: {
  customerId: string | null;
  enabled?: boolean;
}): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <CustomerOrderHistory {...props} />
      </QueryClientProvider>,
    );
  });
}

/**
 * Pending query'lerin çözülmesi için görev kuyruğunu boşaltır. TanStack Query
 * fetch → state → re-render zincirini birkaç tur döndürmek gerekir; tek tur
 * yetmez (hata yolunda retry=false olsa bile ek bir tur gerekiyor).
 */
async function flush(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const t = (key: string): string => i18n.t(key);

beforeEach(() => {
  apiGet.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('CustomerOrderHistory (ADR-038)', () => {
  it('boş liste → dürüst boş durum metni, iskelet satır YOK', async () => {
    apiGet.mockResolvedValue({ data: { data: { items: [], nextCursor: null } } });

    renderHistory({ customerId: 'c-1' });
    await flush();

    expect(container.textContent).toContain(t('customers.orderHistory.empty'));
    expect(
      container.querySelectorAll('[data-testid="customer-order-history-row"]'),
    ).toHaveLength(0);
  });

  it('uç hata verirse SATIR-İÇİ hata gösterir ve throw ETMEZ (akış bloke olmaz)', async () => {
    apiGet.mockRejectedValue(new Error('network down'));

    // Render + çözülme throw etmemeli: sipariş akışı ayakta kalır.
    expect(() => {
      renderHistory({ customerId: 'c-1' });
    }).not.toThrow();
    await flush();

    expect(container.textContent).toContain(
      t('customers.orderHistory.loadFailed'),
    );
    // Kullanıcı çıkmaza düşmez: tekrar deneme sunulur.
    expect(container.textContent).toContain(t('customers.orderHistory.retry'));
  });

  it('enabled=false → ağ isteği HİÇ yapılmaz', async () => {
    renderHistory({ customerId: 'c-1', enabled: false });
    await flush();

    expect(apiGet).not.toHaveBeenCalled();
  });

  it('customerId null → ağ isteği HİÇ yapılmaz', async () => {
    renderHistory({ customerId: null });
    await flush();

    expect(apiGet).not.toHaveBeenCalled();
  });

  it('dolu liste: tutar TL olarak basılır, iptal satırı işaretlenir', async () => {
    apiGet.mockResolvedValue({
      data: {
        data: {
          items: [
            {
              id: 'o-1',
              orderNo: 42,
              createdAt: '2026-08-12T16:45:00.000Z',
              storeDate: '2026-08-12',
              orderType: 'takeaway',
              status: 'paid',
              takeawayStage: 'delivered',
              totalCents: 12345,
              itemCount: 2,
              itemsPreview: ['Kıymalı Pide', 'Ayran'],
            },
            {
              id: 'o-2',
              orderNo: 43,
              createdAt: '2026-08-11T16:45:00.000Z',
              storeDate: '2026-08-11',
              orderType: 'dine_in',
              status: 'cancelled',
              takeawayStage: null,
              totalCents: 5000,
              itemCount: 1,
              itemsPreview: ['Kunefe'],
            },
          ],
          nextCursor: null,
        },
      },
    });

    renderHistory({ customerId: 'c-1' });
    await flush();

    const rows = container.querySelectorAll(
      '[data-testid="customer-order-history-row"]',
    );
    expect(rows).toHaveLength(2);

    // Kuruş → TL gösterimi (integer kuruş korunur, float aritmetiği yok).
    expect(container.textContent).toContain('123,45');
    expect(container.textContent).toContain('Kıymalı Pide, Ayran');

    // İptal satırı: rozet + üstü çizili tutar.
    expect(container.textContent).toContain(
      t('customers.orderHistory.cancelledBadge'),
    );
    expect(rows[1]!.querySelector('.line-through')).not.toBeNull();

    // Tip rozetleri mevcut i18n anahtarlarından gelir.
    expect(container.textContent).toContain(
      t('customers.orderHistory.type.takeaway'),
    );
    expect(container.textContent).toContain(
      t('customers.orderHistory.type.dine_in'),
    );
  });

  it('nextCursor null → "Daha Fazla" butonu gösterilmez', async () => {
    apiGet.mockResolvedValue({
      data: {
        data: {
          items: [
            {
              id: 'o-1',
              orderNo: 1,
              createdAt: '2026-08-12T16:45:00.000Z',
              storeDate: '2026-08-12',
              orderType: 'takeaway',
              status: 'paid',
              takeawayStage: 'delivered',
              totalCents: 1000,
              itemCount: 1,
              itemsPreview: ['Ayran'],
            },
          ],
          nextCursor: null,
        },
      },
    });

    renderHistory({ customerId: 'c-1' });
    await flush();

    expect(container.textContent).not.toContain(
      t('customers.orderHistory.loadMore'),
    );
  });
});
