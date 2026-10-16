/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRefreshFeedback } from './useRefreshFeedback';

/**
 * `useRefreshFeedback` davranış testi.
 *
 * Kilitlenen şey şu: tazeleme ANINDA bitse bile bayrak bir süre açık kalmalı.
 * Bu testin var olma sebebi ürün sahibinin 2026-10-16 gözlemi — "Yenile"
 * gerçekten refetch tetikliyordu (prod erişim log'uyla ölçüldü) ama istek
 * ~100 ms'de bittiği için spinner göze görünmeden kayboluyordu. Bayrağın
 * hemen kapandığı bir uygulama bu testi GEÇMEZ.
 *
 * Mevcut web test deseni: `react-dom/client createRoot` + `act` (jsdom),
 * @testing-library/react YOK — useOrderCart.test.tsx ile aynı.
 *
 * Sahte zamanlayıcı kullanılıyor: gerçek `setTimeout` ile 450 ms'lik tabanı
 * ölçmek yavaş CI makinesinde kırılgan olurdu (bekleme beklenenden uzun
 * sürerse "hâlâ açık" iddiası yanlış sebeple kırmızı verir).
 */

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useRefreshFeedback> | undefined;

function Probe({ run }: { run: () => void | Promise<unknown> }): null {
  latest = useRefreshFeedback(run);
  return null;
}

function render(run: () => void | Promise<unknown>): void {
  act(() => {
    root.render(<Probe run={run} />);
  });
}

/** Bekleyen promise'leri ve zamanlayıcıları `ms` kadar ilerletir. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  latest = undefined;
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
  vi.useRealTimers();
});

describe('useRefreshFeedback', () => {
  it('başlangıçta kapalı', () => {
    render(() => undefined);
    expect(latest?.isRefreshing).toBe(false);
  });

  it('anında biten tazelemede bile taban süre boyunca AÇIK kalır', async () => {
    const run = vi.fn(() => undefined);
    render(run);

    act(() => {
      latest?.refresh();
    });
    expect(latest?.isRefreshing).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    // `run` senkron bitti; mikro-görevler boşalsa da bayrak kapanmamalı.
    await advance(0);
    expect(latest?.isRefreshing).toBe(true);

    // Taban (450 ms) henüz dolmadı.
    await advance(300);
    expect(latest?.isRefreshing).toBe(true);

    // 500 ms toplamda → taban doldu.
    await advance(200);
    expect(latest?.isRefreshing).toBe(false);
  });

  it('tazeleme tabandan UZUN sürerse bitişini bekler, üstüne taban EKLEMEZ', async () => {
    let settle: (() => void) | undefined;
    const run = (): Promise<void> =>
      new Promise<void>((resolve) => {
        settle = resolve;
      });
    render(run);

    act(() => {
      latest?.refresh();
    });

    // Taban çoktan geçti ama istek hâlâ sürüyor → spinner dönmeye devam eder.
    await advance(1_000);
    expect(latest?.isRefreshing).toBe(true);

    // İstek bitince EK bekleme yok: dönüş zaten 1 sn boyunca göze görünmüştü.
    // Taban bir asgari görünürlük garantisidir, her tazelemeye eklenen sabit
    // bir gecikme değil — yoksa yavaş ağda düğme gereksiz yere kilitli kalırdı.
    await act(async () => {
      settle?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(latest?.isRefreshing).toBe(false);
  });

  /**
   * REGRESYON TESTİ (hci kapısı) — Masalar ekranında düğme `disabled`
   * OLMADIĞI için üst üste basılabiliyor. Eski çağrının zamanlayıcısı
   * temizlenmezse yenisinin tabanı dolmadan ateşlenip dönüşü yarıda keserdi.
   */
  it('üst üste basışta ikinci tazelemenin tabanı yarıda kesilmez', async () => {
    render(() => undefined);

    act(() => {
      latest?.refresh();
    });
    await advance(300); // ilk çağrının tabanına 150 ms kaldı
    act(() => {
      latest?.refresh();
    });

    // İlk çağrının zamanlayıcısı bu anda ateşlenirdi; bayrak AÇIK kalmalı.
    await advance(200);
    expect(latest?.isRefreshing).toBe(true);

    // İkinci çağrının kendi tabanı dolunca kapanır.
    await advance(300);
    expect(latest?.isRefreshing).toBe(false);
  });

  /**
   * REGRESYON TESTİ (hci kapısı) — ağ yokken TanStack refetch'i DURAKLATIR ve
   * `invalidateQueries`'in promise'i çözülmez. Tavan olmasaydı düğme süresiz
   * `disabled` kalırdı; yani düzeltme kendi kilit sınıfını doğururdu.
   */
  it('tazeleme hiç çözülmezse emniyet tavanında bayrak kapanır', async () => {
    render(() => new Promise<void>(() => undefined)); // asla çözülmez

    act(() => {
      latest?.refresh();
    });
    await advance(5_000);
    expect(latest?.isRefreshing).toBe(true);

    await advance(5_500); // toplam 10,5 sn → tavan (10 sn) doldu
    expect(latest?.isRefreshing).toBe(false);
  });

  /**
   * REGRESYON TESTİ — uygulama `<StrictMode>` içinde koşuyor (main.tsx).
   *
   * İlk uygulamada hook'ta bir `mountedRef` vardı; StrictMode effect'i
   * mount → cleanup → mount diye iki kez koşturduğu için cleanup bayrağı
   * `false`'a çekiyor, ikinci mount geri `true` yapmıyordu → `isRefreshing`
   * bir daha asla kapanmıyor, Yenile düğmesi KALICI kilitli kalıyordu.
   * Yukarıdaki testler StrictMode'suz render ettiği için yeşil kalmıştı;
   * kusur ancak tarayıcıda canlı doğrulamada görüldü.
   */
  it('StrictMode altında da bayrak kapanır (düğme kilitli kalmaz)', async () => {
    act(() => {
      root.render(
        <StrictMode>
          <Probe run={() => undefined} />
        </StrictMode>,
      );
    });

    act(() => {
      latest?.refresh();
    });
    expect(latest?.isRefreshing).toBe(true);

    await advance(600);
    expect(latest?.isRefreshing).toBe(false);
  });
});
