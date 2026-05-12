import { api } from '../../../lib/api';

/**
 * Trigger a browser download for a CSV blob fetched from the backend.
 *
 * Uses axios `responseType: 'blob'` so the auth interceptor + base URL still
 * apply (vs a raw `<a href>` which would lose the bearer token). The blob URL
 * is revoked in `finally` to avoid leaks even if `link.click()` throws.
 *
 * ADR-021 PR-5d — `?format=csv` query is added by callers, not here, so the
 * helper stays endpoint-agnostic.
 */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const response = await api.get<Blob>(path, { responseType: 'blob' });
  const blob = response.data;
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Local-date YYYY-MM-DD stamp for use as CSV filename suffix. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
