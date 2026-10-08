/**
 * S8 — Çıkış (logout) refresh token'ı SUNUCUDA revoke eder (ADR-002 Amd6).
 *
 * 🔴 NEDEN BU SPEC VAR — supertest bu bug'ı YAPISAL OLARAK göremez.
 *
 * S137'de prod'da canlı bir bug bulundu: `/auth/logout` refresh token'ı hiç
 * revoke etmiyordu. Kök neden cookie `Path`'inin tam olarak `/api/auth/refresh`'e
 * kilitli olmasıydı → tarayıcı `/api/auth/logout`'a cookie GÖNDERMİYOR → sunucu
 * revoke'u atlıyor, 200 dönüyor. Çıkıştan sonra token 30 gün geçerli kalıyordu.
 *
 * `apps/api/src/__tests__/auth.test.ts` içinde TAM BU RİSKİ hedefleyen bir
 * güvenlik testi vardı ve **bug varken de geçiyordu**: supertest `.set('Cookie')`
 * ile cookie'yi elle koyar, yani tarayıcının path-eşleştirmesini BYPASS eder.
 * Ampirik olarak doğrulandı (S137 negatif kontrolü): path eski hâline alındığında
 * o üç API testi yeşil kalıyor, yalnız bu katman kırmızıya düşer.
 * → Bu bug'ı yakalayabilen TEK katman gerçek tarayıcıdır.
 *
 * ⚠️ "Çıkıştan sonra tarayıcıda cookie yok" assertion'ı TEK BAŞINA YETERSİZDİR:
 * bug varken de cookie siliniyordu (`clearRefreshCookie` çalışıyordu). Kanıt
 * SUNUCU tarafında olmalı → token'ı yakalayıp çıkıştan sonra `/auth/refresh`'e
 * REPLAY ediyoruz ve 401 bekliyoruz.
 *
 * Pozitif kontrol: hiç çıkış yapılmamış ikinci bir token replay edilir ve 200
 * beklenir. Olmasa 401 "replay mekanizması bozuk" yüzünden de gelebilirdi ve
 * test yanlış sebeple geçerdi.
 */

import { test, expect, type APIResponse } from '@playwright/test';

import { clickButtonByAriaLabel, loginViaUI } from '../helpers/auth-login';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/test-data';

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Yanıttaki `Set-Cookie` başlıklarından refresh token'ın DEĞERİNİ çıkarır.
 *
 * ⚠️ Amd6 geçişi yüzünden yanıtta İKİ `refresh_token=` başlığı var (gerçek
 * cookie + eski path için `Max-Age=0` silme). Değeri BOŞ OLMAYANI seç.
 */
function extractRefreshToken(res: APIResponse): string | undefined {
  for (const h of res.headersArray()) {
    if (h.name.toLowerCase() !== 'set-cookie') continue;
    for (const line of h.value.split('\n')) {
      const m = /^refresh_token=([^;]+)/.exec(line.trim());
      if (m !== null && m[1] !== undefined && m[1].length > 0) {
        return m[1];
      }
    }
  }
  return undefined;
}

test.describe('S8 — Çıkış refresh token revoke', () => {
  test('UI çıkışı token’ı SUNUCUDA geçersiz kılar (+ cookie path /api/auth)', async ({
    page,
    context,
    playwright,
    baseURL,
  }) => {
    // ---- POZİTİF KONTROL: hiç çıkış yapılmayacak bir token üret -------------
    const controlCtx = await playwright.request.newContext({ baseURL });
    const controlLogin = await controlCtx.post('/api/auth/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(controlLogin.status()).toBe(200);
    const controlToken = extractRefreshToken(controlLogin);
    expect(controlToken, 'kontrol token’ı Set-Cookie’den okunamadı').toBeTruthy();

    // ---- ASIL AKIŞ: UI’dan giriş -------------------------------------------
    await loginViaUI(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const cookiesBefore = await context.cookies();
    const refreshCookie = cookiesBefore.find((c) => c.name === 'refresh_token');
    expect(refreshCookie, 'girişten sonra refresh cookie yok').toBeDefined();

    // 🔴 Bug’ın kalbi. `toContain` DEĞİL tam eşitlik: `/api/auth/refresh`
    // değeri de `/api/auth`’u içerir ve gerilemeyi gizlerdi.
    expect(refreshCookie?.path).toBe('/api/auth');

    const subjectToken = refreshCookie?.value ?? '';
    expect(subjectToken.length).toBeGreaterThan(0);

    // ---- UI’dan çıkış ------------------------------------------------------
    // ⚠️ Çıkış düğmesi Sidebar’ın İÇİNDE; Sidebar kapalıyken DOM’da HİÇ YOKTUR.
    // Açık/kapalı durumu `useSidebarStore`’dan gelir ve storageState ile
    // değişebilir → "hep açık" ya da "hep kapalı" VARSAYMA, duruma göre davran.
    //
    // ⚠️ Menü düğmesini aria-label ile ARAMA: etiketi duruma göre değişiyor
    // (`AppShell.tsx:52` → `sidebarOpen ? toggleClose : toggleOpen`), sabit
    // etiket bekleyen bir arama sessizce kırılır. `aria-expanded` değişmez.
    const logoutBtn = page.getByRole('button', { name: 'Çıkış' });
    if (!(await logoutBtn.isVisible().catch(() => false))) {
      await page
        .locator('button[aria-expanded]')
        .first()
        .click({ force: true });
    }
    // Auto-wait: giriş sonrası Sidebar hydrate olurken yarış var; senkron bir
    // DOM sorgusu düğme render edilmeden koşabilir (ilk koşumda yaşandı).
    await expect(logoutBtn).toBeVisible({ timeout: 10_000 });

    // ⚠️ Playwright’ın kendi `.click()`’i BURADA ÇALIŞMAZ: düğme Sidebar’ın
    // alt kısmında, görünür alanın DIŞINDA → "Element is outside of the
    // viewport" (`force: true` bile kurtarmaz; force actionability’yi atlar,
    // viewport sınırını atlamaz). In-page native click viewport’tan bağımsız
    // çalışır (feedback_e2e_scope_aware_native_click).
    await clickButtonByAriaLabel(page, 'Çıkış');
    await page.waitForURL(/\/login$/, { timeout: 10_000 });

    // Gerekli ama YETERSİZ: bug varken de cookie siliniyordu.
    const cookiesAfter = await context.cookies();
    const survivor = cookiesAfter.find(
      (c) => c.name === 'refresh_token' && c.value.length > 0,
    );
    expect(survivor, 'çıkıştan sonra tarayıcıda refresh cookie kalmış').toBeUndefined();

    // ---- ⭐ KARAR VERİCİ: sunucu da token’ı reddediyor mu? -----------------
    const replay = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: {
        // CSRF-lite: /auth/refresh bu header’ı zorunlu kılar (yoksa 403 gelir
        // ve 401 beklentisi YANLIŞ SEBEPLE kırılırdı).
        'X-Refresh-Request': '1',
        Cookie: `refresh_token=${subjectToken}`,
      },
    });
    const afterLogout = await replay.post('/api/auth/refresh');
    expect(
      afterLogout.status(),
      'çıkış token’ı revoke ETMEDİ — sunucu hâlâ kabul ediyor (S137 bug’ı geri geldi)',
    ).toBe(401);

    // Pozitif kontrol: replay mekanizması gerçekten çalışıyor mu?
    const controlReplay = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: {
        'X-Refresh-Request': '1',
        Cookie: `refresh_token=${controlToken ?? ''}`,
      },
    });
    const controlRes = await controlReplay.post('/api/auth/refresh');
    expect(
      controlRes.status(),
      'kontrol token’ı da reddedildi → 401 revoke’tan değil replay’in bozukluğundan geliyor',
    ).toBe(200);

    await controlCtx.dispose();
    await replay.dispose();
    await controlReplay.dispose();
  });
});
