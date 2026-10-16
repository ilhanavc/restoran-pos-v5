import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Elle tetiklenen tazelemenin GÖRÜNÜR olması için bayrak (Nielsen #1).
 *
 * Sorun (2026-10-16 — ürün sahibi gözlemi, prod erişim log'uyla ÖLÇÜLDÜ):
 * "Yenile"ye basmak gerçekten refetch tetikliyordu — Panel'de yedi rapor ucu
 * dört tur koştu (12:24:57 ilk yükleme + üç tıklama), Masalar'da `/tables` ve
 * `/areas` yeniden istendi — ama ekranda hiçbir şey değişmiyordu. İki sebep:
 *
 *   1. Yanıt `304 Not Modified` ya da birebir aynı veri → render değişmez.
 *   2. İstek ~100 ms'de bittiği için spinner göze görünmeden kaybolur.
 *
 * Bu hook ikinciyi çözer: bayrak en az `MIN_VISIBLE_MS` açık kalır. Veri
 * GECİKTİRİLMEZ — geldiği an ekrana basılır; uzayan tek şey spinner'ın
 * görünürlüğü. Birinci sebep için çağıran taraf "son güncelleme" saatini
 * gerçek veri zamanına bağlar.
 */
const MIN_VISIBLE_MS = 450;

/**
 * Emniyet tavanı. `invalidateQueries`'in promise'i aktif refetch'leri bekler;
 * TanStack varsayılan `networkMode: 'online'` ile ağ yokken refetch
 * **duraklatılır** ve o promise çözülmez. Tavan olmasaydı restoran Wi-Fi'ı
 * koptuğunda Panel'deki düğme süresiz `disabled` kalır, kullanıcı "dondu"
 * sanardı — yani düzeltmenin kendisi yeni bir kilit sınıfı doğururdu.
 */
const MAX_VISIBLE_MS = 10_000;

export function useRefreshFeedback(run: () => void | Promise<unknown>): {
  isRefreshing: boolean;
  refresh: () => void;
} {
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * `run` her render'da yeni kimlik alır (invalidateQueries sarmalayıcıları
   * closure döndürür). Ref'te tutulunca `refresh` kimliği sabit kalır ve
   * düğme gereksiz yere yeniden bağlanmaz.
   */
  const runRef = useRef(run);
  runRef.current = run;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  /**
   * Yalnız bekleyen zamanlayıcıyı temizler.
   *
   * ⚠️ Burada "mounted" bayrağı TUTULMAZ. İlk hâlinde bir `mountedRef` vardı ve
   * `<StrictMode>` (main.tsx) geliştirmede effect'i mount → cleanup → mount
   * diye iki kez koşturduğu için cleanup bayrağı `false`'a çekiyor, ikinci
   * mount onu geri `true` yapmıyordu → bayrak bir daha ASLA kapanmıyor,
   * düğme kalıcı olarak kilitli kalıyordu. Canlı doğrulamada yakalandı;
   * birim test StrictMode'suz koştuğu için yeşil kalmıştı.
   *
   * Unmount'tan sonra `setIsRefreshing` çağrılması React 18'de sessiz bir
   * no-op'tur, yani bayrağa gerek yok.
   */
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  /**
   * Tazeleme kuşağı. Üst üste basılabilen bir düğmede (Masalar'da `disabled`
   * YOK) eski bir çağrının geciken zamanlayıcısı, yenisinin tabanı dolmadan
   * bayrağı kapatıp dönüşü yarıda keserdi. Kuşak numarası eşleşmeyen her
   * geri çağrı sessizce düşer.
   */
  const generationRef = useRef(0);

  const refresh = useCallback(() => {
    const generation = ++generationRef.current;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsRefreshing(true);
    const startedAt = Date.now();

    const stop = (): void => {
      if (generation === generationRef.current) setIsRefreshing(false);
    };

    // Önce emniyet tavanı kurulur; tazeleme çözülürse aşağıda iptal edilir.
    timeoutRef.current = setTimeout(stop, MAX_VISIBLE_MS);

    void Promise.resolve(runRef.current())
      // `run` reddederse `.finally` yeniden fırlatır ve unhandled rejection
      // doğardı. Hata burada yutulur: bu hook bir GERİ BİLDİRİM aracıdır,
      // hata gösterimi çağıranın işi.
      .catch(() => undefined)
      .finally(() => {
        if (generation !== generationRef.current) return;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        const remaining = MIN_VISIBLE_MS - (Date.now() - startedAt);
        timeoutRef.current = setTimeout(stop, Math.max(0, remaining));
      });
  }, []);

  return { isRefreshing, refresh };
}
