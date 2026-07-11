import { describe, expect, it } from 'vitest';
import { csvEscape } from '../utils/csv-stream.js';

/**
 * Blok 7 denetim bulgusu R7-CSV-01 — KASITLI KIRMIZI karakterizasyon.
 *
 * csvEscape (csv-stream.ts:44-69) yalnız RFC 4180 quoting yapıyor
 * (", ;, \r, \n). Formula-injection nötrleştirmesi YOK: `=`, `+`, `-`, `@`,
 * TAB, CR ile başlayan hücreye OWASP-önerilen `'` prefix eklenmiyor.
 *
 * Saldırı: düşük-yetkili personel bir serbest-metin alanına (ör.
 * anomalies.reason = iptal gerekçesi) `=cmd|'/c calc'!A1` yazar; admin
 * `GET /reports/anomalies?format=csv` çıktısını Excel/Sheets'te açtığında
 * hücre formül olarak yorumlanır (stored → cross-privilege).
 *
 * Beklenen: tehlikeli ilk-karakterli hücre `'` ile prefix'lenmeli.
 * Bugün: prefix yok → bu testler fix'e kadar KIRMIZI kalır.
 */
describe('CSV formula injection nötrleştirme (R7-CSV-01)', () => {
  const dangerous = ['=1+1', '+1', '-1+2', '@SUM(A1)', '\t=x'];

  for (const payload of dangerous) {
    it(`R7-CSV-01 "${payload.replace('\t', '\\t')}" hücresi ' ile prefix'lenmeli (bugün: prefix yok)`, () => {
      const out = csvEscape(payload);
      // Nötrleştirilmiş çıktı ya doğrudan ' ile başlamalı ya da "'...  şeklinde quoted olmalı
      const neutralized = out.startsWith("'") || out.startsWith(`"'`);
      expect(neutralized).toBe(true);
    });
  }
});
