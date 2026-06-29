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
import { writeAudit } from '../audit/writeAudit.js';

export interface PaymentsRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * ADR-014 — Ödeme Akışı.
 *
 * POST /payments  — admin/cashier/waiter (ADR-027: mobil operasyonel terminal —
 * garson da ödeme alır; charter §78 kısmi reversal + ADR-008 §7e ABAC).
 *
 * Akış (ADR-014 §4 idempotency + §6 close transition):
 *   1. Idempotency replay: aynı (tenant, key) → mevcut payment + 200
 *   2. Yeni: transaction içinde order lock + INSERT payments
 *      + (scope='item') payment_items + (operation=*_close) order.status='paid'
 *   3. Response: 201 + payment row
 *
 * RBAC: payments.create = admin/cashier/waiter (ADR-027 — garson 3-nokta menüsünden
 * ödeme alır; refund/comp/iptal garsona AÇILMAZ — ADR-008 §7e). Kitchen: 403.
 * Çift-tahsilat koruması Idempotency-Key + audit (her ödeme aktör=req.user ile loglanır).
 */
export function paymentsRouter(deps: PaymentsRouterDeps): ExpressRouter {
  const router = Router();

  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    // ADR-014 §10 Karar 10.10 — Idempotency-Key HTTP header desteği.
    // Body'de yoksa header'dan al; iki yol da kabul (HTTP standart paritesi).
    (req: Request, _res: Response, next: NextFunction) => {
      if (req.body && req.body.idempotencyKey === undefined) {
        const headerKey = req.get('Idempotency-Key');
        if (headerKey !== undefined && headerKey.trim() !== '') {
          req.body.idempotencyKey = headerKey.trim();
        }
      }
      next();
    },
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

        let itemAllocations: Array<{ orderItemId: string; quantity: number }> | undefined;
        if (req.body.itemAllocations !== undefined) {
          itemAllocations = req.body.itemAllocations;
        } else if (req.body.orderItemIds !== undefined) {
          itemAllocations = (req.body.orderItemIds as string[]).map(
            (oid: string) => ({ orderItemId: oid, quantity: 1 }),
          );
        }

        const operation = req.body.operation as string;
        // ADR-024 K3 — tek transaction: createTx + writeAudit aynı tx'te
        // (ADR-002 §10.4). #194 retry/idempotency davranışı createTx'te
        // bit-identical. Yeni payment'ta payment.created (+ close ise order.paid)
        // audit yazılır; replay'de (replayed=true) audit YAZILMAZ.
        const { payment } = await deps.db
          .transaction()
          .execute(async (trx) => {
            const r = await repo.createTx(trx, tenantId, {
              id: randomUUID(),
              orderId: req.body.orderId,
              paymentType: req.body.paymentType,
              paymentScope: req.body.paymentScope,
              amountCents: req.body.amountCents,
              idempotencyKey: req.body.idempotencyKey,
              createdByUserId: actorUserId,
              ...(itemAllocations !== undefined ? { itemAllocations } : {}),
              closeOrder,
              ...(req.body.cashReceivedCents !== undefined
                ? { cashReceivedCents: req.body.cashReceivedCents }
                : {}),
              ...(req.body.tipAmountCents !== undefined
                ? { tipAmountCents: req.body.tipAmountCents }
                : {}),
              ...(req.body.payerNo !== undefined
                ? { payerNo: req.body.payerNo }
                : {}),
              ...(req.body.payerLabel !== undefined
                ? { payerLabel: req.body.payerLabel }
                : {}),
              ...(req.body.note !== undefined ? { note: req.body.note } : {}),
            });

            // K3 — replay (mutation yok) → audit yazma.
            if (!r.replayed) {
              await writeAudit(trx, {
                tenantId,
                eventType: 'payment.created',
                actorUserId,
                entityType: 'payment',
                entityId: r.payment.id,
                rawPayload: {
                  order_id: r.payment.order_id,
                  payment_id: r.payment.id,
                  payment_type: r.payment.payment_type,
                  payment_scope: r.payment.payment_scope,
                  amount_cents: r.payment.amount_cents,
                  operation,
                  order_closed: r.orderClosed,
                },
              });
              // Dine-in close (Mod A) → order.paid audit (en hassas parasal aksiyon).
              if (r.orderClosed) {
                await writeAudit(trx, {
                  tenantId,
                  eventType: 'order.paid',
                  actorUserId,
                  entityType: 'order',
                  entityId: r.payment.order_id,
                  rawPayload: {
                    order_id: r.payment.order_id,
                    payment_type: r.payment.payment_type,
                    amount_cents: r.payment.amount_cents,
                  },
                });
              }
            }
            return r;
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
          // ADR-014 §12 — close invariant ihlalleri (SUM(payments) ≠ payable)
          if (err.cause === 'check' && err.messageKey === 'PAYMENT_INSUFFICIENT_FOR_CLOSE') {
            return next(domainError('PAYMENT_INSUFFICIENT_FOR_CLOSE', 400));
          }
          if (err.cause === 'check' && err.messageKey === 'PAYMENT_EXCEEDS_TOTAL') {
            return next(domainError('PAYMENT_EXCEEDS_TOTAL', 400));
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
    authorize(['admin', 'cashier', 'waiter']),
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

  /**
   * GET /payments/orders/:orderId/split-state — ADR-014 §10 Karar 10.2.
   *
   * Tek-call DTO: items (remaining_quantity) + allocations (mevcut payments
   * detayı) + totals (order_total/paid_total/remaining_total/has_unallocated).
   * Frontend SplitPaymentModal bu endpoint'le state hidrate eder.
   */
  router.get(
    '/orders/:orderId/split-state',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const orderId = req.params.orderId as string;
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
          return next(domainError('VALIDATION_ERROR', 400));
        }

        // Order + items
        const order = await deps.db
          .selectFrom('orders')
          .selectAll()
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        if (order === undefined) {
          return next(domainError('ORDER_NOT_FOUND', 404));
        }

        const items = await deps.db
          .selectFrom('order_items')
          .select([
            'id',
            'product_name',
            'quantity',
            'unit_price_cents',
            'is_comped',
            'status',
            'variant_name_snapshot',
          ])
          .where('order_id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .where('status', '!=', 'cancelled')
          .orderBy('created_at', 'asc')
          .execute();

        // Allocations: payments + payment_items aggregated
        const payments = await deps.db
          .selectFrom('payments')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('order_id', '=', orderId)
          .orderBy('created_at', 'asc')
          .execute();

        const paymentItemRows =
          payments.length === 0
            ? []
            : await deps.db
                .selectFrom('payment_items')
                .select([
                  'payment_id',
                  'order_item_id',
                  'quantity',
                  'line_total_cents',
                ])
                .where('tenant_id', '=', tenantId)
                .where(
                  'payment_id',
                  'in',
                  payments.map((p) => p.id),
                )
                .execute();

        // remaining_quantity per item
        const allocByItem = new Map<string, number>();
        for (const pi of paymentItemRows) {
          allocByItem.set(
            pi.order_item_id,
            (allocByItem.get(pi.order_item_id) ?? 0) + pi.quantity,
          );
        }
        const itemsWithRemaining = items.map((it) => ({
          id: it.id,
          product_name: it.product_name,
          variant_name_snapshot: it.variant_name_snapshot,
          unit_price_cents: it.unit_price_cents,
          total_quantity: it.quantity,
          remaining_quantity: it.is_comped
            ? 0
            : Math.max(0, it.quantity - (allocByItem.get(it.id) ?? 0)),
          is_comped: it.is_comped,
        }));

        // Allocations grouped by payment_id
        const itemsByPayment = new Map<
          string,
          Array<{ order_item_id: string; quantity: number; line_total_cents: number }>
        >();
        for (const pi of paymentItemRows) {
          const list = itemsByPayment.get(pi.payment_id);
          const entry = {
            order_item_id: pi.order_item_id,
            quantity: pi.quantity,
            line_total_cents: pi.line_total_cents,
          };
          if (list === undefined) itemsByPayment.set(pi.payment_id, [entry]);
          else list.push(entry);
        }
        const allocations = payments
          .filter((p) => p.payment_scope === 'item')
          .map((p) => ({
            payment_id: p.id,
            payer_no: p.payer_no,
            payer_label: p.payer_label,
            payment_type: p.payment_type,
            amount_cents: p.amount_cents,
            items: itemsByPayment.get(p.id) ?? [],
          }));

        const paidTotal = payments.reduce(
          (sum, p) => sum + p.amount_cents,
          0,
        );
        const hasUnallocatedPayments = payments.some(
          (p) => p.payment_scope !== 'item',
        );

        res.status(200).json({
          data: {
            order: {
              id: order.id,
              status: order.status,
              table_id: order.table_id,
              total_cents: order.total_cents,
            },
            items: itemsWithRemaining,
            allocations,
            totals: {
              order_total_cents: order.total_cents,
              paid_total_cents: paidTotal,
              remaining_total_cents: Math.max(0, order.total_cents - paidTotal),
              has_unallocated_payments: hasUnallocatedPayments,
            },
          },
        });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
