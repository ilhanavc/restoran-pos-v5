import { sql, type Selectable } from 'kysely';
import type {
  Customers,
  CustomerPhones,
  CustomerAddresses,
} from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';
import { normalizePhoneTr, isTurkishMobile } from '@restoran-pos/shared-domain';
import type { DbExecutor } from './users.js';

export type CustomerRow = Selectable<Customers>;
export type CustomerPhoneRow = Selectable<CustomerPhones>;
export type CustomerAddressRow = Selectable<CustomerAddresses>;

/**
 * Aggregated müşteri kaydı — tüm telefonlar + aktif adresler join'li.
 * Route handler `CustomerResponseSchema`'ya map eder (snake → camel).
 */
export interface CustomerAggregate extends CustomerRow {
  phones: CustomerPhoneRow[];
  addresses: CustomerAddressRow[];
}

/** Search sonucu — sadece UI'da listede gösterilen alanlar (lean). */
export interface CustomerSummary {
  id: string;
  full_name: string;
  is_blacklisted: boolean;
  total_orders: number;
  phones: { raw_phone: string; normalized_phone: string; is_primary: boolean }[];
}

export interface CustomerCreatePayload {
  id: string;
  fullName: string;
  notes?: string | null;
  phones: { id: string; rawPhone: string; isPrimary: boolean }[];
  addresses?: {
    id: string;
    title?: string;
    addressLine: string;
    district?: string | null;
    neighborhood?: string | null;
    addressNote?: string | null;
    isDefault?: boolean;
  }[];
}

export interface CustomerUpdatePayload {
  fullName?: string;
  notes?: string | null;
}

export interface AddressPayload {
  id: string;
  title?: string;
  addressLine: string;
  district?: string | null;
  neighborhood?: string | null;
  addressNote?: string | null;
  isDefault?: boolean;
}

export interface AddressUpdatePayload {
  title?: string;
  addressLine?: string;
  district?: string | null;
  neighborhood?: string | null;
  addressNote?: string | null;
  isDefault?: boolean;
}

export interface CustomersRepository {
  /**
   * Atomik müşteri yaratma — customers + customer_phones + customer_addresses
   * tek transaction. Telefonlar normalize edilir + isMobile derive edilir.
   * UNIQUE(tenant_id, normalized_phone) ihlali → RepositoryError('unique',
   * 'PHONE_ALREADY_EXISTS').
   */
  createCustomer(
    tenantId: string,
    payload: CustomerCreatePayload,
  ): Promise<CustomerAggregate>;

  getCustomerById(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerAggregate | null>;

  /**
   * Telefon prefix LIKE + isim ILIKE OR. Telefon eşleşmesi önce sıralanır
   * (relevance) — Caller ID popup'ında doğru aday üstte.
   */
  searchCustomers(
    tenantId: string,
    query: string,
    limit?: number,
  ): Promise<CustomerSummary[]>;

  updateCustomer(
    tenantId: string,
    customerId: string,
    payload: CustomerUpdatePayload,
  ): Promise<CustomerAggregate | null>;

  /**
   * Kara liste toggle. Route admin role enforce eder. `isBlacklisted=false`
   * ise reason NULL'a çekilir.
   */
  setBlacklist(
    tenantId: string,
    customerId: string,
    isBlacklisted: boolean,
    reason: string | null,
  ): Promise<CustomerAggregate | null>;

  addPhone(
    tenantId: string,
    customerId: string,
    phoneId: string,
    rawPhone: string,
    isPrimary: boolean,
  ): Promise<CustomerPhoneRow>;

  /**
   * Telefon silme. Last-phone guard: müşteride 1 telefon kalmışsa silmeyi
   * reddeder → RepositoryError('check', 'CUSTOMER_LAST_PHONE_REQUIRED').
   */
  removePhone(
    tenantId: string,
    customerId: string,
    phoneId: string,
  ): Promise<void>;

  /**
   * Yeni adres ekleme. `isDefault=true` ise diğer adresler aynı transaction
   * içinde false yapılır (mutex).
   */
  addAddress(
    tenantId: string,
    customerId: string,
    payload: AddressPayload,
  ): Promise<CustomerAddressRow>;

  /**
   * Adres güncelleme. `isDefault=true` ise diğer adresler false yapılır.
   * Sadece `is_deleted=false` adresler güncellenebilir.
   */
  updateAddress(
    tenantId: string,
    customerId: string,
    addressId: string,
    payload: AddressUpdatePayload,
  ): Promise<CustomerAddressRow | null>;

  /** Soft-delete — eski siparişlerden referans için kayıt korunur. */
  softDeleteAddress(
    tenantId: string,
    customerId: string,
    addressId: string,
  ): Promise<void>;

  /** Caller ID pipeline — incoming call lookup. */
  findCustomerByPhone(
    tenantId: string,
    normalizedPhone: string,
  ): Promise<CustomerAggregate | null>;

  /**
   * Sipariş istatistik denormalize sayaç (ADR-016 §11.2). Total amount
   * tutulmaz — yalnız total_orders++ + last_order_at = NOW.
   */
  incrementOrderStats(tenantId: string, customerId: string): Promise<void>;

  /** Admin liste — basit pagination (toplam + slice). */
  listCustomersByTenant(
    tenantId: string,
    limit: number,
    offset: number,
  ): Promise<{ customers: CustomerSummary[]; total: number }>;
}

/**
 * Customers repository. Tüm sorgular tenant-scoped + soft-delete (`deleted_at
 * IS NULL`) filtresi. Adresler ek olarak `is_deleted=false` filtresi.
 *
 * Pattern: `payments.ts` + `users.ts` aynı convention. Transaction-aware —
 * `DbExecutor` (Kysely<DB> | Transaction<DB>) ile çalışır.
 */
export function createCustomersRepository(
  db: DbExecutor,
): CustomersRepository {
  /** Müşteri + phones + addresses tek query (route response için). */
  async function loadAggregate(
    exec: DbExecutor,
    tenantId: string,
    customerId: string,
  ): Promise<CustomerAggregate | null> {
    const customer = await exec
      .selectFrom('customers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', customerId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (customer === undefined) return null;

    const phones = await exec
      .selectFrom('customer_phones')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .orderBy('is_primary', 'desc')
      .orderBy('created_at', 'asc')
      .execute();

    const addresses = await exec
      .selectFrom('customer_addresses')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .where('is_deleted', '=', false)
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'asc')
      .execute();

    return { ...customer, phones, addresses };
  }

  return {
    async createCustomer(tenantId, payload) {
      return db.transaction().execute(async (trx) => {
        try {
          await trx
            .insertInto('customers')
            .values({
              id: payload.id,
              tenant_id: tenantId,
              full_name: payload.fullName,
              note: payload.notes ?? null,
            })
            .execute();
        } catch (err) {
          const mapped = mapPgError(err);
          if (mapped !== null) throw mapped;
          throw err;
        }

        // Phones — normalize + isMobile derive. UNIQUE conflict map.
        for (const ph of payload.phones) {
          const normalized = normalizePhoneTr(ph.rawPhone);
          if (normalized === '') {
            throw new RepositoryError(
              'check',
              'PHONE_INVALID',
              `rawPhone=${ph.rawPhone}`,
            );
          }
          try {
            await trx
              .insertInto('customer_phones')
              .values({
                id: ph.id,
                tenant_id: tenantId,
                customer_id: payload.id,
                raw_phone: ph.rawPhone,
                normalized_phone: normalized,
                is_primary: ph.isPrimary,
                is_mobile: isTurkishMobile(normalized),
              })
              .execute();
          } catch (err) {
            const mapped = mapPgError(err);
            if (mapped?.cause === 'unique') {
              throw new RepositoryError(
                'unique',
                'PHONE_ALREADY_EXISTS',
                normalized,
              );
            }
            if (mapped !== null) throw mapped;
            throw err;
          }
        }

        // Addresses — is_default mutex (en fazla 1 default)
        const addresses = payload.addresses ?? [];
        let defaultSet = false;
        for (const ad of addresses) {
          const wantDefault = ad.isDefault === true && !defaultSet;
          if (wantDefault) defaultSet = true;
          await trx
            .insertInto('customer_addresses')
            .values({
              id: ad.id,
              tenant_id: tenantId,
              customer_id: payload.id,
              title: ad.title ?? 'Ev',
              address_line: ad.addressLine,
              district: ad.district ?? null,
              neighborhood: ad.neighborhood ?? null,
              address_note: ad.addressNote ?? null,
              is_default: wantDefault,
            })
            .execute();
        }

        const aggregate = await loadAggregate(trx, tenantId, payload.id);
        if (aggregate === null) {
          // Defansif — INSERT'ler başarılı, satır yok = transaction anomalisi
          throw new RepositoryError('not_found', 'CUSTOMER_CREATE_FAILED');
        }
        return aggregate;
      });
    },

    async getCustomerById(tenantId, customerId) {
      return loadAggregate(db, tenantId, customerId);
    },

    async searchCustomers(tenantId, query, limit = 20) {
      const trimmed = query.trim();
      if (trimmed === '') return [];

      const normalizedQ = normalizePhoneTr(trimmed);
      const phonePattern = `${normalizedQ}%`;
      const namePattern = `%${trimmed}%`;

      // Phone match önce sıralanır (relevance).
      const rows = await db
        .selectFrom('customers as c')
        .leftJoin('customer_phones as cp', (join) =>
          join
            .onRef('cp.customer_id', '=', 'c.id')
            .onRef('cp.tenant_id', '=', 'c.tenant_id'),
        )
        .select([
          'c.id',
          'c.full_name',
          'c.is_blacklisted',
          'c.total_orders',
          sql<number>`MAX(CASE WHEN cp.normalized_phone LIKE ${phonePattern} THEN 1 ELSE 0 END)`.as(
            'phone_match',
          ),
        ])
        .where('c.tenant_id', '=', tenantId)
        .where('c.deleted_at', 'is', null)
        .where((eb) =>
          eb.or([
            eb('cp.normalized_phone', 'like', phonePattern),
            eb('c.full_name', 'ilike', namePattern),
          ]),
        )
        .groupBy(['c.id', 'c.full_name', 'c.is_blacklisted', 'c.total_orders'])
        .orderBy('phone_match', 'desc')
        .orderBy('c.full_name', 'asc')
        .limit(limit)
        .execute();

      if (rows.length === 0) return [];

      // Phones ayrı çek — N+1 önlemek için tek query batch'le.
      const ids = rows.map((r) => r.id);
      const phones = await db
        .selectFrom('customer_phones')
        .select(['customer_id', 'raw_phone', 'normalized_phone', 'is_primary'])
        .where('tenant_id', '=', tenantId)
        .where('customer_id', 'in', ids)
        .orderBy('is_primary', 'desc')
        .execute();
      const phonesByCustomer = new Map<
        string,
        { raw_phone: string; normalized_phone: string; is_primary: boolean }[]
      >();
      for (const p of phones) {
        const arr = phonesByCustomer.get(p.customer_id) ?? [];
        arr.push({
          raw_phone: p.raw_phone,
          normalized_phone: p.normalized_phone,
          is_primary: p.is_primary,
        });
        phonesByCustomer.set(p.customer_id, arr);
      }

      return rows.map((r) => ({
        id: r.id,
        full_name: r.full_name,
        is_blacklisted: r.is_blacklisted,
        total_orders: r.total_orders,
        phones: phonesByCustomer.get(r.id) ?? [],
      }));
    },

    async updateCustomer(tenantId, customerId, payload) {
      const patch: Partial<{ full_name: string; note: string | null }> = {};
      if (payload.fullName !== undefined) patch.full_name = payload.fullName;
      if (payload.notes !== undefined) patch.note = payload.notes;

      if (Object.keys(patch).length === 0) {
        return loadAggregate(db, tenantId, customerId);
      }

      try {
        const updated = await db
          .updateTable('customers')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .where('id', '=', customerId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n) return null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
      }
      return loadAggregate(db, tenantId, customerId);
    },

    async setBlacklist(tenantId, customerId, isBlacklisted, reason) {
      const updated = await db
        .updateTable('customers')
        .set({
          is_blacklisted: isBlacklisted,
          blacklist_reason: isBlacklisted ? reason : null,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', customerId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) return null;
      return loadAggregate(db, tenantId, customerId);
    },

    async addPhone(tenantId, customerId, phoneId, rawPhone, isPrimary) {
      const normalized = normalizePhoneTr(rawPhone);
      if (normalized === '') {
        throw new RepositoryError('check', 'PHONE_INVALID', `rawPhone=${rawPhone}`);
      }
      // Müşteri varlık doğrulaması (FK violation yerine net error)
      const existsRow = await db
        .selectFrom('customers')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', customerId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (existsRow === undefined) {
        throw new RepositoryError('not_found', 'CUSTOMER_NOT_FOUND');
      }

      try {
        const row = await db
          .insertInto('customer_phones')
          .values({
            id: phoneId,
            tenant_id: tenantId,
            customer_id: customerId,
            raw_phone: rawPhone,
            normalized_phone: normalized,
            is_primary: isPrimary,
            is_mobile: isTurkishMobile(normalized),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return row;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError(
            'unique',
            'PHONE_ALREADY_EXISTS',
            normalized,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async removePhone(tenantId, customerId, phoneId) {
      return db.transaction().execute(async (trx) => {
        // Lock + count remaining phones.
        const all = await trx
          .selectFrom('customer_phones')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('customer_id', '=', customerId)
          .forUpdate()
          .execute();
        const target = all.find((p) => p.id === phoneId);
        if (target === undefined) {
          throw new RepositoryError('not_found', 'PHONE_NOT_FOUND');
        }
        if (all.length <= 1) {
          throw new RepositoryError(
            'check',
            'CUSTOMER_LAST_PHONE_REQUIRED',
            'müşteride en az 1 telefon kalmalı',
          );
        }
        await trx
          .deleteFrom('customer_phones')
          .where('tenant_id', '=', tenantId)
          .where('customer_id', '=', customerId)
          .where('id', '=', phoneId)
          .execute();
      });
    },

    async addAddress(tenantId, customerId, payload) {
      return db.transaction().execute(async (trx) => {
        // Müşteri varlığı
        const existsRow = await trx
          .selectFrom('customers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', customerId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (existsRow === undefined) {
          throw new RepositoryError('not_found', 'CUSTOMER_NOT_FOUND');
        }

        // is_default mutex — true ise diğerlerini false yap
        if (payload.isDefault === true) {
          await trx
            .updateTable('customer_addresses')
            .set({ is_default: false })
            .where('tenant_id', '=', tenantId)
            .where('customer_id', '=', customerId)
            .where('is_deleted', '=', false)
            .execute();
        }

        const row = await trx
          .insertInto('customer_addresses')
          .values({
            id: payload.id,
            tenant_id: tenantId,
            customer_id: customerId,
            title: payload.title ?? 'Ev',
            address_line: payload.addressLine,
            district: payload.district ?? null,
            neighborhood: payload.neighborhood ?? null,
            address_note: payload.addressNote ?? null,
            is_default: payload.isDefault === true,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return row;
      });
    },

    async updateAddress(tenantId, customerId, addressId, payload) {
      return db.transaction().execute(async (trx) => {
        const patch: Partial<{
          title: string;
          address_line: string;
          district: string | null;
          neighborhood: string | null;
          address_note: string | null;
          is_default: boolean;
        }> = {};
        if (payload.title !== undefined) patch.title = payload.title;
        if (payload.addressLine !== undefined)
          patch.address_line = payload.addressLine;
        if (payload.district !== undefined) patch.district = payload.district;
        if (payload.neighborhood !== undefined)
          patch.neighborhood = payload.neighborhood;
        if (payload.addressNote !== undefined)
          patch.address_note = payload.addressNote;
        if (payload.isDefault !== undefined)
          patch.is_default = payload.isDefault;

        if (payload.isDefault === true) {
          await trx
            .updateTable('customer_addresses')
            .set({ is_default: false })
            .where('tenant_id', '=', tenantId)
            .where('customer_id', '=', customerId)
            .where('id', '!=', addressId)
            .where('is_deleted', '=', false)
            .execute();
        }

        if (Object.keys(patch).length === 0) {
          const row = await trx
            .selectFrom('customer_addresses')
            .selectAll()
            .where('tenant_id', '=', tenantId)
            .where('customer_id', '=', customerId)
            .where('id', '=', addressId)
            .where('is_deleted', '=', false)
            .executeTakeFirst();
          return row ?? null;
        }

        const row = await trx
          .updateTable('customer_addresses')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .where('customer_id', '=', customerId)
          .where('id', '=', addressId)
          .where('is_deleted', '=', false)
          .returningAll()
          .executeTakeFirst();
        return row ?? null;
      });
    },

    async softDeleteAddress(tenantId, customerId, addressId) {
      await db
        .updateTable('customer_addresses')
        .set({ is_deleted: true })
        .where('tenant_id', '=', tenantId)
        .where('customer_id', '=', customerId)
        .where('id', '=', addressId)
        .execute();
    },

    async findCustomerByPhone(tenantId, normalizedPhone) {
      const phoneRow = await db
        .selectFrom('customer_phones')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('normalized_phone', '=', normalizedPhone)
        .executeTakeFirst();
      if (phoneRow === undefined) return null;
      return loadAggregate(db, tenantId, phoneRow.customer_id);
    },

    async incrementOrderStats(tenantId, customerId) {
      // ADR-016 §11.2: total_amount tutulmaz — yalnız sayaç + son sipariş tarihi.
      await db
        .updateTable('customers')
        .set({
          total_orders: sql<number>`total_orders + 1`,
          last_order_at: sql<Date>`now()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', customerId)
        .execute();
    },

    async listCustomersByTenant(tenantId, limit, offset) {
      const totalRow = await db
        .selectFrom('customers')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      const total = Number(totalRow.n);

      const rows = await db
        .selectFrom('customers')
        .select(['id', 'full_name', 'is_blacklisted', 'total_orders'])
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .orderBy('full_name', 'asc')
        .limit(limit)
        .offset(offset)
        .execute();

      if (rows.length === 0) return { customers: [], total };

      const ids = rows.map((r) => r.id);
      const phones = await db
        .selectFrom('customer_phones')
        .select(['customer_id', 'raw_phone', 'normalized_phone', 'is_primary'])
        .where('tenant_id', '=', tenantId)
        .where('customer_id', 'in', ids)
        .orderBy('is_primary', 'desc')
        .execute();
      const phonesByCustomer = new Map<
        string,
        { raw_phone: string; normalized_phone: string; is_primary: boolean }[]
      >();
      for (const p of phones) {
        const arr = phonesByCustomer.get(p.customer_id) ?? [];
        arr.push({
          raw_phone: p.raw_phone,
          normalized_phone: p.normalized_phone,
          is_primary: p.is_primary,
        });
        phonesByCustomer.set(p.customer_id, arr);
      }

      return {
        total,
        customers: rows.map((r) => ({
          id: r.id,
          full_name: r.full_name,
          is_blacklisted: r.is_blacklisted,
          total_orders: r.total_orders,
          phones: phonesByCustomer.get(r.id) ?? [],
        })),
      };
    },
  };
}
