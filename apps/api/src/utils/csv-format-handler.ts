import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { buildCsv, buildCsvFilename, sendCsv } from './csv-stream.js';
import { writeAudit } from '../audit/writeAudit.js';
import { domainError } from '../errors.js';

/**
 * ADR-021 (Sprint 14 PR-4b1) — `?format=csv` adapter.
 *
 * Mevcut KPI/rapor route handler'larındaki **business compute** logic'ini
 * değiştirmeden, response formatını seçen ortak sarmalayıcı.
 *
 * Kullanım:
 *
 *   const computeCategorySales = async (req) => { ... return data; };
 *   const spec: CsvSpec<typeof data> = {
 *     reportName: 'category-sales',
 *     toCsv: (data) => ({ headers: [...], rows: data.categories.map(...) }),
 *   };
 *   router.get('/category-sales', auth, rbac,
 *     withCsvFormat(spec, computeCategorySales, { db, getTenantInfo }));
 *
 * Davranış:
 *  - `format` query missing veya boş → JSON `{ data: result }` (geriye dönük uyumlu).
 *  - `format=csv`                    → CSV body (UTF-8 BOM + `;` + CRLF), Content-Disposition + audit.
 *  - `format=<other>`                → 400 VALIDATION_ERROR (`format` whitelist'i yalnız 'csv').
 *
 * 100k row hard cap (ADR-021 Karar 5): aşımda `REPORT_TOO_LARGE` (400) — client
 * tarafı `range` daraltıp tekrar dener.
 */

/** ADR-021 Karar 5 — CSV body row hard cap. */
const CSV_ROW_HARD_CAP = 100_000;

/**
 * Tek bir endpoint'in CSV dönüşüm spesifikasyonu.
 *
 * `toCsv` saf fonksiyon: domain veriyi (compute fonksiyonun döndürdüğü tip)
 * alır, header sırası kilitli + Excel TR uyumlu satır listesi üretir.
 */
export interface CsvSpec<T> {
  /**
   * Filename'e gömülecek kebab-case rapor adı (örn. `'category-sales'`).
   * `audit_logs.payload.report_name` da bu değeri taşır.
   */
  readonly reportName: string;
  /**
   * Domain verisini header + row listesine dönüştürür.
   * `headers` sırası export'ta kilitli (rapor şema versiyon kontrolü).
   */
  readonly toCsv: (data: T) => {
    readonly headers: readonly string[];
    readonly rows: readonly Record<string, unknown>[];
  };
}

/**
 * Wrapper'ın çalışması için gereken ortak bağımlılıklar.
 * Tenant info per-request DB'den okunur (cache YOK — PR-4a no-cache paritesi).
 */
export interface CsvFormatHandlerDeps {
  readonly db: Kysely<DB>;
  /**
   * Tenant slug + timezone resolver. Filename'i tenant TZ'sinde formatlamak +
   * dosya adına slug eklemek için kullanılır.
   */
  readonly getTenantInfo: (
    tenantId: string,
  ) => Promise<{ slug: string; timezone: string }>;
}

/**
 * `format` query parametresinin geçerli değerleri.
 * Genişletme: ADR-021 v2'de yeni format eklenirse buraya, validate'a, ve
 * sanitize allow-list'ine güncel değer eklenir.
 */
const ALLOWED_FORMATS: ReadonlySet<string> = new Set(['csv']);

/**
 * `req.query.format` değerini güvenli şekilde okur.
 * Express query parser değeri `string | string[] | ParsedQs | ParsedQs[] | undefined` döner;
 * dizi/object değerleri yasakla — yalnız tek string kabul.
 */
function readFormatParam(req: Request): string | undefined {
  const raw = req.query['format'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return '__invalid__';
  if (raw.length === 0) return undefined;
  return raw.toLowerCase();
}

/**
 * Audit payload'a yazılacak query string snapshot'ı. PII taramasından geçer
 * (deny-list); audit sanitize allow-list'i `reports.export.csv` event'i için
 * sadece `report_name`, `query_string`, `row_count`, `filename` whitelist'inde
 * tutar.
 *
 * `req.query` bir nested object olabilir; serialize ederek tek string'e indir.
 * Bu sayede sanitize'in nested whitelist drop davranışı tetiklenmez.
 */
function serializeQuery(query: Request['query']): string {
  const parts: string[] = [];
  for (const key of Object.keys(query).sort()) {
    const v = query[key];
    if (v === undefined) continue;
    if (typeof v === 'string') {
      parts.push(`${key}=${v}`);
    } else if (Array.isArray(v)) {
      parts.push(`${key}=${v.map(String).join(',')}`);
    } else {
      // ParsedQs nested — JSON'a serialize.
      parts.push(`${key}=${JSON.stringify(v)}`);
    }
  }
  return parts.join('&');
}

/**
 * Express RequestHandler üretir. Compute fonksiyonu **bir kez** çağrılır;
 * format=csv path'inde dönüşüm + audit yazma + sendCsv, default path'te
 * `res.json({ data: result })`.
 *
 * Hatalar `next(err)` ile aktarılır (toHttpError mapper işler).
 */
export function withCsvFormat<T>(
  spec: CsvSpec<T>,
  handler: (req: Request) => Promise<T>,
  deps: CsvFormatHandlerDeps,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const formatRaw = readFormatParam(req);

      // Format değeri varsa ve whitelist dışıysa 400. `__invalid__` (object/array)
      // case'i de buraya düşer.
      if (formatRaw !== undefined && !ALLOWED_FORMATS.has(formatRaw)) {
        return next(domainError('VALIDATION_ERROR', 400));
      }

      const data = await handler(req);

      // Default JSON path — geriye dönük uyumlu davranış.
      if (formatRaw === undefined) {
        res.status(200).json({ data });
        return;
      }

      // ──────────────────────── CSV path ────────────────────────
      const { headers, rows } = spec.toCsv(data);

      if (rows.length > CSV_ROW_HARD_CAP) {
        return next(domainError('REPORT_TOO_LARGE', 400));
      }

      const tenantId = req.user!.tenantId;
      const tenant = await deps.getTenantInfo(tenantId);

      const filename = buildCsvFilename({
        reportName: spec.reportName,
        tenantSlug: tenant.slug,
        timestamp: new Date(),
        timezone: tenant.timezone,
      });

      const body = buildCsv(headers, rows);

      // Audit önce, sonra send. Audit hatası transactionsız — patlarsa client
      // CSV görmez (consistent: indirildi → kayıt var). writeAudit sanitize
      // PII taraması yaparsa o burada fırlar (ALLOWED_KEYS allowlist whitelist-miss
      // log'lar, throw etmez; deny-list throw eder).
      await writeAudit(deps.db, {
        tenantId,
        eventType: 'reports.export.csv',
        actorUserId: req.user!.userId,
        actor: { user_agent: req.headers['user-agent'] ?? '' },
        entityType: 'report',
        rawPayload: {
          report_name: spec.reportName,
          query_string: serializeQuery(req.query),
          row_count: rows.length,
          filename,
        },
      });

      sendCsv(res, filename, body);
    } catch (err) {
      return next(err);
    }
  };
}
