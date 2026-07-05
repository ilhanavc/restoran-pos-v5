import { NativeModules } from 'react-native';

/**
 * Mobile app runtime configuration (ADR-026 K8 + Amendment 2026-06-29 PR-5d B;
 * production URL wiring ADR-031 K9).
 *
 * `USE_MOCK = false` → the real `fetch` transport runs against the cloud API.
 * Flip back to `true` to demo the full UI offline (no backend). The mobile
 * waiter app is Turkish-only, single-tenant for MVP (CLAUDE.md scope lock).
 */
export const USE_MOCK = false;

/** Cloud API port — backend default `process.env.PORT ?? 3001` (dev, root-mounted). */
const API_PORT = 3001;

/**
 * Production endpoints (ADR-031 K1/K2 — single Hetzner box behind Nginx).
 *
 * REST and Socket.IO diverge in prod and CANNOT share one base URL:
 *  - REST sits behind the Nginx `/api` location, which STRIPS the prefix before
 *    proxying to the root-mounted Express app → the REST base carries `/api`
 *    (`${API_BASE_URL}/orders` → `https://restoranpos.org/api/orders` → `/orders`).
 *  - Socket.IO handshakes at the host root (default `/socket.io` path, served by
 *    the Nginx WebSocket-upgrade block) → the socket base must NOT carry `/api`;
 *    the `/realtime` namespace is appended by the caller (realtime/socket.ts).
 *
 * In dev both collapse to the same `http://<host>:<port>` (Express root-mounted,
 * Socket.IO default path), so the split is invisible until a production build.
 */
const PROD_API_BASE_URL = 'https://restoranpos.org/api';
const PROD_SOCKET_BASE_URL = 'https://restoranpos.org';

/**
 * DEV-ONLY explicit API host (each developer sets their own dev-PC LAN IP, e.g.
 * `'http://192.168.1.88:3001'`). Use it when the Metro auto-derive (below)
 * doesn't yield a device-reachable host; set `null` to rely on auto-derive.
 * Ignored entirely in production builds — see `resolveApiBaseUrl`.
 */
const API_BASE_URL_OVERRIDE: string | null = 'http://192.168.1.88:3001';

/**
 * Dev-time `http://<host>:<port>` reachable from the phone. Reused verbatim for
 * both REST (root-mounted) and Socket.IO (default path) in dev.
 *
 * In LAN dev the phone reaches Metro at the host PC's LAN IP, and the API runs
 * on that same PC at {@link API_PORT}. React Native exposes the Metro bundle URL
 * via `NativeModules.SourceCode.scriptURL` (e.g.
 * `http://192.168.1.88:8081/index.bundle?...`), so we reuse its host and swap in
 * the API port. This means the LAN IP never has to be hardcoded — it follows
 * whatever address Metro is serving from, surviving DHCP reassignment.
 * `localhost` is the last-resort fallback (works on a simulator, not a phone).
 */
function resolveDevHostBase(): string {
  if (API_BASE_URL_OVERRIDE !== null) {
    return API_BASE_URL_OVERRIDE;
  }
  const sourceCode = NativeModules.SourceCode as { scriptURL?: string } | undefined;
  const scriptURL = sourceCode?.scriptURL ?? null;
  if (scriptURL !== null) {
    const match = /^https?:\/\/([^:/]+)/.exec(scriptURL);
    const host = match?.[1];
    if (host !== undefined && host.length > 0) {
      return `http://${host}:${API_PORT}`;
    }
  }
  return `http://localhost:${API_PORT}`;
}

/**
 * Resolve the REST API base URL (paths are appended directly by the transport,
 * e.g. `${API_BASE_URL}/orders`). A production build (`__DEV__` is false) uses
 * the HTTPS prod endpoint and NEVER the dev cleartext LAN/localhost host — the
 * dev override is confined behind the `__DEV__` guard (security PR-5d review).
 */
function resolveApiBaseUrl(): string {
  return __DEV__ ? resolveDevHostBase() : PROD_API_BASE_URL;
}

/**
 * Resolve the Socket.IO base URL (the `/realtime` namespace is appended by
 * realtime/socket.ts; Socket.IO's default `/socket.io` path is kept). Same
 * dev/prod split as {@link resolveApiBaseUrl} but with NO `/api` prefix in
 * prod — see the PROD_* constants above for why REST and socket diverge.
 */
function resolveSocketBaseUrl(): string {
  return __DEV__ ? resolveDevHostBase() : PROD_SOCKET_BASE_URL;
}

export const API_BASE_URL = resolveApiBaseUrl();
export const SOCKET_BASE_URL = resolveSocketBaseUrl();
