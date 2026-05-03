/**
 * ADR-015 Karar 2 — "Bugün" tanımı: takvim günü, tenant timezone.
 *
 * Verilen IANA timezone için, verilen anki "şu an" zamanına göre, yerel
 * takvim günü [00:00, 24:00) aralığını UTC bound'larına çevirir.
 *
 * Implementation notu: Node 22 Intl API'si tüm IANA TZ'ları destekler.
 * Üçüncü-parti date kütüphanesi (date-fns-tz, luxon) eklenmedi —
 * minimal dependency (CLAUDE.md stack lock).
 *
 * @example
 *   getCalendarDayWindow('Europe/Istanbul', new Date('2026-05-03T14:00:00Z'))
 *   // { startUtc: 2026-05-02T21:00:00.000Z, endUtc: 2026-05-03T21:00:00.000Z }
 *   // (TR yaz saati UTC+3 → 03 Mayıs 00:00 TR = 02 Mayıs 21:00 UTC)
 */
export interface CalendarDayWindow {
  /** Yerel takvim günü 00:00:00.000 — UTC olarak. */
  startUtc: Date;
  /** Yerel takvim günü 24:00:00.000 (yarınki 00:00) — UTC olarak. */
  endUtc: Date;
}

/**
 * IANA TZ + anki zaman → yerel takvim günü UTC bound'ları.
 *
 * @param timezone IANA TZ (örn. 'Europe/Istanbul'). Geçersizse Intl exception fırlatır;
 *                 caller (route handler) tenant_settings.timezone'u DB trigger ile
 *                 doğruluyor, defansif catch yok.
 * @param now      Hesabın referans aldığı an. Test için inject edilebilir; default `new Date()`.
 */
export function getCalendarDayWindow(
  timezone: string,
  now: Date = new Date(),
): CalendarDayWindow {
  // Intl.DateTimeFormat ile yerel Y/M/D parçalarını çıkar.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string): string => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) {
      throw new Error(`getCalendarDayWindow: missing ${type} part for tz=${timezone}`);
    }
    return part.value;
  };
  const year = Number.parseInt(get('year'), 10);
  const month = Number.parseInt(get('month'), 10);
  const day = Number.parseInt(get('day'), 10);

  // Yerel 00:00 ve ertesi 00:00 → UTC instant.
  const startUtc = localMidnightToUtc(year, month, day, timezone);
  // Sonraki gün için day+1 — month/year overflow JavaScript Date ile otomatik çözülür.
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const endUtc = localMidnightToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timezone,
  );

  return { startUtc, endUtc };
}

/**
 * Yerel (Y, M, D) 00:00:00.000 zamanını verilen IANA TZ'da UTC instant'ına çevirir.
 *
 * Algoritma: önce `Date.UTC` ile bir tahmin oluştur, sonra TZ offset'ini
 * Intl ile ölç, offset kadar geri it; gerekirse 1 iterasyon daha (DST sınırı).
 */
function localMidnightToUtc(
  year: number,
  month: number,
  day: number,
  timezone: string,
): Date {
  // İlk tahmin: bu zamanı UTC olarak oku.
  let utcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  // TZ offset (ms): bu UTC anının yerel saatte ne göründüğüne bak.
  const offsetMs = timezoneOffsetMs(timezone, new Date(utcMs));
  utcMs -= offsetMs;
  // DST geçişlerinde küçük iterasyonla düzelt.
  const offsetMs2 = timezoneOffsetMs(timezone, new Date(utcMs));
  if (offsetMs2 !== offsetMs) {
    utcMs += offsetMs - offsetMs2;
  }
  return new Date(utcMs);
}

/**
 * Verilen UTC instant'ında TZ'nin UTC'den ofseti (ms). Pozitif: TZ UTC'den ileri (örn. TR=+03:00 → +10800000).
 */
function timezoneOffsetMs(timezone: string, atUtc: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(atUtc);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type === 'literal') continue;
    map[p.type] = Number.parseInt(p.value, 10);
  }
  // Intl bazen hour=24 üretir (TR'de gece yarısı sınırı) — 0'a normalize et.
  const hour = (map['hour'] ?? 0) % 24;
  const asUtc = Date.UTC(
    map['year'] ?? 1970,
    (map['month'] ?? 1) - 1,
    map['day'] ?? 1,
    hour,
    map['minute'] ?? 0,
    map['second'] ?? 0,
  );
  return asUtc - atUtc.getTime();
}
