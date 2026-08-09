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

/**
 * ADR-021 Karar 5 — CSV body row hard cap.
 *
 * ADR-037 K11.4 gereği dışa açıldı: audit-logs CSV yolu repository'yi
 * `CSV_ROW_HARD_CAP + 1` ile çağırır (101 000. satırın varlığı tavanın
 * AŞILDIĞINI kesinleştirir; tam 100 000'de yanlış `REPORT_TOO_LARGE` verilmez).
 * Yeni bir sabit icat edilmez.
 */
export const CSV_ROW_HARD_CAP = 100_000;

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
  /**
   * **Opsiyonel PII sertleştirmesi** (güvenlik denetimi, ADR-037 ile geldi).
   *
   * Verilirse `audit_logs.payload.query_string`'e YALNIZ bu anahtarlar yazılır;
   * şemada olmayan her query parametresi (ör. `?not=Ali+Veli+05551234567`)
   * atılır. Gerekçe: `audit_logs_payload_no_pii` CHECK'i yalnız **anahtar adı**
   * bazlı korur — serbest metne gömülen PII CHECK'i atlayıp kalıcı olarak
   * audit'e yazılabilirdi (KVKK).
   *
   * `undefined` bırakılırsa davranış değişmez (tüm query serialize edilir) —
   * mevcut rapor endpoint'leri için geriye dönük uyumlu.
   */
  readonly auditQueryKeys?: readonly string[];
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
 * (deny-list); audit sanitize allow-list'i `reports.csv_export` event'i için
 * sadece `report_name`, `query_string`, `row_count`, `filename` whitelist'inde
 * tutar.
 *
 * `req.query` bir nested object olabilir; serialize ederek tek string'e indir.
 * Bu sayede sanitize'in nested whitelist drop davranışı tetiklenmez.
 *
 * `allowedKeys` verilirse **yalnız** o anahtarlar yazılır (bkz.
 * `CsvSpec.auditQueryKeys`): şema-dışı bir parametreye gömülen serbest-metin
 * PII'nin, anahtar-adı bazlı CHECK'i atlayıp audit'e kalıcı yazılmasını engeller.
 */
function serializeQuery(
  query: Request['query'],
  allowedKeys?: readonly string[],
): string {
  const allow = allowedKeys === undefined ? null : new Set(allowedKeys);
  const parts: string[] = [];
  for (const key of Object.keys(query).sort()) {
    if (allow !== null && !allow.has(key)) continue;
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

      // ADR-015 Amendment 6 (R7-AZ-01, KVKK minimizasyonu) — CSV export
      // yalnız admin; ekran (JSON) görünümü route'un kendi authorize()
      // dizisiyle değişmeden kalır (admin+cashier). Kalıcı dosya (disk/
      // USB/e-posta) riski yalnız CSV'de var; erken red — compute/audit
      // çağrılmadan önce (gereksiz DB sorgusu yok).
      if (formatRaw === 'csv' && req.user!.role !== 'admin') {
        return next(domainError('AUTH_FORBIDDEN', 403));
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
        eventType: 'reports.csv_export',
        actorUserId: req.user!.userId,
        actor: { user_agent: req.headers['user-agent'] ?? '' },
        entityType: 'report',
        rawPayload: {
          report_name: spec.reportName,
          query_string: serializeQuery(req.query, spec.auditQueryKeys),
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
