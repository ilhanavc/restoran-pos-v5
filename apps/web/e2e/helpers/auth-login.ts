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

/**
 * Native HTMLButtonElement.click() — Sidebar `useLiveClock` 1sn re-render
 * ile Playwright `locator.click()` "stable" check'ine takıldığında
 * deterministik tetikler. React synthetic onClick guarantee fire.
 *
 * Sprint 12 öğretisi: `feedback_playwright_spa_navigation`.
 */
export async function clickButtonByText(
  page: Page,
  text: string,
): Promise<void> {
  await page.evaluate((t) => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === t,
    );
    if (btn === undefined) {
      throw new Error(`button with text "${t}" not found`);
    }
    btn.click();
  }, text);
}

/**
 * Native click by aria-label — icon-only button'lar için
 * (e.g. AreaCard'da Pencil/Trash button'ları sadece aria-label'lı).
 */
export async function clickButtonByAriaLabel(
  page: Page,
  label: string,
): Promise<void> {
  await page.evaluate((l) => {
    const btn = Array.from(
      document.querySelectorAll('button[aria-label]'),
    ).find((b) => b.getAttribute('aria-label') === l);
    if (btn === null || btn === undefined) {
      throw new Error(`button with aria-label "${l}" not found`);
    }
    (btn as HTMLButtonElement).click();
  }, label);
}

/**
 * Radix DropdownMenu Trigger açar — pointerdown sequence dispatch eder.
 * Native HTMLElement.click() sadece 'click' event yayar; Radix `onPointerDown`
 * dinler. Sidebar useLiveClock re-render Playwright stability check'ini
 * bozduğu için regular `.click()` 30s timeout. Manuel pointerdown +
 * pointerup + click dispatch deterministik.
 */
export async function openRadixDropdown(
  page: Page,
  triggerSelector: string,
): Promise<void> {
  await page.evaluate((sel) => {
    const btn = document.querySelector(sel);
    if (btn === null) {
      throw new Error(`trigger "${sel}" not found`);
    }
    btn.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    btn.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 0 }),
    );
    (btn as HTMLElement).click();
  }, triggerSelector);
}

/**
 * Native click — DropdownMenu / context menu item'ları (Radix `role="menuitem"`
 * <div>'lerdir, button değil; clickButtonByText match etmez).
 */
export async function clickMenuItemByText(
  page: Page,
  text: string,
): Promise<void> {
  await page.evaluate((t) => {
    const item = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((el) => el.textContent?.trim() === t);
    if (item === undefined) {
      throw new Error(`menuitem with text "${t}" not found`);
    }
    (item as HTMLElement).click();
  }, text);
}

/**
 * Native click — scope-aware. Birden fazla AreaCard / kategoriler /
 * vb. liste içinde aynı text'li button varsa global helper YANLIŞ
 * card'a tıklayabilir (Sprint 9b S2 öğretisi). scopeSelector parent
 * scope'unu sınırlandırır; sadece o scope içindeki button hedeflenir.
 */
export async function clickButtonInScope(
  page: Page,
  scopeSelector: string,
  buttonText: string,
): Promise<void> {
  await page.evaluate(
    ({ scope, text }) => {
      const container = document.querySelector(scope);
      if (container === null) {
        throw new Error(`scope "${scope}" not found`);
      }
      const btn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === text,
      );
      if (btn === undefined) {
        throw new Error(
          `button with text "${text}" not found inside "${scope}"`,
        );
      }
      btn.click();
    },
    { scope: scopeSelector, text: buttonText },
  );
}

/**
 * Native click by aria-label — scope-aware (analog clickButtonInScope).
 */
export async function clickButtonInScopeByAriaLabel(
  page: Page,
  scopeSelector: string,
  label: string,
): Promise<void> {
  await page.evaluate(
    ({ scope, l }) => {
      const container = document.querySelector(scope);
      if (container === null) {
        throw new Error(`scope "${scope}" not found`);
      }
      const btn = Array.from(
        container.querySelectorAll('button[aria-label]'),
      ).find((b) => b.getAttribute('aria-label') === l);
      if (btn === undefined) {
        throw new Error(
          `button with aria-label "${l}" not found inside "${scope}"`,
        );
      }
      (btn as HTMLButtonElement).click();
    },
    { scope: scopeSelector, l: label },
  );
}
