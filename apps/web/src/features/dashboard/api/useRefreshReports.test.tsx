/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRefreshReports } from './reports';

/**
 * `useRefreshReports` — Yenile düğmesinin HANGİ query'leri invalidate ettiği.
 *
 * Bu test bir gerçek kusuru kilitler (2026-10-16): Panel'in "Açık hesap"
 * KPI'sı masa projeksiyonundan beslenir ama anahtarı `['tables']`, yani
 * `['reports']` DEĞİL → Yenile'ye basmak o kartı tazelemiyordu. Prod erişim
 * log'unda ölçüldü: Yenile turlarında (12:24:58, 12:25:02) `/api/reports/*`
 * gitti, `/api/tables` gitmedi.
 *
 * Düzeltme öncesi kod bu testi GEÇMEZ — `['tables']` çağrısı hiç yapılmıyordu.
 */

// `reports.ts` → `lib/api` (axios instance) import ediyor; bu test ağ
// katmanına hiç dokunmadığı için modül mock'lanıyor. Aynı mock `tables/api`
// için de geçerli (ikisi de aynı modülü çözer).
vi.mock('../../../lib/api', () => ({ api: { get: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;
let refresh: (() => Promise<unknown>) | undefined;

function Probe(): null {
  refresh = useRefreshReports();
  return null;
}

beforeEach(() => {
  refresh = undefined;
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

describe('useRefreshReports', () => {
  it('HEM rapor query’lerini HEM masa projeksiyonunu invalidate eder', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await refresh?.();
    });

    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([['reports'], ['tables']]),
    );
  });

  it('refetch bitişini bildiren bir Promise döner (düğme spinner’ı buna bağlı)', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });

    const returned = refresh?.();
    expect(returned).toBeInstanceOf(Promise);
    return returned;
  });
});
