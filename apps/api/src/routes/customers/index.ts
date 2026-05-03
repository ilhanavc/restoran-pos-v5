import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import {
  createCustomersRepository,
  RepositoryError,
  type CustomerAggregate,
  type CustomerSummary,
  type DB,
} from '@restoran-pos/db';
import {
  AddressSchema,
  BlacklistTogglePayloadSchema,
  CustomerCreateSchema,
  CustomerListQuerySchema,
  CustomerSearchQuerySchema,
  ImportCommitRequestSchema,
  ImportPreviewRequestSchema,
  type ImportPreviewRow,
  type ImportRow,
} from '@restoran-pos/shared-types';
import { z } from 'zod';
import { normalizePhoneTr } from '@restoran-pos/shared-domain';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { writeAudit } from '../../audit/writeAudit.js';
import { domainError } from '../../errors.js';

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

  // GET /customers/search?search=...&limit=20
  router.get(
    '/search',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
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
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
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

        // Repo'nun createCustomer'ı kendi içinde transaction açıyor —
        // nested transaction yasak (Kysely throws). Her satır kendi tx'inde.
        const repo = createCustomersRepository(deps.db);
        for (const item of entry.rows) {
          const src = item.source;
          const fullName = src.fullName.trim();
          const rawPhone = (src.phone ?? '').trim();
          const normalized = rawPhone ? normalizePhoneTr(rawPhone) : '';
          const addressLine = (src.address ?? '').trim();
          try {
            await repo.createCustomer(tenantId, {
              id: randomUUID(),
              fullName,
              notes: null,
              // Telefon yok veya geçersizse phones boş — kullanıcı kuralı
              // (hiçbir satır atlanmasın).
              phones:
                normalized !== ''
                  ? [{ id: randomUUID(), rawPhone, isPrimary: true }]
                  : [],
              addresses:
                addressLine.length >= 5
                  ? [
                      {
                        id: randomUUID(),
                        title: src.addressTitle?.trim() || 'Ev',
                        addressLine,
                        district: src.district?.trim() || null,
                        neighborhood: src.neighborhood?.trim() || null,
                        addressNote: src.addressNote?.trim() || null,
                        isDefault: true,
                      },
                    ]
                  : [],
            });
            created++;
          } catch (err) {
            // Phone UNIQUE conflict (duplicate normalize) — customer'ı
            // telefonsuz olarak yeniden dene (kullanıcı kuralı: atlama yok).
            if (
              err instanceof RepositoryError &&
              err.messageKey === 'PHONE_ALREADY_EXISTS'
            ) {
              try {
                await repo.createCustomer(tenantId, {
                  id: randomUUID(),
                  fullName,
                  notes: null,
                  phones: [],
                  addresses:
                    addressLine.length >= 5
                      ? [
                          {
                            id: randomUUID(),
                            title: src.addressTitle?.trim() || 'Ev',
                            addressLine,
                            district: src.district?.trim() || null,
                            neighborhood: src.neighborhood?.trim() || null,
                            addressNote: src.addressNote?.trim() || null,
                            isDefault: true,
                          },
                        ]
                      : [],
                });
                created++;
                continue;
              } catch (retryErr) {
                if (retryErr instanceof RepositoryError) {
                  errors++;
                  continue;
                }
                throw retryErr;
              }
            }
            if (err instanceof RepositoryError) {
              errors++;
              continue;
            }
            throw err;
          }
        }
        await writeAudit(deps.db, {
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

  // POST /customers
  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
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

        const aggregate = await deps.db.transaction().execute(async (trx) => {
          const repo = createCustomersRepository(trx);
          const created = await repo.createCustomer(tenantId, {
            id: customerId,
            fullName: req.body.fullName,
            notes: req.body.notes ?? null,
            phones: phonesPayload,
            addresses: addressesPayload as NonNullable<
              Parameters<typeof repo.createCustomer>[1]['addresses']
            >,
          });
          await writeAudit(trx, {
            tenantId,
            eventType: 'customer.created',
            actorUserId,
            entityType: 'customer',
            entityId: created.id,
            rawPayload: {
              customer_id: created.id,
              phones_count: created.phones.length,
              addresses_count: created.addresses.length,
            },
          });
          return created;
        });

        res
          .status(201)
          .json({ data: { customer: toCustomerResponse(aggregate) } });
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
    authorize(['admin', 'cashier']),
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
        res.status(200).json({ data: { customer: toCustomerResponse(row) } });
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
    authorize(['admin', 'cashier']),
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
          .json({ data: { customer: toCustomerResponse(updated) } });
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
          .json({ data: { customer: toCustomerResponse(updated) } });
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
    authorize(['admin', 'cashier']),
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
    authorize(['admin', 'cashier']),
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
    authorize(['admin', 'cashier']),
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
    authorize(['admin', 'cashier']),
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
    authorize(['admin', 'cashier']),
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
