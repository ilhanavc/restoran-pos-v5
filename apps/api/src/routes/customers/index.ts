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
  CustomerSearchQuerySchema,
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
