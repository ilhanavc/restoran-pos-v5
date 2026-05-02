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
  createPaymentsRepository,
  RepositoryError,
  type DB,
} from '@restoran-pos/db';
import { PaymentCreateRequestSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';
import { domainError } from '../errors.js';

export interface PaymentsRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * ADR-014 — Ödeme Akışı.
 *
 * POST /payments  — kasiyer/admin (waiter HARİÇ; ödeme = parasal yetki).
 *
 * Akış (ADR-014 §4 idempotency + §6 close transition):
 *   1. Idempotency replay: aynı (tenant, key) → mevcut payment + 200
 *   2. Yeni: transaction içinde order lock + INSERT payments
 *      + (scope='item') payment_items + (operation=*_close) order.status='paid'
 *   3. Response: 201 + payment row
 *
 * RBAC: payments.create = admin/cashier (waiter sipariş alır, ödemeyi kasiyer
 * yapar — v3 paritesi). Kitchen: 403.
 */
export function paymentsRouter(deps: PaymentsRouterDeps): ExpressRouter {
  const router = Router();

  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    validateBody(PaymentCreateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const repo = createPaymentsRepository(deps.db);

        // 1. Idempotency replay — handler katmanında ayrıca kontrol (transaction
        //    içinde de var; burada hızlı return + 200 ayrımı için).
        const existing = await repo.findByIdempotencyKey(
          tenantId,
          req.body.idempotencyKey,
        );
        if (existing !== null) {
          res.status(200).json({ data: { payment: existing, replay: true } });
          return;
        }

        const closeOrder =
          req.body.operation === 'pay_and_close' ||
          req.body.operation === 'pay_and_print_close';

        // ADR-014 §9 Karar 9.4 — body'de itemAllocations veya orderItemIds.
        // Geriye uyumluluk: orderItemIds gelirse her id için quantity=1
        // (legacy client davranışı, full-quantity kalem ödeme).
        let itemAllocations: Array<{ orderItemId: string; quantity: number }> | undefined;
        if (req.body.itemAllocations !== undefined) {
          itemAllocations = req.body.itemAllocations;
        } else if (req.body.orderItemIds !== undefined) {
          itemAllocations = (req.body.orderItemIds as string[]).map(
            (oid: string) => ({ orderItemId: oid, quantity: 1 }),
          );
        }

        const payment = await repo.create(tenantId, {
          id: randomUUID(),
          orderId: req.body.orderId,
          paymentType: req.body.paymentType,
          paymentScope: req.body.paymentScope,
          amountCents: req.body.amountCents,
          idempotencyKey: req.body.idempotencyKey,
          createdByUserId: actorUserId,
          ...(itemAllocations !== undefined ? { itemAllocations } : {}),
          closeOrder,
        });

        // ADR-014 Karar 7 (Print Agent kuyruğu) — pay_and_print* operasyonlar
        // için print_jobs INSERT, PR-7c (Print Agent slice) kapsamında. MVP
        // backend slice yalnız ödeme + status transition.

        res.status(201).json({ data: { payment } });
        return;
      } catch (err) {
        if (err instanceof RepositoryError) {
          if (err.cause === 'not_found') {
            return next(domainError('ORDER_NOT_FOUND', 404));
          }
          if (err.cause === 'check' && err.messageKey === 'ORDER_INVARIANT_VIOLATED') {
            return next(domainError('ORDER_INVARIANT_VIOLATED', 409));
          }
          if (err.cause === 'check' && err.messageKey === 'COMP_ITEM_IN_PAYMENT') {
            return next(domainError('COMP_ITEM_IN_PAYMENT', 409));
          }
          if (err.cause === 'check' && err.messageKey === 'PAYMENT_QTY_EXCEEDS_ORDER_ITEM') {
            return next(domainError('PAYMENT_QTY_EXCEEDS_ORDER_ITEM', 409));
          }
          if (err.cause === 'foreign_key' && err.messageKey === 'ORDER_ITEM_NOT_FOUND') {
            return next(domainError('ORDER_ITEM_NOT_FOUND', 404));
          }
        }
        return next(err);
      }
    },
  );

  /**
   * GET /payments?orderId=X — sipariş için tüm payments listesi.
   * UI partial scope toplam takibi için (Hızlı Öde modal'ında "şu kadar
   * ödenmiş, geri kalan: X"). Kitchen rolü ödeme detayı görmez.
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const orderId = String(req.query['orderId'] ?? '');
        if (orderId === '' || !/^[0-9a-f-]{36}$/i.test(orderId)) {
          return next(domainError('VALIDATION_ERROR', 400));
        }
        const repo = createPaymentsRepository(deps.db);
        const payments = await repo.findByOrderId(req.user!.tenantId, orderId);
        res.status(200).json({ data: { payments } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
