import { NativeModules } from 'react-native';

/**
 * Mobile app runtime configuration (ADR-026 K8 + Amendment 2026-06-29 PR-5d B).
 *
 * `USE_MOCK = false` → the real `fetch` transport runs against the cloud API.
 * Flip back to `true` to demo the full UI offline (no backend). The mobile
 * waiter app is Turkish-only, single-tenant for MVP (CLAUDE.md scope lock).
 */
export const USE_MOCK = false;

/** Cloud API port — backend default `process.env.PORT ?? 3001`. */
const API_PORT = 3001;

/**
 * DEV-ONLY explicit API host (each developer sets their own dev-PC LAN IP, e.g.
 * `'http://192.168.1.88:3001'`). Use it when the Metro auto-derive (below)
 * doesn't yield a device-reachable host; set `null` to rely on auto-derive.
 * Ignored entirely in production builds — see `resolveApiBaseUrl`.
 */
const API_BASE_URL_OVERRIDE: string | null = 'http://192.168.1.88:3001';

/**
 * Resolve the cloud API base URL.
 *
 * In LAN dev the phone reaches Metro at the host PC's LAN IP, and the API runs
 * on that same PC at {@link API_PORT}. React Native exposes the Metro bundle URL
 * via `NativeModules.SourceCode.scriptURL` (e.g.
 * `http://192.168.1.88:8081/index.bundle?...`), so we reuse its host and swap in
 * the API port. This means the LAN IP never has to be hardcoded — it follows
 * whatever address Metro is serving from, surviving DHCP reassignment.
 * `localhost` is the last-resort fallback (works on a simulator, not a phone).
 */
function resolveApiBaseUrl(): string {
  // The LAN override is DEV-ONLY. In a production build (`__DEV__` is false) it
  // is ignored — the prod API base URL (HTTPS) is wired at Phase-5 deploy time,
  // never this hardcoded cleartext LAN IP (security PR-5d review).
  if (__DEV__ && API_BASE_URL_OVERRIDE !== null) {
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

export const API_BASE_URL = resolveApiBaseUrl();
