import type { Page } from '@playwright/test';

/**
 * UI login helper — Sprint 9b (ADR-019 Amendment 3, 2026-05-10).
 *
 * Bağlam: Zustand auth store `persist` middleware kullanmıyor (in-memory
 * only, Refresh httpOnly cookie). storageState path'i app'i hidrate
 * ETMIYOR. Her test başında UI login akışından geçer (S1 + S6 pattern).
 *
 * Rate limit (5/15dk/IP) globalSetup'tan kaldırılan storageState build'i
 * ile birlikte aşılmaz; gerekirse `E2E_BYPASS_LOGIN_LIMIT='1'` env (CI
 * `e2e.yml` zaten set ediyor).
 */
export async function loginViaUI(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(credentials.email);
  await page.locator('#password').fill(credentials.password);
  await page.getByRole('button', { name: /Giriş Yap/ }).click();
  // LoginPage success → /dashboard.
  await page.waitForURL(/\/dashboard$/, { timeout: 10_000 });
}

/**
 * SPA içi route navigation — Zustand state'i koruyarak.
 *
 * `page.goto()` SPA içi URL bile olsa full HTTP reload yapar → JS context
 * reset → in-memory store kaybolur → ProtectedRoute /login'e atar
 * (Sprint 12 PR-3d öğretisi, `feedback_playwright_spa_navigation`).
 *
 * BrowserRouter `popstate` event'i dinler; pushState + popstate dispatch
 * SPA içi React Router nav'i tetikler.
 */
export async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}
