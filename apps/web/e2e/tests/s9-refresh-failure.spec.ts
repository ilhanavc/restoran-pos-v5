/**
 * S9 — Refresh başarısızlığı: ağ hatası oturumu DÜŞÜRMEZ, 401 düşürür.
 * ADR-002 §13 (Amendment 7).
 *
 * 🔴 NEDEN BU KATMAN — karar `apps/web/src/lib/api.ts` interceptor'ında
 * veriliyor ve o dosyanın unit testi YOK (axios mock bağımlılığı da yok).
 * Saf karar fonksiyonu `packages/shared-domain/src/auth/refresh-failure.ts`
 * içinde 17 testle sınanıyor, ama **fonksiyonun doğru yere bağlandığını**
 * yalnız gerçek tarayıcı kanıtlar. S137'de öğrenildi: transport katmanını
 * atlayan test, o katmandaki bug'ı yapısal olarak göremez.
 *
 * Senaryo deterministik kuruluyor: önce gerçek giriş yapılır, sonra
 * `page.route()` ile (a) ilk veri isteği 401 döndürülerek refresh yolu
 * tetiklenir, (b) `/auth/refresh` ya **abort** edilir (ağ hatası taklidi) ya
 * da **401** ile yanıtlanır.
 */

import { test, expect, type Route } from '@playwright/test';

import { loginViaUI, spaNavigate } from '../helpers/auth-login';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../helpers/test-data';

test.use({ storageState: { cookies: [], origins: [] } });

const BANNER = '[data-testid="session-ended-banner"]';

/**
 * `/api/**` üzerinde tek bir yönlendirici kurar.
 *
 * - `/api/auth/refresh` → `refreshBehaviour` (test başına değişen kısım)
 * - diğer `/api/auth/*` → dokunulmaz (giriş akışı bozulmasın)
 * - ilk veri isteği → **401** (refresh yolunu tetikler), sonrakiler serbest
 *
 * ⚠️ Yalnız test İÇİNDE kurulur. `auth.setup.ts` storageState'i global
 * kurduğu için bu kuralları setup'a taşımak tüm oturum kurulumunu kırar.
 */
async function routeApi(
  page: import('@playwright/test').Page,
  refreshBehaviour: (route: Route) => Promise<void>,
): Promise<void> {
  let forcedOnce = false;
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/auth/refresh')) {
      await refreshBehaviour(route);
      return;
    }
    if (url.includes('/api/auth/')) {
      await route.continue();
      return;
    }
    if (!forcedOnce) {
      forcedOnce = true;
      // Access token'ı "süresi geçmiş" gibi göster → istemci refresh dener.
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'AUTH_TOKEN_EXPIRED' } }),
      });
      return;
    }
    await route.continue();
  });
}

test.describe('S9 — Refresh başarısızlığı', () => {
  test('AĞ HATASI → oturum KORUNUR (giriş ekranına atılmaz)', async ({
    page,
  }) => {
    await loginViaUI(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    // Refresh isteği ağ seviyesinde başarısız olsun (fetch reject taklidi).
    await routeApi(page, async (route) => {
      await route.abort('failed');
    });

    // ⚠️ `page.goto` DEĞİL: full reload Zustand'ı sıfırlar ve test kendi
    // kurduğu oturumu kaybeder (feedback_playwright_spa_navigation).
    await spaNavigate(page, '/tables');

    // Yönlendirme olacaksa olması için makul bir pencere bırak.
    await page.waitForTimeout(2000);

    // 🔴 KARAR VERİCİ: oturum ayakta kalmalı.
    expect(
      page.url(),
      'ağ hatası oturumu düşürdü — Amd7 gerilemesi',
    ).not.toMatch(/\/login$/);

    // Ve "oturum sona erdi" denmemeli: oturum sona ERMEDİ.
    await expect(page.locator(BANNER)).toHaveCount(0);
  });

  test('401 → çıkış + giriş ekranında “oturum sona erdi” şeridi', async ({
    page,
  }) => {
    await loginViaUI(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    // Sunucu token'ı açıkça reddediyor → oturum gerçekten bitti.
    await routeApi(page, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'AUTH_REFRESH_INVALID' } }),
      });
    });

    await spaNavigate(page, '/tables');

    await page.waitForURL(/\/login$/, { timeout: 10_000 });

    // Şerit, araya giren yönlendirme(ler)i `sessionStorage` ile aşmalı.
    // ⚠️ `page.evaluate` BURADA KULLANILMAZ: `/login`'de ek bir navigasyon
    // yarışıyor ve evaluate "Execution context was destroyed" ile patlıyor.
    // Locator assertion'ları navigasyona dayanıklıdır (otomatik yeniden dener).
    await expect(page.locator(BANNER)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(BANNER)).toContainText('Oturumunuz sona erdi');
  });

  /**
   * BAYAT bayrak şerit GÖSTERMEZ — zaman kutusunun asıl işi bu.
   *
   * Risk: kullanıcı dün bir oturum düşmesi yaşadı, bugün aynı sekmede
   * `/login`'i açtı → "Oturumunuz sona erdi" yazısını yanlış bağlamda okur.
   *
   * ⚠️ Bu testin ilk hâli "yenilemede kaybolmalı" diyordu ve tasarımı YANLIŞ
   * yere çiviliyordu: bayrak okunduğunda silinirse `/login`'deki ikinci bir
   * mount mesajı hiç göstermez (ampirik olarak yaşandı — navigasyon sayısı
   * deterministik değil). Gerçek gereklilik tek-okuma değil **tazelik**.
   *
   * Giriş gerektirmediği için en kararlı spec bu: 61 sn önceye ait bir bayrak
   * enjekte edilir, şerit görünmemelidir.
   */
  test('BAYAT bayrak (TTL dışı) şerit göstermez', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem(
          'auth.sessionEndedAt',
          String(Date.now() - 61_000),
        );
      } catch {
        // yoksay
      }
    });
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator(BANNER)).toHaveCount(0);
  });

  /**
   * TIMEOUT KANITI — single-flight promise kilitlenmiyor (ADR-002 §13.4).
   *
   * 🔴 Düzeltmenin EN SESSİZ kusuru buydu ve hiçbir denetim raporlamadı:
   * `refreshPromise ??= performRefresh().finally(() => refreshPromise = null)`
   * deseninde `finally` yalnız promise SETTLE olunca koşar. Timeout yoksa
   * takılan bir bağlantıda promise hiç settle olmaz → `refreshPromise` null'a
   * dönmez → sonraki HER 401 aynı ölü promise'i bekler → uygulama sessizce
   * kilitlenir, kullanıcıya hiçbir şey görünmez.
   *
   * Kanıt: refresh yanıtsız bekletilir. Timeout varsa istek sonlanır ve
   * İKİNCİ bir istek YENİ bir refresh denemesi üretir (`refreshHits === 2`).
   * Timeout olmasa ikinci deneme HİÇ olmaz ve sayaç 1'de kalır.
   *
   * ⚠️ Paketin tek YAVAŞ spec'i (~20 sn): web timeout'u 15 sn
   * (`lib/api.ts` `REFRESH_TIMEOUT_MS`) ve kanıt onun DOLMASINI gerektiriyor.
   */
  test('TIMEOUT: takılan refresh single-flight’ı kilitlemez', async ({
    page,
  }) => {
    test.setTimeout(70_000);
    await loginViaUI(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    let refreshHits = 0;
    let forcedOnce = false;
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/auth/refresh')) {
        refreshHits += 1;
        if (refreshHits === 1) {
          // 🔴 İSTEĞİ ASLA SONLANDIRMA — ne fulfill ne abort. İsteği bitiren
          // TEK şey istemcinin kendi timeout'u olmalı.
          //
          // ⚠️ İlk yazımda burada 17 sn bekleyip `route.abort()` çağırıyordum:
          // o hâlde promise'i BENİM abort'um settle ediyordu ve spec, timeout
          // SÖKÜLÜ olduğunda da geçiyordu (negatif kontrolle yakalandı) —
          // yani hiçbir şey ölçmüyordu.
          await new Promise<never>(() => {
            /* bilinçli olarak asla resolve olmaz */
          });
        }
        await route.abort('failed');
        return;
      }
      if (url.includes('/api/auth/')) {
        await route.continue();
        return;
      }
      if (!forcedOnce) {
        forcedOnce = true;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'AUTH_TOKEN_EXPIRED' } }),
        });
        return;
      }
      await route.continue();
    });

    await spaNavigate(page, '/tables');
    // Timeout dolana kadar bekle (15 sn + pay).
    await page.waitForTimeout(18_000);
    expect(refreshHits, 'ilk refresh denemesi hiç yapılmadı').toBe(1);

    // Ağ hatası oturumu düşürmediği için hâlâ uygulamadayız.
    expect(page.url()).not.toMatch(/\/login$/);

    // İkinci tur: yeni bir 401 → YENİ refresh denemesi olmalı.
    forcedOnce = false;
    await spaNavigate(page, '/dashboard');
    await spaNavigate(page, '/tables');
    await expect
      .poll(() => refreshHits, {
        message:
          'ikinci refresh denemesi yapılmadı → refreshPromise ölü promise’te kilitli kalmış (timeout gerilemesi)',
        timeout: 20_000,
      })
      .toBeGreaterThanOrEqual(2);
  });

  /** Pozitif kontrol: TAZE bayrak şeridi GÖSTERİR (yukarıdaki test anlamlı mı). */
  test('TAZE bayrak şeridi gösterir (pozitif kontrol)', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('auth.sessionEndedAt', String(Date.now()));
      } catch {
        // yoksay
      }
    });
    await page.goto('/login');
    await expect(page.locator(BANNER)).toBeVisible();
  });
});
