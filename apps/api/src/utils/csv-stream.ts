/**
 * CSV export yardımcıları — ADR-021 (Sprint 14 PR-4a).
 *
 * RFC 4180 + Excel TR uyumlu CSV üretir:
 * - **UTF-8 BOM** prefix (Excel TR locale'inde Türkçe karakterler doğru görüntülenir)
 * - **`;` delimiter** (TR `Sayılar Listesi Ayırıcı` default)
 * - **CRLF** satır sonu (RFC 4180 + Windows yazıcı uyumu)
 * - **`"..."` quoting** — quote/CR/LF/delimiter içeren değerler için
 * - **`""` double-quote escape** — quote içeren değerlerde
 *
 * In-memory string builder. ADR-021 100k row cap altında 100k×20 cell ≈ 50 MB
 * tahmini — Node heap için güvenli sınır. Streaming `Readable` ileri sprint'te
 * gerekirse refactor (YAGNI).
 *
 * Bu modül **route handler'ları değiştirmez** — PR-4a foundation. PR-4b'de
 * her rapor endpoint'i `?format=csv` query'sinde bu helper'ları çağıracak.
 */

import type { Response } from 'express';

/** UTF-8 BOM (Byte Order Mark) — Excel TR için zorunlu prefix. */
const UTF8_BOM = '﻿';

/** RFC 4180 satır sonu. */
const CRLF = '\r\n';

/** TR locale CSV delimiter (Excel "Liste ayırıcı" default'u). */
const DELIMITER = ';';

/**
 * Tek bir hücre değerini CSV-safe string'e çevirir.
 *
 * Tip dönüşümleri:
 * - `null` / `undefined` → `''` (boş hücre)
 * - `number` → `String(n)` (NaN/Infinity hata vermez, JS string'i kullanılır)
 * - `boolean` → `'true'` / `'false'` (lokalize edilmez — operator için ham veri)
 * - `Date` → ISO 8601 (`toISOString()`)
 * - `string` → as-is, escape kuralları uygulanır
 * - Diğer (object/array) → `JSON.stringify` (defansif; rapor şemalarında olmamalı)
 *
 * Quoting kuralı: değer `"`, `;`, CR veya LF içeriyorsa tüm değer `"..."`
 * içine alınır ve içindeki `"` karakterleri `""`'a kaçırılır (RFC 4180 §2.6/2.7).
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';

  let str: string;
  if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    str = String(value);
  } else {
    // Defansif fallback — şemada olmaması beklenen tip.
    str = JSON.stringify(value);
  }

  // RFC 4180: ", \r, \n veya delimiter içeriyorsa quote+escape.
  if (
    str.includes('"') ||
    str.includes(DELIMITER) ||
    str.includes('\r') ||
    str.includes('\n')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Bir satır oluşturur — her hücre `csvEscape`'ten geçer, `;` ile join edilir,
 * CRLF eklenir.
 */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvEscape).join(DELIMITER) + CRLF;
}

/**
 * Tam CSV body üretir: UTF-8 BOM + header satırı + data satırları.
 *
 * @param headers Kolon adları, **export sırasıyla**. CSV consumer (Excel)
 *                bu sırayı görür; rapor şemasında v1 versiyonu kilitlenince
 *                (PR-4b) sıralama da kilitlenir.
 * @param rows    Object array — her object key'i `headers` listesinde olmalı.
 *                Eksik key → boş hücre (`csvEscape(undefined) === ''`).
 * @returns       BOM + header + body birleşik string.
 */
export function buildCsv<T extends Record<string, unknown>>(
  headers: readonly (keyof T & string)[],
  rows: readonly T[],
): string {
  const headerRow = csvRow(headers);
  const bodyRows = rows.map((row) => csvRow(headers.map((h) => row[h])));
  return UTF8_BOM + headerRow + bodyRows.join('');
}

/**
 * Filename pattern: `<reportName>-<tenantSlug>-<YYYY-MM-DD>-<HHmmss>.csv`.
 *
 * Tarih/saat tenant timezone'unda hesaplanır (ADR-021 Karar 4) — operator
 * yerel saatiyle dosyayı bulur. UTC kullanmak yanıltıcı olur (gece raporu
 * sabah dosyası gibi görünebilir).
 *
 * @param reportName Kebab-case rapor adı (örn. `'category-sales'`).
 * @param tenantSlug Tenant slug — DB'den okunur (ADR-001).
 * @param timestamp  Filename'e gömülecek an. Default: `new Date()` çağrıldığında.
 * @param timezone   IANA TZ (örn. `'Europe/Istanbul'`). Tenant settings'ten gelir.
 */
export function buildCsvFilename(args: {
  reportName: string;
  tenantSlug: string;
  timestamp: Date;
  timezone: string;
}): string {
  const { reportName, tenantSlug, timestamp, timezone } = args;

  // Intl ile yerel Y/M/D + H/m/s parçalarını al.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(timestamp);
  const get = (type: string): string => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) {
      throw new Error(`buildCsvFilename: missing ${type} for tz=${timezone}`);
    }
    return part.value;
  };

  const year = get('year');
  const month = get('month');
  const day = get('day');
  // hour bazı locale'lerde "24" döner gece yarısı için — `00` olarak normalize et.
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const minute = get('minute');
  const second = get('second');

  return `${reportName}-${tenantSlug}-${year}-${month}-${day}-${hour}${minute}${second}.csv`;
}

/**
 * Express response helper: CSV header'ları + body'yi yazar.
 *
 * - `Content-Type: text/csv; charset=utf-8`
 * - `Content-Disposition: attachment; filename="..."` — RFC 6266 quoted-string
 * - `Cache-Control: no-store` — ADR-015 Karar 6 (no-cache) paritesi
 *
 * Body **zaten UTF-8 BOM içerir** (`buildCsv` ekler). Bu fonksiyon BOM eklemez —
 * çift BOM bug'ından kaçınır.
 */
export function sendCsv(res: Response, filename: string, body: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // Filename'de quote olmamalı (slug + ASCII tarih). Defansif olarak strip:
  const safeFilename = filename.replace(/"/g, '');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeFilename}"`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(body);
}
