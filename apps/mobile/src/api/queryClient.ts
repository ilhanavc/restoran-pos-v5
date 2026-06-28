import { QueryClient } from '@tanstack/react-query';

/**
 * Single app-wide TanStack Query client (ADR-026 K4).
 *
 * Server state (tables, areas, and — in later PRs — menu/orders) is owned by
 * TanStack Query, matching the web app (ADR-011). Module-level so there is
 * exactly one cache for the app's lifetime; `App.tsx` wires it into a
 * `QueryClientProvider`. Defaults are conservative for a hand-held POS: one
 * retry (a waiter on flaky restaurant Wi-Fi should see an error fast rather
 * than spin), and pull-to-refresh drives explicit refetches.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
