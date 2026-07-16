import { QueryClient } from '@tanstack/react-query';

/**
 * Single app-wide TanStack Query client (ADR-026 K4).
 *
 * Server state (tables, areas, and — in later PRs — menu/orders) is owned by
 * TanStack Query, matching the web app (ADR-011). Module-level so there is
 * exactly one cache for the app's lifetime; `App.tsx` wires it into a
 * `QueryClientProvider`. Defaults are conservative for a hand-held POS: one
 * retry (a waiter on flaky restaurant Wi-Fi should see an error fast rather
 * than spin).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // ADR-026 Amendment 1 K1 — foreground resync must not depend on the
      // socket 'connect' event alone: on AppState 'active' (focusManager,
      // network.ts) stale queries refetch. Menu queries carry a 5-min
      // staleTime, so returning to the foreground does not re-fetch them
      // needlessly. (Was `false` — "pull-to-refresh is enough" superseded.)
      refetchOnWindowFocus: true,
    },
    mutations: {
      // M10-A-02 — `onlineManager` (network.ts) offline'da varsayılan olarak
      // mutation'ı da 'pause' eder. Sipariş-kaydet/ödeme UX'i (offline'da hemen
      // dene → hata + idempotency-key #345 duplikasyonu önler) DEĞİŞMESİN diye
      // 'always': mutation'lar offline'da bile gönderilir. onlineManager yalnız
      // query refetch'ini offline-aware yapar (resync).
      networkMode: 'always',
    },
  },
});
