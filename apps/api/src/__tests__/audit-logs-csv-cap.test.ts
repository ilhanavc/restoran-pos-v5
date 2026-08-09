import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import type { AuditLogListPage } from '@restoran-pos/shared-types';
import { buildAuditCsvSpec } from '../routes/audit-logs';
import { CSV_ROW_HARD_CAP, withCsvFormat } from '../utils/csv-format-handler';
import { AuthError } from '../errors';

/**
 * ADR-037 K11.4 / DoD 12a(e) — `CSV_ROW_HARD_CAP` aşımı → 400 `REPORT_TOO_LARGE`.
 *
 * DB'siz koşar: 100 001 satırlık bir sonucu üretmek için gerçek tabloya
 * 100 001 kayıt yazmak testi dakikalar sürerdi ve hiçbir ek şey kanıtlamazdı —
 * kanıtlanması gereken, **audit CsvSpec'inin** tavan koruması altında olduğudur.
 * Tavan kontrolü audit yazımından ve `getTenantInfo`'dan ÖNCE çalıştığı için
 * db/deps hiç kullanılmaz (bu testin çalışıyor olması bunu da doğrular).
 *
 * Streaming bilinçli olarak YOK (K11.4): yarım inen denetim dosyası, net
 * hatadan daha tehlikelidir.
 */

function fakePage(rowCount: number): AuditLogListPage {
  const createdAt = new Date('2026-08-09T10:00:00.000Z').toISOString();
  // UUID'ler satır başına yeniden üretilmez (100 000 × randomUUID testi
  // gereksiz yere on saniyelerce uzatır); tavan mantığı içerikten bağımsızdır.
  const id = randomUUID();
  const entityId = randomUUID();
  return {
    logs: Array.from({ length: rowCount }, () => ({
      id,
      createdAt,
      eventType: 'order.created',
      entityType: 'order',
      entityId,
      actor: { userId: null, displayName: null, role: null },
      payload: { order_id: entityId },
    })),
    nextCursor: null,
    hasMore: false,
  };
}

function fakeRequest(): Request {
  return {
    query: { format: 'csv' },
    headers: {},
    user: {
      userId: randomUUID(),
      tenantId: randomUUID(),
      role: 'admin',
    },
  } as unknown as Request;
}

/** Tavan kontrolü öncesinde kullanılmayan bağımlılıklar — çağrılırlarsa test patlar. */
const explodingDeps = {
  db: null as unknown as Kysely<DB>,
  getTenantInfo: (): Promise<{ slug: string; timezone: string }> => {
    throw new Error('getTenantInfo tavan kontrolünden ÖNCE çağrılmamalı');
  },
};

describe('ADR-037 K11.4 — audit CSV satır tavanı', () => {
  // 100 001 satırlık `toCsv` dönüşümü tek başına ~10-25 sn sürer (her satırda
  // payload JSON.stringify). Varsayılan test timeout'u bunu kesmesin.
  it(
    `${CSV_ROW_HARD_CAP + 1} satır → next(REPORT_TOO_LARGE 400)`,
    { timeout: 120_000 },
    async () => {
      const handler = withCsvFormat(
        buildAuditCsvSpec('Europe/Istanbul'),
        async () => fakePage(CSV_ROW_HARD_CAP + 1),
        explodingDeps,
      );

      let captured: unknown;
      await new Promise<void>((resolve) => {
        handler(fakeRequest(), {} as Response, (err?: unknown) => {
          captured = err;
          resolve();
        });
      });

      expect(captured).toBeInstanceOf(AuthError);
      expect((captured as AuthError).code).toBe('REPORT_TOO_LARGE');
      expect((captured as AuthError).httpStatus).toBe(400);
    },
  );

  /**
   * Tavanın erken tetiklenmemesi, `toCsv`'nin **kayıt başına tam bir satır**
   * üretmesine bağlıdır. 100 000 satırlık bir "sınır geçti" testi koşmak yerine
   * (dakikalarca sürer, aynı şeyi kanıtlar) satır-şişmesi doğrudan sınanır:
   * `Detay` tek hücrede JSON'dur (K11.5) → 1 kayıt = 1 satır.
   */
  it('toCsv kayıt başına TEK satır üretir (tavan erken tetiklenmez)', () => {
    const spec = buildAuditCsvSpec('Europe/Istanbul');
    const { headers, rows } = spec.toCsv(fakePage(3));
    expect(rows).toHaveLength(3);
    expect(headers).toEqual([
      'Zaman',
      'Olay Kodu',
      'Kim',
      'Rol',
      'Nesne Tipi',
      'Nesne ID',
      'Detay',
    ]);
    // Bilinmeyen aktörde sabit Türkçe metin (dosya i18n taşımaz).
    expect(rows[0]!['Kim']).toBe('Bilinmeyen kullanıcı');
    // Zaman tenant TZ'sinde: 10:00 UTC → Istanbul 13:00.
    expect(rows[0]!['Zaman']).toBe('09.08.2026 13:00:00');
  });
});
