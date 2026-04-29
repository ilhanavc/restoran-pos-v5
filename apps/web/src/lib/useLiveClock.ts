import { useEffect, useState } from 'react';

/**
 * Canlı saat hook'u — `Europe/Istanbul` (kullanıcı browser TZ; backend
 * tenant_settings.timezone ileride server-driven canlı saat için kullanılacak).
 * Dakika başı güncellenir (saniyeli saat rush-hour'da gereksiz dikkat dağıtıcı).
 *
 * Format örneği: "Çar, 29 Nis · 13:42"
 */
export function useLiveClock(): string {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    // Sonraki dakikanın başında ilk tick, sonra her dakika.
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => setNow(new Date()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const time = new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  const date = new Intl.DateTimeFormat('tr-TR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(now);
  return `${date} · ${time}`;
}
