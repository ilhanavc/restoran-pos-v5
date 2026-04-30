import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import {
  createAttributeGroupsRepository,
  createAttributeOptionsRepository,
  type DB,
  type AttributeOptionRow,
} from '@restoran-pos/db';
import type {
  AttributeOptionCreateRequest,
  AttributeOptionUpdateRequest,
} from '@restoran-pos/shared-types';
import { writeAudit } from '../../audit/writeAudit.js';
import { AuthError, AUTH_MESSAGE_KEYS } from '../../errors.js';

/**
 * ADR-012 Karar 7: is_default validation application-level.
 *
 * Tekli grup'ta (selection_type='single') aynı grupta birden fazla
 * is_default=true reddedilir → 422 ATTRIBUTE_OPTION_DEFAULT_INVALID.
 * Çoklu grup'ta birden fazla default izinli.
 *
 * Race condition: aynı transaction içinde countDefaultsInGroup + INSERT
 * sıralı; iki paralel POST yarış halinde sonuncu count=1 görür ve hata
 * dönmek yerine race ile 2 default oluşabilir. v5.1 borç (advisory lock
 * veya partial UNIQUE constraint).
 */
export class AttributeOptionService {
  constructor(private readonly db: Kysely<DB>) {}

  async createOption(params: {
    tenantId: string;
    groupId: string;
    actorUserId: string;
    req: AttributeOptionCreateRequest;
  }): Promise<AttributeOptionRow> {
    const { tenantId, groupId, actorUserId, req } = params;
    return await this.db.transaction().execute(async (trx) => {
      const groups = createAttributeGroupsRepository(trx);
      const options = createAttributeOptionsRepository(trx);

      const group = await groups.findById(tenantId, groupId);
      if (group === null) {
        throw new AuthError(
          'ATTRIBUTE_GROUP_NOT_FOUND',
          AUTH_MESSAGE_KEYS['ATTRIBUTE_GROUP_NOT_FOUND'] ?? 'error.internal',
          404,
        );
      }

      if (group.selection_type === 'single' && req.isDefault === true) {
        const count = await options.countDefaultsInGroup(tenantId, groupId);
        if (count > 0) {
          throw new AuthError(
            'ATTRIBUTE_OPTION_DEFAULT_INVALID',
            AUTH_MESSAGE_KEYS['ATTRIBUTE_OPTION_DEFAULT_INVALID'] ?? 'error.internal',
            422,
          );
        }
      }

      const id = randomUUID();
      const row = await options.create(tenantId, groupId, {
        id,
        name: req.name,
        extraPriceCents: req.extraPriceCents,
        isDefault: req.isDefault,
        sortOrder: req.sortOrder,
      });

      await writeAudit(trx, {
        tenantId,
        eventType: 'attribute_option.created',
        actorUserId,
        entityType: 'attribute_option',
        entityId: id,
        rawPayload: {
          groupId,
          optionId: id,
          name: req.name,
          extraPriceCents: req.extraPriceCents ?? 0,
          isDefault: req.isDefault ?? false,
          sortOrder: req.sortOrder ?? 0,
        },
      });
      return row;
    });
  }

  async updateOption(params: {
    tenantId: string;
    optionId: string;
    actorUserId: string;
    req: AttributeOptionUpdateRequest;
  }): Promise<AttributeOptionRow> {
    const { tenantId, optionId, actorUserId, req } = params;
    return await this.db.transaction().execute(async (trx) => {
      const groups = createAttributeGroupsRepository(trx);
      const options = createAttributeOptionsRepository(trx);

      const existing = await options.findById(tenantId, optionId);
      if (existing === null) {
        throw new AuthError(
          'ATTRIBUTE_OPTION_NOT_FOUND',
          AUTH_MESSAGE_KEYS['ATTRIBUTE_OPTION_NOT_FOUND'] ?? 'error.internal',
          404,
        );
      }

      if (req.isDefault === true) {
        const group = await groups.findById(tenantId, existing.group_id);
        if (group !== null && group.selection_type === 'single') {
          const count = await options.countDefaultsInGroup(
            tenantId,
            existing.group_id,
            optionId,
          );
          if (count > 0) {
            throw new AuthError(
              'ATTRIBUTE_OPTION_DEFAULT_INVALID',
              AUTH_MESSAGE_KEYS['ATTRIBUTE_OPTION_DEFAULT_INVALID'] ?? 'error.internal',
              422,
            );
          }
        }
      }

      const patch: Parameters<typeof options.update>[2] = {};
      if (req.name !== undefined) patch.name = req.name;
      if (req.extraPriceCents !== undefined) patch.extraPriceCents = req.extraPriceCents;
      if (req.isDefault !== undefined) patch.isDefault = req.isDefault;
      if (req.sortOrder !== undefined) patch.sortOrder = req.sortOrder;
      const row = await options.update(tenantId, optionId, patch);
      if (row === null) {
        throw new AuthError(
          'ATTRIBUTE_OPTION_NOT_FOUND',
          AUTH_MESSAGE_KEYS['ATTRIBUTE_OPTION_NOT_FOUND'] ?? 'error.internal',
          404,
        );
      }

      await writeAudit(trx, {
        tenantId,
        eventType: 'attribute_option.updated',
        actorUserId,
        entityType: 'attribute_option',
        entityId: optionId,
        rawPayload: {
          groupId: existing.group_id,
          optionId,
          changes: req as Record<string, unknown>,
        },
      });
      return row;
    });
  }

  async softDeleteOption(params: {
    tenantId: string;
    optionId: string;
    actorUserId: string;
  }): Promise<void> {
    const { tenantId, optionId, actorUserId } = params;
    await this.db.transaction().execute(async (trx) => {
      const options = createAttributeOptionsRepository(trx);
      const target = await options.findById(tenantId, optionId);
      if (target === null) {
        throw new AuthError(
          'ATTRIBUTE_OPTION_NOT_FOUND',
          AUTH_MESSAGE_KEYS['ATTRIBUTE_OPTION_NOT_FOUND'] ?? 'error.internal',
          404,
        );
      }
      await options.softDelete(tenantId, optionId);
      await writeAudit(trx, {
        tenantId,
        eventType: 'attribute_option.deleted',
        actorUserId,
        entityType: 'attribute_option',
        entityId: optionId,
        rawPayload: { groupId: target.group_id, optionId },
      });
    });
  }
}
