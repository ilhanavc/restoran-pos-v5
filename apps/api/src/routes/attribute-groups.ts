import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import {
  createAttributeGroupsRepository,
  createAttributeOptionsRepository,
  createCategoryAttributeGroupsRepository,
  createProductAttributeGroupsRepository,
  type DB,
} from '@restoran-pos/db';
import {
  AttributeGroupCreateRequestSchema,
  AttributeGroupUpdateRequestSchema,
  AttributeOptionCreateRequestSchema,
  AttributeOptionUpdateRequestSchema,
  type AttributeGroupCreateRequest,
  type AttributeGroupUpdateRequest,
  type AttributeOptionCreateRequest,
  type AttributeOptionUpdateRequest,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';
import { AttributeGroupService } from '../domain/attributes/AttributeGroupService.js';
import { AttributeOptionService } from '../domain/attributes/AttributeOptionService.js';
import { AttributeAssignmentService } from '../domain/attributes/AttributeAssignmentService.js';
import { AuthError, AUTH_MESSAGE_KEYS } from '../errors.js';

export interface AttributeRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

const READ_ROLES = ['admin', 'cashier', 'waiter', 'kitchen'] as const;

/**
 * ADR-012 attribute groups REST routes (Sprint 8c PR-F1c).
 *
 * 3 router export:
 *   - attributeGroupsRouter — `/attribute-groups` ana resource (group + options nested)
 *   - categoryAttributesRouter — `/menu/categories/:id/attribute-groups` link
 *   - productAttributesRouter — `/products/:id/attribute-groups` link + effective view
 *
 * RBAC: read 4-role, manage admin only (ADR-002 §6 amendment).
 * Idempotent assign 200/204 (ADR-012 Karar 11).
 */
export function attributeGroupsRouter(deps: AttributeRouterDeps): ExpressRouter {
  const router = Router();
  const groupService = new AttributeGroupService(deps.db);
  const optionService = new AttributeOptionService(deps.db);

  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize([...READ_ROLES]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createAttributeGroupsRepository(deps.db);
        const groups = await repo.findAll(req.user!.tenantId);
        res.json({ data: { groups } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(AttributeGroupCreateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const group = await groupService.createGroup({
          tenantId: req.user!.tenantId,
          actorUserId: req.user!.userId,
          req: req.body as AttributeGroupCreateRequest,
        });
        res.status(201).json({ data: { group } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/:id',
    authenticate(deps.accessSecret),
    authorize([...READ_ROLES]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createAttributeGroupsRepository(deps.db);
        const group = await repo.findById(req.user!.tenantId, req.params['id'] as string);
        if (group === null) {
          throw new AuthError(
            'ATTRIBUTE_GROUP_NOT_FOUND',
            AUTH_MESSAGE_KEYS['ATTRIBUTE_GROUP_NOT_FOUND'] ?? 'error.internal',
            404,
          );
        }
        res.json({ data: { group } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(AttributeGroupUpdateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const group = await groupService.updateGroup({
          tenantId: req.user!.tenantId,
          groupId: req.params['id'] as string,
          actorUserId: req.user!.userId,
          req: req.body as AttributeGroupUpdateRequest,
        });
        res.json({ data: { group } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await groupService.softDeleteGroup({
          tenantId: req.user!.tenantId,
          groupId: req.params['id'] as string,
          actorUserId: req.user!.userId,
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  // Options nested under group
  router.get(
    '/:id/options',
    authenticate(deps.accessSecret),
    authorize([...READ_ROLES]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createAttributeOptionsRepository(deps.db);
        const options = await repo.findByGroupId(req.user!.tenantId, req.params['id'] as string);
        res.json({ data: { options } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/:id/options',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(AttributeOptionCreateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const option = await optionService.createOption({
          tenantId: req.user!.tenantId,
          groupId: req.params['id'] as string,
          actorUserId: req.user!.userId,
          req: req.body as AttributeOptionCreateRequest,
        });
        res.status(201).json({ data: { option } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:id/options/:optId',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(AttributeOptionUpdateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const option = await optionService.updateOption({
          tenantId: req.user!.tenantId,
          optionId: req.params['optId'] as string,
          actorUserId: req.user!.userId,
          req: req.body as AttributeOptionUpdateRequest,
        });
        res.json({ data: { option } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/:id/options/:optId',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await optionService.softDeleteOption({
          tenantId: req.user!.tenantId,
          optionId: req.params['optId'] as string,
          actorUserId: req.user!.userId,
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export function categoryAttributesRouter(deps: AttributeRouterDeps): ExpressRouter {
  const router = Router({ mergeParams: true });
  const service = new AttributeAssignmentService(deps.db);

  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize([...READ_ROLES]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createCategoryAttributeGroupsRepository(deps.db);
        const links = await repo.findByCategoryId(
          req.user!.tenantId,
          req.params['id'] as string,
        );
        res.json({ data: { links } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/:groupId',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await service.assignToCategory({
          tenantId: req.user!.tenantId,
          categoryId: req.params['id'] as string,
          groupId: req.params['groupId'] as string,
          actorUserId: req.user!.userId,
        });
        res.status(200).json({ data: result });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/:groupId',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await service.unassignFromCategory({
          tenantId: req.user!.tenantId,
          categoryId: req.params['id'] as string,
          groupId: req.params['groupId'] as string,
          actorUserId: req.user!.userId,
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export function productAttributesRouter(deps: AttributeRouterDeps): ExpressRouter {
  const router = Router({ mergeParams: true });
  const service = new AttributeAssignmentService(deps.db);

  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize([...READ_ROLES]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createProductAttributeGroupsRepository(deps.db);
        const links = await repo.findByProductId(
          req.user!.tenantId,
          req.params['id'] as string,
        );
        res.json({ data: { links } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/effective',
    authenticate(deps.accessSecret),
    authorize([...READ_ROLES]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createProductAttributeGroupsRepository(deps.db);
        const groups = await repo.findEffectiveForProduct(
          req.user!.tenantId,
          req.params['id'] as string,
        );
        res.json({ data: { groups } });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /products/:id/attribute-groups/effective-with-options — PR-6 (ADR-013 §10).
   * Sipariş alma ekranındaki `OrderProductDetailModal` için gerekli tek-call view:
   * effective groups + her grup için options array. ADR-003 §8.6 K4 N+1 yasak →
   * tek SELECT IN groups + tek SELECT IN options. Soft-deleted opsiyonlar
   * düşürülür. Sıralama: groups (sort_order, name); options (sort_order, name).
   */
  router.get(
    '/effective-with-options',
    authenticate(deps.accessSecret),
    authorize([...READ_ROLES]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const productId = req.params['id'] as string;
        const repo = createProductAttributeGroupsRepository(deps.db);
        const groups = await repo.findEffectiveForProduct(tenantId, productId);
        if (groups.length === 0) {
          res.json({ data: { groups: [] } });
          return;
        }
        const groupIds = groups.map((g) => g.id);
        const optionRows = await deps.db
          .selectFrom('attribute_options')
          .select([
            'id',
            'group_id',
            'name',
            'extra_price_cents',
            'is_default',
            'sort_order',
          ])
          .where('tenant_id', '=', tenantId)
          .where('deleted_at', 'is', null)
          .where('group_id', 'in', groupIds)
          .orderBy('sort_order', 'asc')
          .orderBy('name', 'asc')
          .execute();
        const optionsByGroup = new Map<string, typeof optionRows>();
        for (const opt of optionRows) {
          const list = optionsByGroup.get(opt.group_id);
          if (list === undefined) optionsByGroup.set(opt.group_id, [opt]);
          else list.push(opt);
        }
        const enriched = groups.map((g) => ({
          ...g,
          options: optionsByGroup.get(g.id) ?? [],
        }));
        res.json({ data: { groups: enriched } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/:groupId',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await service.assignToProduct({
          tenantId: req.user!.tenantId,
          productId: req.params['id'] as string,
          groupId: req.params['groupId'] as string,
          actorUserId: req.user!.userId,
        });
        res.status(200).json({ data: result });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/:groupId',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await service.unassignFromProduct({
          tenantId: req.user!.tenantId,
          productId: req.params['id'] as string,
          groupId: req.params['groupId'] as string,
          actorUserId: req.user!.userId,
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
