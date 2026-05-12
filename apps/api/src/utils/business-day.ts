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
 * ADR-015 Amendment 2 (2026-05-12) — Ortak range pencere kararı.
 *
 * 5 preset + custom: `today | yesterday | last7 | last30 | custom`.
 * Tüm KPI ve detail endpoint'lerinin tek window source'u. Eski Amendment 1
 * `range=today|week|month` semantiği KALDIRILDI (breaking) — kullanıcı
 * kararıyla 5 önayar daha açık ve mobile-friendly.
 *
 * Window semantiği (TZ-aware, `tenant_settings.timezone`):
 *   today     = bugünün takvim günü [00:00, 24:00) local
 *   yesterday = dünün takvim günü [00:00, 24:00) local — DST-aware
 *   last7     = bugün dahil son 7 takvim günü [bugün-6 00:00, yarın 00:00)
 *   last30    = bugün dahil son 30 takvim günü [bugün-29 00:00, yarın 00:00)
 *   custom    = [from 00:00, (to+1) 00:00) local — `to` günü dahil
 *
 * `custom` için `from` ve `to` ZORUNLU (zod refine route layer'da garanti
 * eder; helper içinde defensive throw). business_day_cutoff_hour KULLANILMAZ
 * (Karar 7 DROP, takvim günü).
 */
export type RangeKind = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

export interface ResolveRangeInput {
  range: RangeKind;
  /** `YYYY-MM-DD` — yalnız `range='custom'`'da kullanılır. */
  from?: string | undefined;
  /** `YYYY-MM-DD` — yalnız `range='custom'`'da kullanılır. */
  to?: string | undefined;
  tz: string;
  /** Test için inject (default: new Date()). */
  now?: Date | undefined;
}

export interface RangeWindow {
  startUtc: Date;
  endUtc: Date;
}

/**
 * `resolveRangeWindow` — 5 preset + custom için UTC pencere döner.
 *
 * @param input.range  Preset adı veya `'custom'`
 * @param input.from   `YYYY-MM-DD` — yalnız `range='custom'`'da kullanılır
 * @param input.to     `YYYY-MM-DD` — yalnız `range='custom'`'da kullanılır
 * @param input.tz     IANA TZ (örn. `'Europe/Istanbul'`)
 * @param input.now    Hesabın referans aldığı an (test için inject; default new Date())
 *
 * @throws  Custom range'de `from`/`to` undefined ise — route handler zod refine ile
 *          önceden engellemeli, bu defensive throw.
 */
export function resolveRangeWindow(input: ResolveRangeInput): RangeWindow {
  const now = input.now ?? new Date();

  if (input.range === 'today') {
    return getCalendarDayWindow(input.tz, now);
  }

  if (input.range === 'yesterday') {
    // DST-aware: bugünün yerel Y/M/D'sini çıkar → day-1 ofsetiyle window.
    return getCalendarDayByOffset(input.tz, now, -1);
  }

  if (input.range === 'last7') {
    // [bugün-6 00:00, yarın 00:00) — bugün dahil 7 takvim günü.
    const startUtc = getCalendarDayByOffset(input.tz, now, -6).startUtc;
    const endUtc = getCalendarDayWindow(input.tz, now).endUtc;
    return { startUtc, endUtc };
  }

  if (input.range === 'last30') {
    // [bugün-29 00:00, yarın 00:00) — bugün dahil 30 takvim günü.
    const startUtc = getCalendarDayByOffset(input.tz, now, -29).startUtc;
    const endUtc = getCalendarDayWindow(input.tz, now).endUtc;
    return { startUtc, endUtc };
  }

  if (input.range === 'custom') {
    if (input.from === undefined || input.to === undefined) {
      throw new Error(
        "resolveRangeWindow: range='custom' requires both `from` and `to`",
      );
    }
    return explicitWindow(input.from, input.to, input.tz);
  }

  // Exhaustive check — TS strict, derleyici eklenen RangeKind'ı yakalar.
  const _exhaustive: never = input.range;
  throw new Error(`resolveRangeWindow: unknown range ${String(_exhaustive)}`);
}

/**
 * Tenant TZ'sinde "now"un local takvim günü ± dayOffset için window.
 *
 * DST-aware: yerel takvim Y/M/D'yi UTC arithmetic (Date.UTC) ile day ofset
 * uyguladıktan sonra `localMidnightToUtc` ile UTC instant'a çevirir. 24h
 * çıkartma DST sınırında ±1 saat hata üretirdi; bu yol güvenli.
 *
 * @param timezone   IANA TZ
 * @param now        Anki UTC zaman
 * @param dayOffset  Gün ofseti (negatif = geriye, pozitif = ileriye)
 */
function getCalendarDayByOffset(
  timezone: string,
  now: Date,
  dayOffset: number,
): CalendarDayWindow {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    if (p === undefined) {
      throw new Error(`getCalendarDayByOffset: missing ${type} for tz=${timezone}`);
    }
    return Number.parseInt(p.value, 10);
  };
  const y = get('year');
  const m = get('month');
  const d = get('day');

  // day + offset; month/year overflow JS Date.UTC ile otomatik çözülür.
  const target = new Date(Date.UTC(y, m - 1, d + dayOffset));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  const td = target.getUTCDate();

  const startUtc = localMidnightToUtc(ty, tm, td, timezone);
  const next = new Date(Date.UTC(ty, tm - 1, td + 1));
  const endUtc = localMidnightToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timezone,
  );
  return { startUtc, endUtc };
}

/**
 * ADR-015 Amendment 1 (Karar 4) — daily-close (Z) window.
 *
 * Tek günü kapsayan kapanış penceresi: [start_of_day(date), end_of_day(date))
 * tenant TZ. `dateString` undefined ise bugün (local TZ).
 *
 * @param timezone   IANA TZ
 * @param dateString `YYYY-MM-DD` veya undefined (default: bugün)
 * @param now        Hesabın referansı (test için inject; default `new Date()`)
 */
export function getDailyCloseWindow(
  timezone: string,
  dateString: string | undefined,
  now: Date = new Date(),
): CalendarDayWindow {
  if (dateString === undefined) {
    return getCalendarDayWindow(timezone, now);
  }
  const [y, m, d] = dateString.split('-').map((s) => Number.parseInt(s, 10));
  const startUtc = localMidnightToUtc(y!, m!, d!, timezone);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  const endUtc = localMidnightToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timezone,
  );
  return { startUtc, endUtc };
}

/**
 * ADR-015 Amendment 1 (Karar 4) — snapshot (X) window.
 *
 * Ara kapanış penceresi: [start_of_day(at), at) tenant TZ. `atIso` undefined
 * ise şu an. `at` window'un sağ kenarı (exclusive). `at` < start_of_day(at)
 * teorik olarak imkansız (start_of_day(at) <= at her zaman).
 *
 * @param timezone IANA TZ
 * @param atIso    ISO8601 datetime veya undefined (default: now)
 * @param now      Hesabın referansı (test için inject; default `new Date()`)
 */
export function getSnapshotWindow(
  timezone: string,
  atIso: string | undefined,
  now: Date = new Date(),
): CalendarDayWindow {
  const at = atIso === undefined ? now : new Date(atIso);
  const { startUtc } = getCalendarDayWindow(timezone, at);
  return { startUtc, endUtc: at };
}

/** YYYY-MM-DD → local 00:00 → UTC. `to` dahil etmek için +1 gün. */
function explicitWindow(from: string, to: string, timezone: string): CalendarDayWindow {
  const [fy, fm, fd] = from.split('-').map((s) => Number.parseInt(s, 10));
  const [ty, tm, td] = to.split('-').map((s) => Number.parseInt(s, 10));
  const startUtc = localMidnightToUtc(fy!, fm!, fd!, timezone);
  // `to` günü dahil edilsin diye ertesi gün midnight'a kadar.
  const next = new Date(Date.UTC(ty!, tm! - 1, td! + 1));
  const endUtc = localMidnightToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timezone,
  );
  return { startUtc, endUtc };
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
