import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import rateLimit from 'express-rate-limit';
import { sql, type Kysely } from 'kysely';
import {
  createCustomersRepository,
  mapPgError,
  RepositoryError,
  type CustomerAggregate,
  type CustomerSummary,
  type DB,
} from '@restoran-pos/db';
import {
  AddressSchema,
  BlacklistTogglePayloadSchema,
  BulkDeleteRequestSchema,
  CustomerCreateSchema,
  CustomerListQuerySchema,
  CustomerOrderHistoryQuerySchema,
  CustomerSearchQuerySchema,
  ImportCommitRequestSchema,
  ImportPreviewRequestSchema,
  type ImportPreviewRow,
  type ImportRow,
} from '@restoran-pos/shared-types';
import { z } from 'zod';
import { isTurkishMobile, normalizePhoneTr } from '@restoran-pos/shared-domain';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { writeAudit } from '../../audit/writeAudit.js';
import { logger } from '../../logger.js';
import { AUTH_MESSAGE_KEYS, domainError } from '../../errors.js';

export interface CustomersRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * snake_case repo satırını response camelCase DTO'ya dönüştürür.
 * `phones` ve `addresses` zaten ordered (primary/default first).
 */
function toCustomerResponse(row: CustomerAggregate): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    fullName: row.full_name,
    notes: row.note,
    isBlacklisted: row.is_blacklisted,
    blacklistReason: row.blacklist_reason,
    totalOrders: row.total_orders,
    lastOrderAt: row.last_order_at ? row.last_order_at.toISOString() : null,
    phones: row.phones.map((p) => ({
      rawPhone: p.raw_phone,
      normalizedPhone: p.normalized_phone,
      isPrimary: p.is_primary,
      isMobile: p.is_mobile,
    })),
    addresses: row.addresses.map((a) => ({
      id: a.id,
      title: a.title,
      addressLine: a.address_line,
      district: a.district,
      neighborhood: a.neighborhood,
      addressNote: a.address_note,
      isDefault: a.is_default,
    })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSummaryResponse(row: CustomerSummary): Record<string, unknown> {
  return {
    id: row.id,
    fullName: row.full_name,
    isBlacklisted: row.is_blacklisted,
    totalOrders: row.total_orders,
    phones: row.phones.map((p) => ({
      rawPhone: p.raw_phone,
      normalizedPhone: p.normalized_phone,
      isPrimary: p.is_primary,
    })),
  };
}

const idParamSchema = z.object({ id: z.string().uuid() });

/**
 * ADR-038 K2 — keyset cursor kodlama/çözme.
 *
 * Cursor, son satırın `(created_at, id)` çiftinin base64url kodlamasıdır.
 * İstemci için **opaktır**: içeriği sözleşme değildir, yalnız sunucu yorumlar.
 * Offset yerine keyset kullanılır çünkü araya yeni sipariş girdiğinde offset
 * sayfayı kaydırır ve aynı sipariş iki kez görünür / bir sipariş atlanır.
 */
function encodeHistoryCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString(
    'base64url',
  );
}

interface HistoryCursor {
  createdAt: Date;
  id: string;
}

/**
 * Bozuk/çözülemeyen cursor `null` döner → çağıran 400 VALIDATION_ERROR üretir.
 * Sessizce listenin başına sarmak YASAK (ADR-038 K2): kullanıcı "daha fazla"
 * derken listenin başına dönerse veri kaybı sanır.
 */
function decodeHistoryCursor(raw: string): HistoryCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.lastIndexOf('|');
  if (sep <= 0) return null;

  const isoPart = decoded.slice(0, sep);
  const idPart = decoded.slice(sep + 1);

  if (!z.string().uuid().safeParse(idPart).success) return null;

  const createdAt = new Date(isoPart);
  if (Number.isNaN(createdAt.getTime())) return null;
  // `new Date()` gevşektir ("2020-13-99" gibi girdileri toparlayabilir);
  // ISO round-trip eşitliği cursor'ın gerçekten bizim ürettiğimiz formatta
  // olduğunu doğrular.
  if (createdAt.toISOString() !== isoPart) return null;

  return { createdAt, id: idPart };
}

/** Geçmiş sorgusunun ham satır şekli (snake_case, SQL projeksiyonu). */
interface CustomerOrderHistoryRow {
  id: string;
  order_no: number;
  created_at: Date;
  store_date: string;
  order_type: 'dine_in' | 'takeaway' | 'delivery';
  status: string;
  takeaway_stage: 'preparing' | 'out_for_delivery' | 'delivered' | null;
  total_cents: number;
  item_count: number;
  items_preview: string[] | null;
}
const phoneIdParamSchema = z.object({
  id: z.string().uuid(),
  phoneId: z.string().uuid(),
});
const addressIdParamSchema = z.object({
  id: z.string().uuid(),
  addressId: z.string().uuid(),
});

const PhonePayloadSchema = z.object({
  rawPhone: z.string().min(1).max(30),
  isPrimary: z.boolean().default(false),
});

const CustomerPatchSchema = z
  .object({
    fullName: z.string().min(2).max(120).optional(),
    notes: z.string().nullable().optional(),
  })
  .refine(
    (d) => d.fullName !== undefined || d.notes !== undefined,
    { message: 'patch:empty_body' },
  );

const AddressCreateSchema = AddressSchema.omit({ id: true });
const AddressUpdateSchema = AddressSchema.omit({ id: true }).partial();

/**
 * Map repository error → HTTP domain error (cerrahi mapping).
 */
function mapCustomerRepoError(err: unknown): Error {
  if (err instanceof RepositoryError) {
    if (err.cause === 'not_found') {
      switch (err.messageKey) {
        case 'CUSTOMER_NOT_FOUND':
          return domainError('CUSTOMER_NOT_FOUND', 404);
        case 'PHONE_NOT_FOUND':
          return domainError('PHONE_NOT_FOUND', 404);
        case 'CUSTOMER_ADDRESS_NOT_FOUND':
          return domainError('CUSTOMER_ADDRESS_NOT_FOUND', 404);
        default:
          return domainError('CUSTOMER_NOT_FOUND', 404);
      }
    }
    if (err.cause === 'unique' && err.messageKey === 'PHONE_ALREADY_EXISTS') {
      return domainError('PHONE_ALREADY_EXISTS', 409);
    }
    if (err.cause === 'check') {
      if (err.messageKey === 'PHONE_INVALID') {
        return domainError('PHONE_INVALID', 400);
      }
      if (err.messageKey === 'CUSTOMER_LAST_PHONE_REQUIRED') {
        return domainError('CUSTOMER_LAST_PHONE_REQUIRED', 400);
      }
    }
  }
  return err as Error;
}

/**
 * Excel import preview cache. In-memory yeterli: tek-tenant MVP, tek API
 * instance. Multi-instance deploy'da Redis (TTL native). 15 dk TTL +
 * LRU 50 entry cap (bellek emniyeti — 10K satır × 50 ≈ 500K obje, ~100MB).
 */
interface ImportPreviewCacheEntry {
  tenantId: string;
  createdAt: number;
  rows: { preview: ImportPreviewRow; source: ImportRow }[];
}
const importPreviewCache = new Map<string, ImportPreviewCacheEntry>();
const IMPORT_PREVIEW_TTL_MS = 15 * 60 * 1000;
const IMPORT_PREVIEW_MAX_ENTRIES = 50;

/**
 * /customers — müşteri rehberi CRUD + Caller ID destek endpoint'leri.
 * ADR-016 §11.
 *
 * RBAC:
 *   - search/CRUD/phones/addresses: admin + cashier
 *   - blacklist toggle: admin only (parasal/operasyonel etki)
 *
 * PII denetimi: audit payload'larında `full_name`, telefon, adres metni
 * yazılmaz; sadece `customer_id` + sayım/changed_fields key list.
 */
export function customersRouter(deps: CustomersRouterDeps): ExpressRouter {
  const router = Router();

  // ADR-038 — `GET /:id/orders` throttle (security-reviewer HIGH bulgusu).
  // ADR-039 K4 — AYNI limiter örneği `GET /search` + `GET /` (liste) uçlarına
  // da bağlandı. ADR birebir: *"mevcut limiter altyapısı yeniden kullanılır;
  // ikinci bir limiter yazılmaz"* → yeni bir örnek/keyGenerator icat edilmedi,
  // üç uç TEK bütçeyi paylaşır. Rol-bağımsızdır (garson ve kasiyer aynı tavan,
  // K4 son maddesi). Buradaki koruma bir YETKİ aracı değil, kötüye kullanım /
  // otomasyon korumasıdır: S1=(c) ile artık tam iletişim bilgisi dönen bu
  // uçlara erişebilen kullanıcı sayısı arttı; ele geçirilmiş tek oturum tabanı
  // sayfa sayfa çekmeye kalkarsa 429'lar denetim izinde anomali olarak görünür.
  //
  // Bilinen ödünleşim (kayda geçer): sayaç IP başınadır ve restoranda tüm
  // cihazlar tek NAT arkasındadır → 60/dk tavanı işletme genelinde PAYLAŞILIR.
  // Kullanıcı-başına anahtarlama (keyGenerator) bilinçli olarak yapılmadı;
  // ADR "ikinci limiter yazılmaz" der ve bugünkü tüm limiter'lar IP-başınadır.
  // Yoğun saatte yanlış 429 gözlenirse çözüm tavanı yükseltmek (tek satır),
  // ikinci bir limiter eklemek değildir.
  //
  // Tavan 60/dk-IP — `reportsLimiter` (120/dk) ile aynı büyüklük mertebesi,
  // ama bu uç rapor panosu gibi POLL EDİLMEZ: meşru kullanım "müşteri detayı
  // açılışı 1 istek + birkaç 'daha fazla yükle'" (tipik < 10/dk, bir kasiyer
  // arka arkaya 6 müşteri açsa bile ~10). 60 meşru tavanın 6 katı headroom
  // bırakır; scripted hasat ise 1/sn'ye düşer (1469 müşteri ≈ 25 dk, denetim
  // izinde `customer.history_viewed` yığını olarak görünür).
  //
  // Limiter authenticate'ten ÖNCE: token'sız probing DB'ye vurmadan sayılır.
  // Store per-app in-memory (buildApp başına izole → test suite'leri birbirini
  // etkilemez). E2E_BYPASS: geçmiş-MANTIĞI testleri tek app'e 60+ istek atar.
  const bypassHistoryLimit =
    process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'] === '1' ||
    process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'] === 'true';
  // ADR-039 K4 — ad ADR-038'deki `customerHistoryLimiter`'dan genişletildi:
  // artık yalnız geçmiş ucunu değil, müşteri REHBERİ uçlarını da (arama +
  // sayfalı liste) kapsar. `error.code` DEĞİŞMEDİ (ADR-038 sözleşmesi + testi
  // korunur); bypass env adı da aynı kalır.
  const customerDataLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => bypassHistoryLimit,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'CUSTOMER_HISTORY_RATE_LIMITED',
          message_key: AUTH_MESSAGE_KEYS['CUSTOMER_HISTORY_RATE_LIMITED'],
        },
      });
    },
  });

  // GET /customers/search?search=...&limit=20
  // RBAC: admin + cashier + waiter (ADR-039 K2 — kasiyer paritesi).
  router.get(
    '/search',
    customerDataLimiter,
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    validateQuery(CustomerSearchQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const repo = createCustomersRepository(deps.db);
        const query = req.query as unknown as { search: string; limit: number };
        const rows = await repo.searchCustomers(
          tenantId,
          query.search,
          query.limit,
        );
        res
          .status(200)
          .json({ data: { customers: rows.map(toSummaryResponse) } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  // GET /customers — paginated full list (admin yönetim ekranı)
  // RBAC: admin + cashier + waiter (ADR-039 K2 — kasiyer paritesi).
  router.get(
    '/',
    customerDataLimiter,
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    validateQuery(CustomerListQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const query = req.query as unknown as { page: number; limit: number };
        const offset = (query.page - 1) * query.limit;
        const repo = createCustomersRepository(deps.db);
        const result = await repo.listCustomersByTenant(
          tenantId,
          query.limit,
          offset,
        );
        res.status(200).json({
          data: {
            customers: result.customers.map(toSummaryResponse),
            page: query.page,
            limit: query.limit,
            total: result.total,
          },
        });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  // ─── Excel import (preview → commit) ───────────────────────────────────
  // In-memory cache; tek-tenant MVP için yeterli. Multi-instance deploy'da
  // Redis'e taşınır. Token TTL 15 dk, üst sınır 50 aktif preview.
  router.post(
    '/import/preview',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(ImportPreviewRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const rows = req.body.rows as ImportRow[];
        const repo = createCustomersRepository(deps.db);

        // 1) Telefon prefix index (mevcut kayıtlar) — tüm normalized phones
        // tek query; 10K satıra kadar OK (ilk MVP).
        const existingPhones = await deps.db
          .selectFrom('customer_phones')
          .select(['customer_id', 'normalized_phone'])
          .where('tenant_id', '=', tenantId)
          .execute();
        const phoneIndex = new Map<string, string>();
        for (const p of existingPhones) {
          phoneIndex.set(p.normalized_phone, p.customer_id);
        }

        // 2) Satır satır validate + dedupe
        const previewRows: ImportPreviewRow[] = [];
        const seenInFile = new Set<string>();
        let willCreate = 0;
        let willSkip = 0;

        for (const row of rows) {
          const fullName = row.fullName.trim();
          if (fullName.length < 2) {
            previewRows.push({
              rowNumber: row.rowNumber,
              fullName,
              status: 'skip',
              reason: 'shortName',
            });
            willSkip++;
            continue;
          }
          const rawPhone = row.phone?.trim() ?? '';
          // Kullanıcı kuralı (Amendment): hiçbir satır atlanmasın — telefon yoksa
          // veya geçersizse customer yine de oluşur (telefon kaydı atlanır).
          // Sadece gerçek hatalar atlar: duplicate (DB veya file içi).
          const normalized = rawPhone ? normalizePhoneTr(rawPhone) : '';
          // Kullanıcı kuralı: hiçbir satır atlanmaz. Duplicate telefonlar
          // commit tarafında "phone INSERT skip" ile customer kaydı yine
          // oluşur (telefon başka müşteride kalır).
          if (normalized !== '') seenInFile.add(normalized);
          previewRows.push({
            rowNumber: row.rowNumber,
            fullName,
            status: 'create',
            normalizedPhone: normalized || undefined,
          });
          willCreate++;
        }

        // 3) Token cache
        const previewToken = randomUUID();
        const willCreateRows = previewRows
          .filter((p) => p.status === 'create')
          .map((p) => {
            const src = rows.find((r) => r.rowNumber === p.rowNumber)!;
            return { preview: p, source: src };
          });
        importPreviewCache.set(previewToken, {
          tenantId,
          createdAt: Date.now(),
          rows: willCreateRows,
        });

        // Lazy GC eski entries
        for (const [tk, entry] of importPreviewCache.entries()) {
          if (Date.now() - entry.createdAt > IMPORT_PREVIEW_TTL_MS) {
            importPreviewCache.delete(tk);
          }
        }
        // LRU cap
        while (importPreviewCache.size > IMPORT_PREVIEW_MAX_ENTRIES) {
          const oldestKey = importPreviewCache.keys().next().value;
          if (oldestKey === undefined) break;
          importPreviewCache.delete(oldestKey);
        }

        // Repo unused warning kaçınma
        void repo;

        res.status(200).json({
          data: {
            previewToken,
            summary: { total: rows.length, willCreate, willSkip },
            rows: previewRows,
          },
        });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    '/import/commit',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(ImportCommitRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const previewToken = req.body.previewToken as string;
        const entry = importPreviewCache.get(previewToken);
        if (entry === undefined) {
          return next(domainError('IMPORT_PREVIEW_NOT_FOUND', 404));
        }
        if (entry.tenantId !== tenantId) {
          return next(domainError('IMPORT_PREVIEW_FORBIDDEN', 403));
        }
        if (Date.now() - entry.createdAt > IMPORT_PREVIEW_TTL_MS) {
          importPreviewCache.delete(previewToken);
          return next(domainError('IMPORT_PREVIEW_EXPIRED', 410));
        }

        let created = 0;
        let errors = 0;

        // Tek transaction içinde inline INSERT — repo'nun nested tx'i yerine
        // hızlı toplu işlem (1394 satır × tek connection). Phone UNIQUE
        // collision'da o satırın phone'u atlanır, customer kaydı yine atılır.
        const seenPhones = new Set<string>();
        await deps.db.transaction().execute(async (trx) => {
          for (const item of entry.rows) {
            const src = item.source;
            const fullName = src.fullName.trim();
            const rawPhone = (src.phone ?? '').trim();
            const normalized = rawPhone ? normalizePhoneTr(rawPhone) : '';
            const addressLine = (src.address ?? '').trim();
            const customerId = randomUUID();
            try {
              await trx
                .insertInto('customers')
                .values({
                  id: customerId,
                  tenant_id: tenantId,
                  full_name: fullName,
                  note: null,
                })
                .execute();

              if (normalized !== '' && !seenPhones.has(normalized)) {
                try {
                  await trx
                    .insertInto('customer_phones')
                    .values({
                      id: randomUUID(),
                      tenant_id: tenantId,
                      customer_id: customerId,
                      raw_phone: rawPhone,
                      normalized_phone: normalized,
                      is_primary: true,
                      is_mobile: isTurkishMobile(normalized),
                    })
                    .execute();
                  seenPhones.add(normalized);
                } catch (phoneErr) {
                  // UNIQUE conflict — phone başka müşteriye ait. Customer kaydı
                  // duruyor; bu satır telefonsuz oluşur (kullanıcı kuralı).
                  const mapped = mapPgError(phoneErr);
                  if (mapped?.cause !== 'unique') throw phoneErr;
                }
              }

              if (addressLine.length >= 5) {
                await trx
                  .insertInto('customer_addresses')
                  .values({
                    id: randomUUID(),
                    tenant_id: tenantId,
                    customer_id: customerId,
                    title: src.addressTitle?.trim() || 'Ev',
                    address_line: addressLine,
                    district: src.district?.trim() || null,
                    neighborhood: src.neighborhood?.trim() || null,
                    address_note: src.addressNote?.trim() || null,
                    is_default: true,
                  })
                  .execute();
              }
              created++;
            } catch (err) {
              errors++;
              // Hata sayılır ama transaction abort olmaz — bireysel satır
              // başarısızlığı kalanları engellemesin.
            }
          }
          await writeAudit(trx, {
            tenantId,
            eventType: 'customer_import.completed',
            actorUserId,
            entityType: 'customer',
            rawPayload: {
              total_rows: entry.rows.length,
              created,
              errors,
              preview_token: previewToken,
            },
          });
        });

        importPreviewCache.delete(previewToken);

        res.status(200).json({
          data: {
            created,
            skipped: 0,
            errors,
          },
        });
        return;
      } catch (err) {
        return next(mapCustomerRepoError(err));
      }
    },
  );

  // GET /customers/export — admin tüm rehberi indirir (CSV bridge JSON)
  router.get(
    '/export',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;

        const customers = await deps.db
          .selectFrom('customers')
          .select([
            'id',
            'full_name',
            'is_blacklisted',
            'total_orders',
            'created_at',
          ])
          .where('tenant_id', '=', tenantId)
          .where('deleted_at', 'is', null)
          .orderBy('full_name', 'asc')
          .execute();

        const ids = customers.map((c) => c.id);
        const phones =
          ids.length === 0
            ? []
            : await deps.db
                .selectFrom('customer_phones')
                .select([
                  'customer_id',
                  'normalized_phone',
                  'raw_phone',
                  'is_primary',
                ])
                .where('tenant_id', '=', tenantId)
                .where('customer_id', 'in', ids)
                .orderBy('is_primary', 'desc')
                .execute();
        const addresses =
          ids.length === 0
            ? []
            : await deps.db
                .selectFrom('customer_addresses')
                .select([
                  'customer_id',
                  'address_line',
                  'district',
                  'neighborhood',
                  'is_default',
                ])
                .where('tenant_id', '=', tenantId)
                .where('customer_id', 'in', ids)
                .where('is_deleted', '=', false)
                .orderBy('is_default', 'desc')
                .execute();

        const phonesByCustomer = new Map<
          string,
          { normalized: string; isPrimary: boolean }[]
        >();
        for (const p of phones) {
          const arr = phonesByCustomer.get(p.customer_id) ?? [];
          arr.push({ normalized: p.normalized_phone, isPrimary: p.is_primary });
          phonesByCustomer.set(p.customer_id, arr);
        }
        const addressesByCustomer = new Map<string, string[]>();
        for (const a of addresses) {
          const arr = addressesByCustomer.get(a.customer_id) ?? [];
          const parts = [a.address_line];
          if (a.neighborhood !== null) parts.push(a.neighborhood);
          if (a.district !== null) parts.push(a.district);
          arr.push(parts.join(', '));
          addressesByCustomer.set(a.customer_id, arr);
        }

        const exportRows = customers.map((c) => {
          const cps = phonesByCustomer.get(c.id) ?? [];
          const primary = cps.find((p) => p.isPrimary) ?? cps[0];
          return {
            id: c.id,
            fullName: c.full_name,
            phones: cps.map((p) => p.normalized),
            primaryPhone: primary?.normalized ?? null,
            addresses: addressesByCustomer.get(c.id) ?? [],
            totalOrders: c.total_orders,
            isBlacklisted: c.is_blacklisted,
            createdAt: c.created_at.toISOString(),
          };
        });

        await writeAudit(deps.db, {
          tenantId,
          eventType: 'customer_export.completed',
          actorUserId,
          entityType: 'customer',
          rawPayload: { rows_count: exportRows.length, format: 'json' },
        });

        res
          .status(200)
          .json({ data: { customers: exportRows, total: exportRows.length } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  // GET /customers/ids — frontend "tümünü seç" için tüm tenant id list.
  // PII değil (UUID), admin+cashier okur.
  router.get(
    '/ids',
    authenticate(deps.accessSecret),
    // ADR-039 K2 — kasiyer paritesi: garson müşteri alanında kasiyerin
    // yapabildiği her şeyi yapar. `['admin']`-only uçlar (import/export/bulk/
    // blacklist) DOKUNULMADAN kalır (K2.3).
    authorize(['admin', 'cashier', 'waiter']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const repo = createCustomersRepository(deps.db);
        const ids = await repo.listAllCustomerIds(tenantId);
        res.status(200).json({ data: { ids } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  // DELETE /customers/bulk — admin only, HARD DELETE.
  // Route MUST be declared before `/:id` matchers; aksi halde 'bulk' literal
  // uuid-param sanılır.
  router.delete(
    '/bulk',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(BulkDeleteRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const customerIds = req.body.customerIds as string[];

        const repo = createCustomersRepository(deps.db);
        const deleted = await repo.bulkDelete(tenantId, customerIds);

        await writeAudit(deps.db, {
          tenantId,
          eventType: 'customer.bulk_deleted',
          actorUserId,
          entityType: 'customer',
          rawPayload: {
            ids_count: deleted,
            requested_count: customerIds.length,
          },
        });

        res.status(200).json({ data: { deleted } });
        return;
      } catch (err) {
        return next(mapCustomerRepoError(err));
      }
    },
  );

  // POST /customers
  router.post(
    '/',
    authenticate(deps.accessSecret),
    // ADR-039 K2 — kasiyer paritesi: garson müşteri alanında kasiyerin
    // yapabildiği her şeyi yapar. `['admin']`-only uçlar (import/export/bulk/
    // blacklist) DOKUNULMADAN kalır (K2.3).
    authorize(['admin', 'cashier', 'waiter']),
    validateBody(CustomerCreateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;

        // Defansif: en az 1 telefon zod refine ile garantili; yine de normalize
        // boş gelirse erken 400 döneriz.
        for (const ph of req.body.phones) {
          if (normalizePhoneTr(ph.rawPhone) === '') {
            return next(domainError('INVALID_PHONE', 400));
          }
        }

        const customerId = randomUUID();
        const phonesPayload = req.body.phones.map(
          (p: { rawPhone: string; isPrimary: boolean }) => ({
            id: randomUUID(),
            rawPhone: p.rawPhone,
            isPrimary: p.isPrimary,
          }),
        );
        const addressesPayload = (req.body.addresses ?? []).map(
          (a: Record<string, unknown>) => ({ id: randomUUID(), ...a }),
        );

        // Repo createCustomer kendi içinde transaction açar — dış tx ile
        // sarmak nested transaction hatası verir. Audit ayrı çağrı.
        const repo = createCustomersRepository(deps.db);
        const aggregate = await repo.createCustomer(tenantId, {
          id: customerId,
          fullName: req.body.fullName,
          notes: req.body.notes ?? null,
          phones: phonesPayload,
          addresses: addressesPayload as NonNullable<
            Parameters<typeof repo.createCustomer>[1]['addresses']
          >,
        });
        await writeAudit(deps.db, {
          tenantId,
          eventType: 'customer.created',
          actorUserId,
          entityType: 'customer',
          entityId: aggregate.id,
          rawPayload: {
            customer_id: aggregate.id,
            phones_count: aggregate.phones.length,
            addresses_count: aggregate.addresses.length,
          },
        });

        res
          .status(201)
          .json({ data: toCustomerResponse(aggregate) });
        return;
      } catch (err) {
        return next(mapCustomerRepoError(err));
      }
    },
  );

  // GET /customers/:id
  router.get(
    '/:id',
    authenticate(deps.accessSecret),
    // ADR-039 K2 — kasiyer paritesi: garson müşteri alanında kasiyerin
    // yapabildiği her şeyi yapar. `['admin']`-only uçlar (import/export/bulk/
    // blacklist) DOKUNULMADAN kalır (K2.3).
    authorize(['admin', 'cashier', 'waiter']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) return next(params.error);

        const repo = createCustomersRepository(deps.db);
        const row = await repo.getCustomerById(
          req.user!.tenantId,
          params.data.id,
        );
        if (row === null) return next(domainError('CUSTOMER_NOT_FOUND', 404));
        res.status(200).json({ data: toCustomerResponse(row) });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  // GET /customers/:id/orders — müşteri sipariş geçmişi (ADR-038)
  //
  // Amaca özel OKUMA ucu. `GET /orders`'a `customerId` filtresi bilinçli olarak
  // EKLENMEDİ (ADR-038 K1.2): o uç bir "pano" ucudur — varsayılanı bugündür,
  // garson ABAC'ı yalnız AÇIK adisyonları gösterir ve sayfalaması yoktur;
  // geçmiş ise gün-bağımsız, KAPALI siparişleri de içeren, sayfalı bir listedir.
  //
  // RBAC: admin + cashier + waiter (ADR-038 K5 / ADR-039 K2 cashier-paritesi).
  // `kitchen` HARİÇ — mutfak terminalinin müşteri verisiyle işi yoktur.
  router.get(
    '/:id/orders',
    customerDataLimiter,
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) return next(params.error);

        // Query BURADA parse edilir, `validateQuery` ile DEĞİL: Express 5'te
        // `req.query` bir getter'dır ve middleware'deki `Object.assign` ile
        // yazılan zod DEFAULT'ları (limit=10) handler'a ulaşmaz → `limit`
        // `undefined` kalır ve `LIMIT NaN` ile 500 üretirdi.
        const parsedQuery = CustomerOrderHistoryQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) return next(parsedQuery.error);

        const tenantId = req.user!.tenantId;
        const customerId = params.data.id;
        const query = parsedQuery.data;

        // Müşteri varlık + tenant + soft-delete kontrolü. Cross-tenant ve
        // silinmiş müşteri de 404 döner — enumeration sızdırmamak için ayrı
        // bir hata kodu üretilmez (ADR-038 K1.3, mevcut CUSTOMER_NOT_FOUND).
        const customer = await deps.db
          .selectFrom('customers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', customerId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (customer === undefined) {
          return next(domainError('CUSTOMER_NOT_FOUND', 404));
        }

        let cursor: HistoryCursor | null = null;
        if (query.cursor !== undefined) {
          cursor = decodeHistoryCursor(query.cursor);
          if (cursor === null) {
            return next(domainError('VALIDATION_ERROR', 400));
          }
        }

        // `limit + 1` çekilir: fazladan satır gelirse bir sonraki sayfa VAR
        // demektir. Ayrı bir COUNT(*) sorgusu yapılmaz (ikinci round-trip +
        // büyük müşterilerde gereksiz tam tarama).
        const fetchLimit = query.limit + 1;

        // Tek round-trip. `page` CTE'si önce keyset ile sayfayı daraltır
        // (orders_tenant_customer_created_idx tam karşılar), lateral'ler
        // yalnız o ≤51 satır için çalışır → N+1 YOK (ADR-038 K3/K9).
        const historyQuery = sql<CustomerOrderHistoryRow>`
          WITH page AS (
            SELECT
              o.id, o.order_no, o.created_at, o.store_date,
              o.order_type, o.status, o.takeaway_stage, o.total_cents
            FROM orders o
            WHERE o.tenant_id = ${tenantId}
              AND o.customer_id = ${customerId}
              ${
                cursor === null
                  ? sql``
                  : sql`AND (o.created_at, o.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
              }
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT ${fetchLimit}
          )
          SELECT
            p.id,
            p.order_no,
            p.created_at,
            to_char(p.store_date, 'YYYY-MM-DD') AS store_date,
            p.order_type,
            p.status,
            p.takeaway_stage,
            p.total_cents,
            COALESCE(cnt.item_count, 0) AS item_count,
            pv.names AS items_preview
          FROM page p
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS item_count
            FROM order_items oi
            WHERE oi.order_id = p.id
              AND oi.tenant_id = ${tenantId}
              AND oi.status <> 'cancelled'
          ) cnt ON TRUE
          LEFT JOIN LATERAL (
            SELECT array_agg(x.product_name) AS names
            FROM (
              SELECT oi.product_name
              FROM order_items oi
              WHERE oi.order_id = p.id
                AND oi.tenant_id = ${tenantId}
                AND oi.status <> 'cancelled'
              ORDER BY oi.created_at ASC, oi.id ASC
              LIMIT 3
            ) x
          ) pv ON TRUE
          ORDER BY p.created_at DESC, p.id DESC
        `;

        const result = await historyQuery.execute(deps.db);
        const rows = result.rows;

        const hasMore = rows.length > query.limit;
        const pageRows = hasMore ? rows.slice(0, query.limit) : rows;

        const items = pageRows.map((row) => ({
          id: row.id,
          orderNo: row.order_no,
          createdAt: row.created_at.toISOString(),
          storeDate: row.store_date,
          orderType: row.order_type,
          status: row.status,
          takeawayStage: row.takeaway_stage,
          totalCents: row.total_cents,
          itemCount: row.item_count,
          itemsPreview: row.items_preview ?? [],
        }));

        // PII yok: projeksiyon müşteri telefonu/adresi TAŞIMAZ (ADR-038 K3) —
        // çağıran zaten o müşterinin bağlamındadır.
        const lastRow = pageRows.at(-1);
        const nextCursor =
          hasMore && lastRow !== undefined
            ? encodeHistoryCursor(lastRow.created_at, lastRow.id)
            : null;

        // KVKK m.12 — PII OKUMA denetimi (security-reviewer HIGH bulgusu).
        // Bu uç `waiter` dahil herkese herhangi bir müşterinin harcama
        // geçmişini açar (ADR-039 S1=(c)); erişimi meşrulaştıran tek kontrol
        // "kim, ne zaman, kimin geçmişine baktı" izidir. Yanıt GÖNDERİLDİKTEN
        // sonra yazılır: denetim INSERT'i patlarsa sipariş akışını gören
        // kullanıcı hata görmemeli (ADR-038 K7.5 — geçmiş bir kolaylıktır),
        // ama iz kaybı sessiz kalmasın diye logger.error ile raporlanır.
        res.status(200).json({ data: { items, nextCursor } });

        try {
          await writeAudit(deps.db, {
            tenantId,
            eventType: 'customer.history_viewed',
            actorUserId: req.user!.userId,
            entityType: 'customer',
            entityId: customerId,
            rawPayload: {
              customer_id: customerId,
              items_count: items.length,
              paged: cursor !== null,
            },
          });
        } catch (auditErr) {
          logger.error(
            { err: auditErr, customerId },
            'customer.history_viewed audit write failed',
          );
        }
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  // PATCH /customers/:id
  router.patch(
    '/:id',
    authenticate(deps.accessSecret),
    // ADR-039 K2 — kasiyer paritesi: garson müşteri alanında kasiyerin
    // yapabildiği her şeyi yapar. `['admin']`-only uçlar (import/export/bulk/
    // blacklist) DOKUNULMADAN kalır (K2.3).
    authorize(['admin', 'cashier', 'waiter']),
    validateBody(CustomerPatchSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) return next(params.error);

        const tenantId = req.user!.tenantId;
        const customerId = params.data.id;
        const actorUserId = req.user!.userId;

        const updated = await deps.db.transaction().execute(async (trx) => {
          const repo = createCustomersRepository(trx);
          const after = await repo.updateCustomer(tenantId, customerId, {
            fullName: req.body.fullName,
            notes: req.body.notes,
          });
          if (after === null) {
            throw domainError('CUSTOMER_NOT_FOUND', 404);
          }
          const changedFields = Object.keys(req.body as Record<string, unknown>);
          await writeAudit(trx, {
            tenantId,
            eventType: 'customer.updated',
            actorUserId,
            entityType: 'customer',
            entityId: customerId,
            rawPayload: {
              customer_id: customerId,
              changed_fields: changedFields,
              phones_count: after.phones.length,
              addresses_count: after.addresses.length,
            },
          });
          return after;
        });

        res
          .status(200)
          .json({ data: toCustomerResponse(updated) });
        return;
      } catch (err) {
        return next(mapCustomerRepoError(err));
      }
    },
  );

  // PATCH /customers/:id/blacklist  (admin only)
  router.patch(
    '/:id/blacklist',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(BlacklistTogglePayloadSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) return next(params.error);

        const tenantId = req.user!.tenantId;
        const customerId = params.data.id;
        const actorUserId = req.user!.userId;
        const isBlacklisted = req.body.isBlacklisted as boolean;
        const reason: string | null = isBlacklisted
          ? (req.body.blacklistReason as string)
          : null;

        const updated = await deps.db.transaction().execute(async (trx) => {
          const repo = createCustomersRepository(trx);
          const after = await repo.setBlacklist(
            tenantId,
            customerId,
            isBlacklisted,
            reason,
          );
          if (after === null) {
            throw domainError('CUSTOMER_NOT_FOUND', 404);
          }
          if (isBlacklisted) {
            await writeAudit(trx, {
              tenantId,
              eventType: 'customer.blacklisted',
              actorUserId,
              entityType: 'customer',
              entityId: customerId,
              rawPayload: {
                customer_id: customerId,
                reason_length: reason !== null ? reason.length : 0,
              },
            });
          } else {
            await writeAudit(trx, {
              tenantId,
              eventType: 'customer.unblacklisted',
              actorUserId,
              entityType: 'customer',
              entityId: customerId,
              rawPayload: { customer_id: customerId },
            });
          }
          return after;
        });

        res
          .status(200)
          .json({ data: toCustomerResponse(updated) });
        return;
      } catch (err) {
        return next(mapCustomerRepoError(err));
      }
    },
  );

  // POST /customers/:id/phones
  router.post(
    '/:id/phones',
    authenticate(deps.accessSecret),
    // ADR-039 K2 — kasiyer paritesi: garson müşteri alanında kasiyerin
    // yapabildiği her şeyi yapar. `['admin']`-only uçlar (import/export/bulk/
    // blacklist) DOKUNULMADAN kalır (K2.3).
    authorize(['admin', 'cashier', 'waiter']),
    validateBody(PhonePayloadSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) return next(params.error);

        const tenantId = req.user!.tenantId;
        const customerId = params.data.id;
        const phoneId = randomUUID();
        const repo = createCustomersRepository(deps.db);
        const row = await repo.addPhone(
          tenantId,
          customerId,
          phoneId,
          req.body.rawPhone,
          req.body.isPrimary === true,
        );
        res.status(201).json({
          data: {
            phone: {
              id: row.id,
              rawPhone: row.raw_phone,
              normalizedPhone: row.normalized_phone,
              isPrimary: row.is_primary,
              isMobile: row.is_mobile,
            },
          },
        });
        return;
      } catch (err) {
        return next(mapCustomerRepoError(err));
      }
    },
  );

  // DELETE /customers/:id/phones/:phoneId
  router.delete(
    '/:id/phones/:phoneId',
    authenticate(deps.accessSecret),
    // ADR-039 K2 — kasiyer paritesi: garson müşteri alanında kasiyerin
    // yapabildiği her şeyi yapar. `['admin']`-only uçlar (import/export/bulk/
    // blacklist) DOKUNULMADAN kalır (K2.3).
    authorize(['admin', 'cashier', 'waiter']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = phoneIdParamSchema.safeParse(req.params);
        if (!params.success) return next(params.error);

        const repo = createCustomersRepository(deps.db);
        await repo.removePhone(
          req.user!.tenantId,
          params.data.id,
          params.data.phoneId,
        );
        res.status(204).end();
        return;
      } catch (err) {
        return next(mapCustomerRepoError(err));
      }
    },
  );

  // POST /customers/:id/addresses
  router.post(
    '/:id/addresses',
    authenticate(deps.accessSecret),
    // ADR-039 K2 — kasiyer paritesi: garson müşteri alanında kasiyerin
    // yapabildiği her şeyi yapar. `['admin']`-only uçlar (import/export/bulk/
    // blacklist) DOKUNULMADAN kalır (K2.3).
    authorize(['admin', 'cashier', 'waiter']),
    validateBody(AddressCreateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) return next(params.error);

        const repo = createCustomersRepository(deps.db);
        const row = await repo.addAddress(req.user!.tenantId, params.data.id, {
          id: randomUUID(),
          title: req.body.title,
          addressLine: req.body.addressLine,
          district: req.body.district ?? null,
          neighborhood: req.body.neighborhood ?? null,
          addressNote: req.body.addressNote ?? null,
          isDefault: req.body.isDefault === true,
        });
        res.status(201).json({
          data: {
            address: {
              id: row.id,
              title: row.title,
              addressLine: row.address_line,
              district: row.district,
              neighborhood: row.neighborhood,
              addressNote: row.address_note,
              isDefault: row.is_default,
            },
          },
        });
        return;
      } catch (err) {
        return next(mapCustomerRepoError(err));
      }
    },
  );

  // PATCH /customers/:id/addresses/:addressId
  router.patch(
    '/:id/addresses/:addressId',
    authenticate(deps.accessSecret),
    // ADR-039 K2 — kasiyer paritesi: garson müşteri alanında kasiyerin
    // yapabildiği her şeyi yapar. `['admin']`-only uçlar (import/export/bulk/
    // blacklist) DOKUNULMADAN kalır (K2.3).
    authorize(['admin', 'cashier', 'waiter']),
    validateBody(AddressUpdateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = addressIdParamSchema.safeParse(req.params);
        if (!params.success) return next(params.error);

        const repo = createCustomersRepository(deps.db);
        const row = await repo.updateAddress(
          req.user!.tenantId,
          params.data.id,
          params.data.addressId,
          {
            ...(req.body.title !== undefined ? { title: req.body.title } : {}),
            ...(req.body.addressLine !== undefined
              ? { addressLine: req.body.addressLine }
              : {}),
            ...(req.body.district !== undefined
              ? { district: req.body.district }
              : {}),
            ...(req.body.neighborhood !== undefined
              ? { neighborhood: req.body.neighborhood }
              : {}),
            ...(req.body.addressNote !== undefined
              ? { addressNote: req.body.addressNote }
              : {}),
            ...(req.body.isDefault !== undefined
              ? { isDefault: req.body.isDefault }
              : {}),
          },
        );
        if (row === null) {
          return next(domainError('CUSTOMER_ADDRESS_NOT_FOUND', 404));
        }
        res.status(200).json({
          data: {
            address: {
              id: row.id,
              title: row.title,
              addressLine: row.address_line,
              district: row.district,
              neighborhood: row.neighborhood,
              addressNote: row.address_note,
              isDefault: row.is_default,
            },
          },
        });
        return;
      } catch (err) {
        return next(mapCustomerRepoError(err));
      }
    },
  );

  // DELETE /customers/:id/addresses/:addressId
  router.delete(
    '/:id/addresses/:addressId',
    authenticate(deps.accessSecret),
    // ADR-039 K2 — kasiyer paritesi: garson müşteri alanında kasiyerin
    // yapabildiği her şeyi yapar. `['admin']`-only uçlar (import/export/bulk/
    // blacklist) DOKUNULMADAN kalır (K2.3).
    authorize(['admin', 'cashier', 'waiter']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const params = addressIdParamSchema.safeParse(req.params);
        if (!params.success) return next(params.error);

        const repo = createCustomersRepository(deps.db);
        await repo.softDeleteAddress(
          req.user!.tenantId,
          params.data.id,
          params.data.addressId,
        );
        res.status(204).end();
        return;
      } catch (err) {
        return next(mapCustomerRepoError(err));
      }
    },
  );

  return router;
}
