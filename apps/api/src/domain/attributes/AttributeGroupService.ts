import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import {
  createAttributeGroupsRepository,
  createAttributeOptionsRepository,
  createCategoryAttributeGroupsRepository,
  createProductAttributeGroupsRepository,
  type DB,
  type AttributeGroupRow,
} from '@restoran-pos/db';
import type {
  AttributeGroupCreateRequest,
  AttributeGroupUpdateRequest,
} from '@restoran-pos/shared-types';
import { writeAudit } from '../../audit/writeAudit.js';
import { AuthError, AUTH_MESSAGE_KEYS } from '../../errors.js';

/**
 * ADR-012 attribute groups domain service. Pattern: AreaService (ADR-009).
 *
 * Soft delete (Karar 6): TEK transaction içinde:
 *   1. attributeGroups.softDelete
 *   2. attributeOptions.softDeleteByGroupId (cascade)
 *   3. categoryAttributeGroups.unassignByGroupId (link cleanup)
 *   4. productAttributeGroups.unassignByGroupId (link cleanup)
 *   5. writeAudit `attribute_group.deleted`
 *
 * Cross-tenant / bilinmeyen id → AuthError(404 ATTRIBUTE_GROUP_NOT_FOUND).
 * Duplicate name → repository RepositoryError 23505 → ADR-006 §4 mapping →
 * 409 ATTRIBUTE_GROUP_NAME_ALREADY_EXISTS (errorHandler).
 */
export class AttributeGroupService {
  constructor(private readonly db: Kysely<DB>) {}

  async createGroup(params: {
    tenantId: string;
    actorUserId: string;
    req: AttributeGroupCreateRequest;
  }): Promise<AttributeGroupRow> {
    const { tenantId, actorUserId, req } = params;
    return await this.db.transaction().execute(async (trx) => {
      const repo = createAttributeGroupsRepository(trx);
      const id = randomUUID();
      const row = await repo.create(tenantId, {
        id,
        name: req.name,
        selectionType: req.selectionType,
        isRequired: req.isRequired,
        sortOrder: req.sortOrder,
      });
      await writeAudit(trx, {
        tenantId,
        eventType: 'attribute_group.created',
        actorUserId,
        entityType: 'attribute_group',
        entityId: id,
        rawPayload: {
          groupId: id,
          name: req.name,
          selectionType: req.selectionType,
          isRequired: req.isRequired ?? false,
          sortOrder: req.sortOrder ?? 0,
        },
      });
      return row;
    });
  }

  async updateGroup(params: {
    tenantId: string;
    groupId: string;
    actorUserId: string;
    req: AttributeGroupUpdateRequest;
  }): Promise<AttributeGroupRow> {
    const { tenantId, groupId, actorUserId, req } = params;
    return await this.db.transaction().execute(async (trx) => {
      const repo = createAttributeGroupsRepository(trx);
      const patch: Parameters<typeof repo.update>[2] = {};
      if (req.name !== undefined) patch.name = req.name;
      if (req.selectionType !== undefined) patch.selectionType = req.selectionType;
      if (req.isRequired !== undefined) patch.isRequired = req.isRequired;
      if (req.sortOrder !== undefined) patch.sortOrder = req.sortOrder;
      const row = await repo.update(tenantId, groupId, patch);
      if (row === null) {
        throw new AuthError(
          'ATTRIBUTE_GROUP_NOT_FOUND',
          AUTH_MESSAGE_KEYS['ATTRIBUTE_GROUP_NOT_FOUND'] ?? 'error.internal',
          404,
        );
      }
      await writeAudit(trx, {
        tenantId,
        eventType: 'attribute_group.updated',
        actorUserId,
        entityType: 'attribute_group',
        entityId: groupId,
        rawPayload: { groupId, changes: req as Record<string, unknown> },
      });
      return row;
    });
  }

  async softDeleteGroup(params: {
    tenantId: string;
    groupId: string;
    actorUserId: string;
  }): Promise<void> {
    const { tenantId, groupId, actorUserId } = params;
    await this.db.transaction().execute(async (trx) => {
      const groups = createAttributeGroupsRepository(trx);
      const options = createAttributeOptionsRepository(trx);
      const cag = createCategoryAttributeGroupsRepository(trx);
      const pag = createProductAttributeGroupsRepository(trx);

      const target = await groups.findById(tenantId, groupId);
      if (target === null) {
        throw new AuthError(
          'ATTRIBUTE_GROUP_NOT_FOUND',
          AUTH_MESSAGE_KEYS['ATTRIBUTE_GROUP_NOT_FOUND'] ?? 'error.internal',
          404,
        );
      }

      await groups.softDelete(tenantId, groupId);
      await options.softDeleteByGroupId(tenantId, groupId);
      await cag.unassignByGroupId(tenantId, groupId);
      await pag.unassignByGroupId(tenantId, groupId);

      await writeAudit(trx, {
        tenantId,
        eventType: 'attribute_group.deleted',
        actorUserId,
        entityType: 'attribute_group',
        entityId: groupId,
        rawPayload: { groupId },
      });
    });
  }
}
