# Sprint 15 PR-1 — Implementer Brief: ADR-015 Amendment 2 (Range Standardization)

> Bu brief, ADR-015 Amendment 2 (`.claude/memory/decisions.md`) kararlarının backend implementasyonu içindir. Tüm kararlar zaten verilmiş ve gerekçelendirilmiştir; bu doküman adım-adım iş listesidir.

## Kapsam

**Backend** (Sprint 15 PR-1) — 11 endpoint range standardizasyonu + window helper + test.
**Frontend** (Sprint 15 PR-2, ayrı PR) — RangeFilter restore + hook signature güncellemesi.

## Pre-flight kontrol

- [ ] `claude/elated-maxwell-fb40aa` worktree'sinde branch aç: `feat/sprint-15-pr-1-range-standardization`
- [ ] Mevcut `apps/api/src/utils/business-day.ts` ve `business-day.test.ts` oku — `getRangeWindow` çağrıları nerede?
- [ ] `grep -r "getRangeWindow" apps/api/src/` → çağıran 3 dosya (category-sales, user-performance, anomalies) çıkacak.

## Adım 1: Window helper — `resolveRangeWindow`

**Dosya:** `apps/api/src/utils/business-day.ts`

Mevcut export'ları koru (`getCalendarDayWindow`, `CalendarDayWindow`). Eklenecek:

```ts
export type RangeKind = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

export interface ResolveRangeInput {
  range: RangeKind;
  from?: string;
  to?: string;
  tz: string;
  now?: Date;
}

export interface RangeWindow {
  startUtc: Date;
  endUtc: Date;
}

export function resolveRangeWindow(input: ResolveRangeInput): RangeWindow {
  const now = input.now ?? new Date();

  if (input.range === 'today') {
    return getCalendarDayWindow(input.tz, now);
  }

  if (input.range === 'yesterday') {
    // DST-aware: 24h çıkartma yerine `getCalendarDayWindow(tz, now)` start'ı al,
    // o günün local Y/M/D'sini çıkar → 1 gün geri → tekrar localMidnightToUtc.
    // YA DA: now'dan 24h öncesinin window'unu hesaplamak DST sınırında ±1 saat
    // hataya yol açabilir. Doğru yol: önce bugünün local Y/M/D'sini çıkar
    // (mevcut Intl logic), sonra day-1 yap, sonra localMidnightToUtc(day-1) ve
    // localMidnightToUtc(day). Yardımcı fonksiyon ekle: `getCalendarDayByOffset(tz, now, dayOffset)`.
    return getCalendarDayByOffset(input.tz, now, -1);
  }

  if (input.range === 'last7') {
    const start = getCalendarDayByOffset(input.tz, now, -6).startUtc;
    const end = getCalendarDayWindow(input.tz, now).endUtc;
    return { startUtc: start, endUtc: end };
  }

  if (input.range === 'last30') {
    const start = getCalendarDayByOffset(input.tz, now, -29).startUtc;
    const end = getCalendarDayWindow(input.tz, now).endUtc;
    return { startUtc: start, endUtc: end };
  }

  if (input.range === 'custom') {
    if (input.from === undefined || input.to === undefined) {
      throw new Error('resolveRangeWindow: custom requires from and to');
    }
    // from/to YYYY-MM-DD → local midnight UTC için Date olarak parse et,
    // sonra localMidnightToUtc'a year/month/day ver.
    // `to`'nun günü dahil → endUtc = to+1 günün 00:00.
    const [fy, fm, fd] = input.from.split('-').map(Number);
    const [ty, tm, td] = input.to.split('-').map(Number);
    const startUtc = localMidnightToUtc(fy, fm, fd, input.tz);
    // to+1 gün için bir Date ile day++ yap, overflow handled by Date.UTC.
    const toNext = new Date(Date.UTC(ty, tm - 1, td + 1));
    const endUtc = localMidnightToUtc(
      toNext.getUTCFullYear(),
      toNext.getUTCMonth() + 1,
      toNext.getUTCDate(),
      input.tz,
    );
    return { startUtc, endUtc };
  }

  // Exhaustive check — TS strict
  const _exhaustive: never = input.range;
  throw new Error(`resolveRangeWindow: unknown range ${_exhaustive}`);
}

// Yardımcı: tenant TZ'sinde "now"un local takvim günü ± offset için window.
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
    if (p === undefined) throw new Error(`missing ${type}`);
    return Number.parseInt(p.value, 10);
  };
  const y = get('year');
  const m = get('month');
  const d = get('day');

  // d + dayOffset overflow handled by Date.UTC
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
```

**`getRangeWindow` (eski):** Detail endpoint'lerin tek tüketicisi → adım 3'te göç edildikten sonra **export'tan kaldır** (private fn olarak kalsa da OK; en temizi sil).

## Adım 2: Shared types — `KpiRangeQuerySchema`

**Dosya:** `packages/shared-types/src/reports.ts`

Dosyanın en üstüne (eski schema'ların ÖNÜNE, başka schema'larda import edilebilsin) ekle:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// ADR-015 Amendment 2 — Ortak range query schema (8 KPI + 3 detail endpoint)
// ─────────────────────────────────────────────────────────────────────────────

export const RangeKindSchema = z.enum([
  'today',
  'yesterday',
  'last7',
  'last30',
  'custom',
]);
export type RangeKind = z.infer<typeof RangeKindSchema>;

export const KpiRangeQuerySchema = z
  .object({
    range: RangeKindSchema.optional().default('today'),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (v) => (v.range === 'custom' ? v.from !== undefined && v.to !== undefined : true),
    { message: "range='custom' için from ve to zorunlu", path: ['from'] },
  )
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: 'from ve to birlikte verilmeli',
    path: ['from'],
  })
  .refine(
    (v) => v.from === undefined || v.to === undefined || v.from <= v.to,
    { message: 'from <= to olmalı', path: ['from'] },
  )
  .refine(
    (v) => {
      if (v.from === undefined || v.to === undefined) return true;
      const start = new Date(`${v.from}T00:00:00Z`).getTime();
      const end = new Date(`${v.to}T00:00:00Z`).getTime();
      const days = (end - start) / 86_400_000;
      return days <= 90;
    },
    { message: 'custom range en fazla 90 gün olabilir', path: ['to'] },
  );
export type KpiRangeQuery = z.infer<typeof KpiRangeQuerySchema>;
```

## Adım 3: Detail endpoint enum migration (BREAKING)

3 schema'da enum'u değiştir:

**`CategorySalesQuerySchema`** (satır ~199):
- `range: z.enum(['today', 'week', 'month']).optional().default('today')` → kaldır
- Yerine: `KpiRangeQuerySchema`'yı doğrudan kullan veya extend et. **Tercih:** `CategorySalesQuerySchema = KpiRangeQuerySchema` (alias). Bu basit; ileride ek field gerekirse `KpiRangeQuerySchema.and(...)` ile extend edilir.

**`AnomaliesQuerySchema`** (satır ~249): aynı — `KpiRangeQuerySchema` alias.

**`UserPerformanceQuerySchema`** (satır ~327): `role` field'ı ek. Pattern:

```ts
export const UserPerformanceQuerySchema = KpiRangeQuerySchema.and(
  z.object({
    role: z.enum(['cashier', 'waiter']).optional(),
  }),
);
```

**Endpoint kodu güncelleme:**
- `apps/api/src/routes/reports/category-sales.ts`: `getRangeWindow(tz, {kind:'range'|'explicit', ...})` çağrısını sil → `resolveRangeWindow({range, from, to, tz})` kullan.
- `apps/api/src/routes/reports/user-performance.ts`: aynı.
- `apps/api/src/routes/reports/anomalies.ts`: aynı.

Eski `getRangeWindow` artık çağrılmıyor → `business-day.ts`'den export'unu kaldır + ilgili testleri sil/güncelle.

## Adım 4: 8 KPI endpoint'e range desteği

**Liste:**
1. `today-revenue.ts`
2. `order-count.ts`
3. `average-bill.ts`
4. `hourly-revenue.ts`
5. `payment-distribution.ts`
6. `top-selling.ts`
7. `recent-orders.ts`
8. `closed-orders.ts`

**Her endpoint'te:**

1. `compute(req)` başında:
   ```ts
   const parsed = KpiRangeQuerySchema.safeParse(req.query);
   if (!parsed.success) throw domainError('VALIDATION_ERROR', 400);
   const { range, from, to } = parsed.data;
   ```
2. Mevcut `getCalendarDayWindow(tz, now)` çağrısını sil → `resolveRangeWindow({ range, from, to, tz })`.
3. SQL WHERE: `created_at >= startUtc AND created_at < endUtc`.
4. Response'a `windowStart: startUtc.toISOString()`, `windowEnd: endUtc.toISOString()` ekle.

**Schema güncellemesi (`packages/shared-types/src/reports.ts`):**

Şu schema'lara `windowStart`/`windowEnd` field ekle:
- `AverageBillResponseSchema` (yok)
- `HourlyRevenueResponseSchema` (yok)
- `PaymentDistributionResponseSchema` (yok)
- `TopSellingResponseSchema` (yok)
- `RecentOrdersResponseSchema` (yok)
- `ClosedOrdersResponseSchema` (yok)

`TodayRevenueResponseSchema` ve `OrderCountResponseSchema`'da zaten var.

**`top-selling.ts`**, **`recent-orders.ts`**, **`closed-orders.ts`** zaten `limit` query param alıyor — `KpiRangeQuerySchema.and(z.object({ limit: ... }))` pattern ile birleştir.

**`top-selling`** ayrıca paid-only filter zaten var; `last30` ile büyük dataset için EXPLAIN ANALYZE çalıştır (NFR doğrulama).

## Adım 5: CSV format handler güncellemesi

ADR-021 PR-4b1/4b2 ile 8 KPI + 3 detail + 2 Z/X CSV format desteği var. Window field'ları schema'ya eklendiği için CSV çıktısında da window header satırı dönmeli:

**`apps/api/src/utils/csv-format-handler.ts`** veya endpoint-specific CSV spec — header'a `Pencere Başlangıcı`, `Pencere Bitişi` ekle. (Mevcut detail endpoint'lerinde zaten var olabilir; verify.)

## Adım 6: Test'ler

### Unit (`apps/api/src/utils/business-day.test.ts`)

12+ test ekle:

```ts
describe('resolveRangeWindow', () => {
  const TZ_IST = 'Europe/Istanbul';
  const TZ_APIA = 'Pacific/Apia'; // dateline edge

  it('range=today returns getCalendarDayWindow', ...);
  it('range=yesterday returns previous calendar day', ...);
  it('range=last7 spans 7 calendar days', ...);
  it('range=last30 spans 30 calendar days', ...);
  it('range=custom with from===to returns 1-day window', ...);
  it('range=custom 90-day window works', ...);
  it('DST forward day (Europe/Istanbul, 2027-03-28) yesterday window correct', ...);
  it('Pacific/Apia dateline edge: today vs yesterday', ...);
  // Schema validation
  it('rejects custom range without from/to (zod refine)', ...);
  it('rejects from > to', ...);
  it('rejects 91-day custom range', ...);
  it('accepts default range=today', ...);
});
```

### Integration (`apps/api/src/routes/reports/*.test.ts`)

8 KPI endpoint için, mevcut test dosyalarına ek 2 case her birinde:

- `?range=yesterday` → seed: dün satılmış sipariş varsa response.totalRevenueCents>0.
- `?range=custom&from=...&to=...` (1 gün, dün) → aynı sonuç.

3 detail endpoint'te 1 regression test:
- `?range=week` → 400 (breaking validation).

## Adım 7: Definition of Done

- [ ] TypeScript strict, `tsc --noEmit` 0 error
- [ ] `pnpm test` 0 fail, yeni test'ler PASS
- [ ] `pnpm lint` 0 warning
- [ ] Mevcut testler (sprint 14 sonu 471/471 PASS) regression yok
- [ ] `getRangeWindow` artık hiçbir yerde import edilmiyor (grep verify)
- [ ] `resolveRangeWindow` 11 endpoint'te tek SOURCE — duplicate `getCalendarDayWindow` çağrısı kalmadı
- [ ] CHANGELOG.md ek: "ADR-015 Amendment 2: range standardization (today/yesterday/last7/last30/custom)"
- [ ] PR description'da `BREAKING:` etiketi (3 detail endpoint enum migration)
- [ ] ADR-015 Amendment 2 statüsü `Proposed` → `Accepted` (PR merge onayı ile)
- [ ] Sprint 15 PR-2 brief'i `.claude/memory/sprint-15-pr-2-brief.md`'ye yazılır (frontend RangeFilter restore + hook imza güncelleme)

## Açık sorular (kullanıcı kararı gerekenler)

1. **`range='custom'` zorunlu mu, opsiyonel mi?** Önerim: `range` field zorunlu (`default('today')`), `range='custom'` verildiğinde `from`+`to` zorunlu. Alternatif: `range` opsiyonel, `from`+`to` verilirse otomatik custom (Amendment 1 davranışı). Hangisi tercih?
   - **Öneri:** Yeni davranış (`range='custom'` explicit), daha açık API. Eski "from/to override ignores range" davranışı silinir.

2. **`getRangeWindow` export'unu silelim mi, deprecated bırakalım mı?** Hiç kullanıcısı kalmıyor → öneri: **sil**. Public API surface küçük.

3. **CSV format'ta window field ek satırı: header'da mı, ayrı meta satırda mı?** Mevcut detail endpoint CSV'ler nasıl yapıyor → o pattern'i takip et.

4. **`AverageBillResponseSchema`'da `asOf` var ama `windowStart/End` yok** — eklendiğinde frontend response tipi değişir. Verify: bu schema'yı tüketen UI kodu var mı (Sprint 14 PR-5e cleanup sonrası)?

5. **Sprint 15 PR-1 boyutu** — 14 dosya değişir (helper + types + 11 endpoint + 1 CSV). Çok büyük gibi geliyorsa 2 PR'a böl:
   - PR-1a: helper + shared-types + 3 detail endpoint enum migration
   - PR-1b: 8 KPI endpoint range desteği
   - **Öneri:** Tek PR — değişim cerrahi ve atomik, bölmek değil.
