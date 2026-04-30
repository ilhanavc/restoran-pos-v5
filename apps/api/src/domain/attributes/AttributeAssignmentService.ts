import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import {
  createAttributeGroupsRepository,
  createCategoryAttributeGroupsRepository,
  createProductAttributeGroupsRepository,
  type DB,
} from '@restoran-pos/db';
import { writeAudit } from '../../audit/writeAudit.js';
import { AuthError, AUTH_MESSAGE_KEYS } from '../../errors.js';

/**
 * ADR-012 Karar 11: idempotent link insert (200 OK no-op) + idempotent
 * DELETE (204 yoksa).
 *
 * cleanupForCategory / cleanupForProduct: parent (category/product) soft
 * delete handler'larından çağrılır — link satırlarını HARD DELETE eder
 * (link tabloları soft delete YOK; ADR-012 Karar 5).
 */
export class AttributeAssignmentService {
  constructor(private readonly db: Kysely<DB>) {}

  async assignToCategory(params: {
    tenantId: string;
    categoryId: string;
    groupId: string;
    actorUserId: string;
  }): Promise<{ alreadyExisted: boolean }> {
    const { tenantId, categoryId, groupId, actorUserId } = params;
    return await this.db.transaction().execute(async (trx) => {
      const groups = createAttributeGroupsRepository(trx);
      const cag = createCategoryAttributeGroupsRepository(trx);

      const group = await groups.findById(tenantId, groupId);
      if (group === null) {
        throw new AuthError(
          'ATTRIBUTE_GROUP_NOT_FOUND',
          AUTH_MESSAGE_KEYS['ATTRIBUTE_GROUP_NOT_FOUND'] ?? 'error.internal',
          404,
        );
      }

      const id = randomUUID();
      const inserted = await cag.assign(tenantId, categoryId, groupId, id);
      if (inserted === null) {
        return { alreadyExisted: true };
      }
      await writeAudit(trx, {
        tenantId,
        eventType: 'category_attributes.assigned',
        actorUserId,
        entityType: 'category_attribute_group',
        entityId: id,
        rawPayload: { categoryId, groupId, sortOrder: inserted.sort_order },
      });
      return { alreadyExisted: false };
    });
  }

  async unassignFromCategory(params: {
    tenantId: string;
    categoryId: string;
    groupId: string;
    actorUserId: string;
  }): Promise<{ existed: boolean }> {
    const { tenantId, categoryId, groupId, actorUserId } = params;
    return await this.db.transaction().execute(async (trx) => {
      const cag = createCategoryAttributeGroupsRepository(trx);
      const removed = await cag.unassign(tenantId, categoryId, groupId);
      if (removed) {
        await writeAudit(trx, {
          tenantId,
          eventType: 'category_attributes.unassigned',
          actorUserId,
          entityType: 'category_attribute_group',
          entityId: `${categoryId}:${groupId}`,
          rawPayload: { categoryId, groupId },
        });
      }
      return { existed: removed };
    });
  }

  async assignToProduct(params: {
    tenantId: string;
    productId: string;
    groupId: string;
    actorUserId: string;
  }): Promise<{ alreadyExisted: boolean }> {
    const { tenantId, productId, groupId, actorUserId } = params;
    return await this.db.transaction().execute(async (trx) => {
      const groups = createAttributeGroupsRepository(trx);
      const pag = createProductAttributeGroupsRepository(trx);

      const group = await groups.findById(tenantId, groupId);
      if (group === null) {
        throw new AuthError(
          'ATTRIBUTE_GROUP_NOT_FOUND',
          AUTH_MESSAGE_KEYS['ATTRIBUTE_GROUP_NOT_FOUND'] ?? 'error.internal',
          404,
        );
      }

      const id = randomUUID();
      const inserted = await pag.assign(tenantId, productId, groupId, id);
      if (inserted === null) {
        return { alreadyExisted: true };
      }
      await writeAudit(trx, {
        tenantId,
        eventType: 'product_attributes.assigned',
        actorUserId,
        entityType: 'product_attribute_group',
        entityId: id,
        rawPayload: { productId, groupId, sortOrder: inserted.sort_order },
      });
      return { alreadyExisted: false };
    });
  }

  async unassignFromProduct(params: {
    tenantId: string;
    productId: string;
    groupId: string;
    actorUserId: string;
  }): Promise<{ existed: boolean }> {
    const { tenantId, productId, groupId, actorUserId } = params;
    return await this.db.transaction().execute(async (trx) => {
      const pag = createProductAttributeGroupsRepository(trx);
      const removed = await pag.unassign(tenantId, productId, groupId);
      if (removed) {
        await writeAudit(trx, {
          tenantId,
          eventType: 'product_attributes.unassigned',
          actorUserId,
          entityType: 'product_attribute_group',
          entityId: `${productId}:${groupId}`,
          rawPayload: { productId, groupId },
        });
      }
      return { existed: removed };
    });
  }

  async cleanupForCategory(params: {
    tenantId: string;
    categoryId: string;
    trx?: Kysely<DB>;
  }): Promise<void> {
    const { tenantId, categoryId, trx } = params;
    const cag = createCategoryAttributeGroupsRepository(trx ?? this.db);
    await cag.unassignByCategoryId(tenantId, categoryId);
  }

  async cleanupForProduct(params: {
    tenantId: string;
    productId: string;
    trx?: Kysely<DB>;
  }): Promise<void> {
    const { tenantId, productId, trx } = params;
    const pag = createProductAttributeGroupsRepository(trx ?? this.db);
    await pag.unassignByProductId(tenantId, productId);
  }
}
