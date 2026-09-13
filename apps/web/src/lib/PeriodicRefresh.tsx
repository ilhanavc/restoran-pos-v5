import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Sessiz tazeleme aralığı — 15 dakika (ürün-sahibi talebi, S124). */
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Periyodik SESSİZ veri tazeleme (S124, ürün-sahibi talebi).
 *
 * Her 15 dakikada bir TÜM React Query cache'ini invalidate eder → ekranda
 * mount'lu tüm sorgular (masalar, siparişler, mutfak, raporlar...) arka planda
 * sessizce yeniden çekilir. TAM sayfa reload DEĞİL:
 *   - ekran yeniden yüklenmez / titremez, açık modal kaybolmaz;
 *   - yerel state (yarım sipariş sepeti, ödeme taslağı, form girdileri —
 *     bunlar sunucu-verisi değil, React/Zustand state) KAYBOLMAZ.
 * socket.ts'teki "tam reload kasiyerin yarım işini kaybettirir" tuzağından
 * bilinçli kaçınır; MIM-8 reconnect-invalidate ile aynı güvenli desen.
 *
 * App kökünde (AuthBootstrapGate içinde) tek sefer mount → sayaç sayfa
 * navigasyonunda SIFIRLANMAZ (per-ekran mount olsaydı gezinen kullanıcıda
 * hiç ateşlenmezdi). Görünür UI yok (null döner).
 */
export function PeriodicRefresh(): null {
  const queryClient = useQueryClient();

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      // Argümansız invalidate: tüm sorguları bayatlat → mount'lu (aktif)
      // olanlar hemen arka planda yeniden çekilir, inaktifler sonraki
      // kullanımda tazelenir. "Komple ama sessiz" tazelemenin karşılığı.
      void queryClient.invalidateQueries();
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [queryClient]);

  return null;
}
