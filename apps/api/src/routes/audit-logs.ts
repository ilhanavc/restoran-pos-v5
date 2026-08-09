import {
  Router,
  type Request,
  type RequestHandler,
  type Router as ExpressRouter,
} from 'express';
import rateLimit from 'express-rate-limit';
import type { Kysely } from 'kysely';
import {
  createAuditLogsRepository,
  type AuditLogCursor,
  type AuditLogFilters,
  type AuditLogRow,
  type DB,
} from '@restoran-pos/db';
import {
  AuditLogListQuerySchema,
  type AuditLogListItem,
  type AuditLogListPage,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { AUTH_MESSAGE_KEYS, domainError } from '../errors.js';
import {
  withCsvFormat,
  CSV_ROW_HARD_CAP,
  type CsvSpec,
} from '../utils/csv-format-handler.js';
import { getTenantInfo } from '../utils/tenant-info.js';
import { resolveTenantTimezone } from './reports/tz.js';
import { formatReceiptDateTime } from '../print/format-receipt-datetime.js';

/**
 * ADR-037 — `GET /audit-logs` (denetim günlüğü okuma yüzeyi).
 *
 * SALT-OKUMA: migration yok, index yok, yeni audit olayı yok, `writeAudit`
 * yolunda tek satır değişiklik yok (K10).
 *
 *  - Sayfalama: **keyset** cursor (`created_at DESC, id DESC`), offset DEĞİL;
 *    `total` DÖNMEZ (K2). Konvansiyon sapması ADR'de gerekçelidir.
 *  - RBAC: **yalnız admin** (K5). `audit.viewed` diye yeni olay YAZILMAZ.
 *  - CSV: ayrı endpoint yok — aynı route + `?format=csv` (K11).
 */

/** ADR-037 K4 — filtresiz açılışta varsayılan pencere: son 7 gün. */
const DEFAULT_WINDOW_DAYS = 7;

/** ADR-037 K5 — 60 istek/dk/IP (toplu sıyırmayı yavaşlatır). */
const RATE_LIMIT_PER_MINUTE = 60;

export interface AuditLogsRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * Opak keyset cursor: `base64url("<createdAt ISO>|<uuid>")`.
 * İstemci ayrıştırmaz; bozuksa 400 `INVALID_CURSOR` (K2).
 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(raw: string): AuditLogCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw domainError('INVALID_CURSOR', 400);
  }
  const sep = decoded.indexOf('|');
  if (sep <= 0) throw domainError('INVALID_CURSOR', 400);
  const isoPart = decoded.slice(0, sep);
  const idPart = decoded.slice(sep + 1);
  const createdAt = new Date(isoPart);
  if (Number.isNaN(createdAt.getTime())) {
    throw domainError('INVALID_CURSOR', 400);
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idPart,
    )
  ) {
    throw domainError('INVALID_CURSOR', 400);
  }
  return { createdAt, id: idPart };
}

/** `payload` JSONB kolonu; pg driver object döndürür ama defansif davran. */
function toPayloadRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toListItem(row: AuditLogRow): AuditLogListItem {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actor: {
      userId: row.actor_user_id,
      // Kullanıcı hard-delete edilmişse JOIN boş döner. `audit_logs.actor`
      // JSONB snapshot'ı ad TAŞIMAZ (writeAudit yalnız `user_agent` yazar),
      // bu yüzden fallback `null` → UI `audit.actor.unknown` basar (K6).
      displayName: row.actor_username,
      role: row.actor_role,
    },
    payload: toPayloadRecord(row.payload),
  };
}

/**
 * Query doğrulama. `validateQuery` middleware'i yerine handler içinde parse
 * edilir: ADR DoD-5 refine ihlalleri için **ayrı domain kodları** ister
 * (`ENTITY_TYPE_REQUIRED`, `INVALID_DATE_RANGE`), middleware ise hepsini tek
 * `VALIDATION_ERROR`'a düşürürdü. Tek doğrulama noktası korunur (K11.2):
 * JSON ve CSV yolları AYNI şemayı, AYNI kodlarla kullanır.
 */
function parseQuery(req: Request): {
  filters: AuditLogFilters;
  limit: number;
} {
  const parsed = AuditLogListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => i.message);
    if (messages.includes('ENTITY_TYPE_REQUIRED')) {
      throw domainError('ENTITY_TYPE_REQUIRED', 400);
    }
    if (messages.includes('INVALID_DATE_RANGE')) {
      throw domainError('INVALID_DATE_RANGE', 400);
    }
    throw domainError('VALIDATION_ERROR', 400);
  }

  const q = parsed.data;
  const filters: AuditLogFilters = {};

  if (q.from !== undefined) filters.from = new Date(q.from);
  if (q.to !== undefined) filters.to = new Date(q.to);

  // K4 — varsayılan 7 günlük pencere, ancak `entityId` verilmişse UYGULANMAZ:
  // "şu adisyonun TÜM geçmişi" senaryosu tarihe takılmamalıdır.
  if (filters.from === undefined && q.entityId === undefined) {
    filters.from = new Date(
      Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  if (q.eventType !== undefined) {
    filters.eventTypes = Array.isArray(q.eventType)
      ? q.eventType
      : [q.eventType];
  }
  if (q.entityType !== undefined) filters.entityType = q.entityType;
  if (q.entityId !== undefined) filters.entityId = q.entityId;
  if (q.actorUserId !== undefined) filters.actorUserId = q.actorUserId;
  if (q.cursor !== undefined) filters.cursor = decodeCursor(q.cursor);

  return { filters, limit: q.limit };
}

/**
 * ADR-037 K11.5 — kolon sırası KİLİTLİ.
 * `Detay` tek hücrede compact JSON'dur (69 olay × değişken payload şeması
 * sabit kolonlara açılamaz). Türkçe olay etiketi CSV'ye KONMAZ — eşleme tek
 * kaynakta (`tr.json`, K9) kalır; sunucuda ikinci kopya drift üretirdi.
 */
export function buildAuditCsvSpec(
  timezone: string,
): CsvSpec<AuditLogListPage> {
  return {
    reportName: 'audit-logs',
    toCsv: (data) => ({
      headers: [
        'Zaman',
        'Olay Kodu',
        'Kim',
        'Rol',
        'Nesne Tipi',
        'Nesne ID',
        'Detay',
      ],
      rows: data.logs.map((log) => ({
        Zaman: formatReceiptDateTime(log.createdAt, timezone),
        'Olay Kodu': log.eventType,
        // Bilinmeyen aktör metni CSV'de sabit (dosya i18n taşımaz).
        Kim: log.actor.displayName ?? 'Bilinmeyen kullanıcı',
        Rol: log.actor.role ?? '',
        'Nesne Tipi': log.entityType ?? '',
        // Dosyada UUID KISALTILMAZ (ekranda kısaltılır) — kanıt değeri.
        'Nesne ID': log.entityId ?? '',
        Detay: JSON.stringify(log.payload),
      })),
    }),
  };
}

export function auditLogsRouter(deps: AuditLogsRouterDeps): ExpressRouter {
  const router = Router();
  const repo = createAuditLogsRepository(deps.db);

  const bypassLimit =
    process.env['E2E_BYPASS_AUDIT_LIMIT'] === '1' ||
    process.env['E2E_BYPASS_AUDIT_LIMIT'] === 'true';

  const auditLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: RATE_LIMIT_PER_MINUTE,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => bypassLimit,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'AUDIT_RATE_LIMITED',
          message_key: AUTH_MESSAGE_KEYS['AUDIT_RATE_LIMITED'],
        },
      });
    },
  });

  /**
   * Tek compute fonksiyonu — JSON ve CSV yolları aynı sorguyu paylaşır.
   * CSV'de `cursor`/`limit` **yok sayılır** (K11.3): 400 atmak, mevcut sayfa
   * URL'sine `&format=csv` eklemek gibi doğal kullanımı kırardı.
   */
  const compute = async (req: Request): Promise<AuditLogListPage> => {
    const { filters, limit } = parseQuery(req);
    const tenantId = req.user!.tenantId;
    const isCsv = req.query['format'] === 'csv';

    if (isCsv) {
      const { cursor: _ignoredCursor, ...csvFilters } = filters;
      const rows = await repo.listAuditLogs(
        tenantId,
        csvFilters,
        CSV_ROW_HARD_CAP + 1,
      );
      return { logs: rows.map(toListItem), nextCursor: null, hasMore: false };
    }

    const rows = await repo.listAuditLogs(tenantId, filters, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      logs: page.map(toListItem),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor(last.created_at, last.id)
          : null,
      hasMore,
    };
  };

  const csvDeps = {
    db: deps.db,
    getTenantInfo: (tid: string) => getTenantInfo(deps.db, tid),
  };

  /**
   * `CsvSpec.toCsv` saf fonksiyondur ve tenant timezone'unu argüman olarak
   * alamaz; bu yüzden spec CSV yolunda per-request kurulur. JSON yolunda
   * ekstra DB sorgusu YAPILMAZ (spec hiç kullanılmaz).
   */
  const listHandler: RequestHandler = (req, res, next) => {
    const wantsFormat =
      typeof req.query['format'] === 'string' && req.query['format'].length > 0;
    if (!wantsFormat) {
      withCsvFormat(buildAuditCsvSpec('UTC'), compute, csvDeps)(req, res, next);
      return;
    }
    resolveTenantTimezone(deps.db, req.user!.tenantId)
      .then((tz) => {
        withCsvFormat(buildAuditCsvSpec(tz), compute, csvDeps)(req, res, next);
      })
      .catch(next);
  };

  router.get(
    '/',
    auditLimiter,
    authenticate(deps.accessSecret),
    authorize(['admin']),
    listHandler,
  );

  return router;
}
