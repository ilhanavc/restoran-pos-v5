import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import type { Server as IoServer } from 'socket.io';
import {
  createPaymentsRepository,
  RepositoryError,
  type DB,
} from '@restoran-pos/db';
import {
  OrderStatusChangedPayloadSchema,
  PaymentCreateRequestSchema,
  PaymentVoidRequestSchema,
  type PaymentVoidReason,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';
import { domainError } from '../errors.js';
import { writeAudit } from '../audit/writeAudit.js';
import { emitToTenant } from '../realtime/emit.js';
import { enqueueBillJob } from '../print/enqueue-bill-job.js';
import { logger } from '../logger.js';

export interface PaymentsRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
  /** Realtime server (prod). Undefined in tests → emits skipped. */
  io?: IoServer;
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
        // ADR-014 Karar 7 (PR-7c) — 'Öde + Yazdır' opt-in: yalnız bu iki
        // operation kasa fişi (adisyon) tetikler. 'pay' / 'pay_and_close' basmaz.
        const shouldPrintBill =
          operation === 'pay_and_print' ||
          operation === 'pay_and_print_close';
        // ADR-024 K3 — tek transaction: createTx + writeAudit aynı tx'te
        // (ADR-002 §10.4). #194 retry/idempotency davranışı createTx'te
        // bit-identical. Yeni payment'ta payment.created (+ close ise order.paid)
        // audit yazılır; replay'de (replayed=true) audit YAZILMAZ.
        const { payment, orderClosed, replayed } = await deps.db
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

        // Masa kapanışını (ödeme → order.paid → masa boşalır) tenant odasına
        // yayınla; diğer terminaller (web kasiyer + mobil garson) masa tahtasını
        // canlı invalidate eder (ADR-010 §11.6). dine-in close → takeawayStage
        // null. Yalnız close operasyonunda (orderClosed) fire; partial ödeme
        // masayı boşaltmaz. Replay'ler tx öncesi 200 ile döner → buraya gelmez.
        if (orderClosed && deps.io !== undefined) {
          emitToTenant(
            {
              io: deps.io,
              eventName: 'orders.statusChanged',
              payloadSchema: OrderStatusChangedPayloadSchema,
            },
            tenantId,
            { orderId: payment.order_id, takeawayStage: null, paid: true },
          );
        }

        // ADR-014 Karar 7 (PR-7c) — 'Öde + Yazdır' opt-in kasa fişi (adisyon).
        // Para tx'i COMMIT edilmiş; fiş enqueue'su POST-COMMIT + best-effort:
        // enqueue HATASI (CP857 throw / render / insert) ödeme yanıtını ASLA
        // bozmaz (para kutsal, fiş fire-and-forget). Çift-baskı iki katman:
        //  (1) normal replay (aynı idempotencyKey retry) tx ÖNCESİ 200 ile döner
        //      (yukarıdaki fast-path) → buraya HİÇ ulaşmaz;
        //  (2) `!replayed` guard'ı YALNIZ concurrent-race'i kapatır — iki istek
        //      fast-path'i geçip tx'e girerse kaybeden createTx'ten replayed=true
        //      alır (tx yine commit eder) → enqueue atlar → tek fiş.
        // Bill verisi enqueueBillJob tek-fetch'inden gelir (ADR-027 Amd1);
        // müşteri PII SELECT bile edilmez — kasa fişi PII-safe (KVKK). Order
        // kesin var (ödeme az önce onun üstüne yazıldı) → dönüş yok sayılır.
        if (shouldPrintBill && !replayed) {
          try {
            await enqueueBillJob(deps.db, {
              orderId: payment.order_id,
              tenantId,
              actorUserId,
            });
          } catch (printErr) {
            // Fire-and-forget: fiş basımı ödemeyi ETKİLEMEZ. Sessiz + log
            // (writeAudit DEĞİL — 'bill_render_failed' kapalı AuditEventType
            // enum'ında yok + DB CHECK 2-segment noktalı → audit yolu patlardı).
            // Operatör fiş gelmezse manuel 'Adisyon Yazdır' ile basar.
            logger.warn(
              { err: printErr, orderId: payment.order_id, tenantId },
              '[payments] bill auto-enqueue failed (fire-and-forget)',
            );
          }
        }

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

        // Allocations: payments + payment_items aggregated. ADR-033 SUM fan-out —
        // split-state TÜM aritmetiği (paidTotal + allocations + payment_items
        // join → remaining_quantity) yalnız AKTİF (voided_at IS NULL) ödemeleri
        // sayar; void'lenmiş payer'ın allocation'ları düşer → remaining geri artar
        // (K4). Voided satırların üstü-çizili gösterimi GET /payments'tan gelir.
        const payments = await deps.db
          .selectFrom('payments')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('order_id', '=', orderId)
          .orderBy('created_at', 'asc')
          .execute();
        const activePayments = payments.filter((p) => p.voided_at === null);

        const paymentItemRows =
          activePayments.length === 0
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
                  activePayments.map((p) => p.id),
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
        const allocations = activePayments
          .filter((p) => p.payment_scope === 'item')
          .map((p) => ({
            payment_id: p.id,
            payer_no: p.payer_no,
            payer_label: p.payer_label,
            payment_type: p.payment_type,
            amount_cents: p.amount_cents,
            items: itemsByPayment.get(p.id) ?? [],
          }));

        const paidTotal = activePayments.reduce(
          (sum, p) => sum + p.amount_cents,
          0,
        );
        const hasUnallocatedPayments = activePayments.some(
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

  /**
   * POST /payments/:paymentId/void — ADR-033 aynı-gün ödeme void + koşullu
   * ATOMİK masa/adisyon auto-reopen (K3 tek primitive).
   *
   * RBAC: admin + cashier (K6; waiter HAYIR — ADR-008 §7e finansal reversal
   * garsona kapalı, kitchen HAYIR). Body `{ reasonCode }` zorunlu enum (serbest
   * metin YOK — PII önlemi). Tek transaction: repo `voidPayment` (K3) + audit
   * `payment.voided` (+ reopen ise `order.reopened`) aynı tx (ADR-002 §10.4).
   * Commit sonrası reopen'da `orders.statusChanged {paid:false, takeawayStage:
   * null}` emit (K8 ii, ADR-010) → tahtalar canlı tazelenir. Fiş YENİDEN
   * BASILMAZ / hiçbir job enqueue EDİLMEZ (K8 i — operatör fişi fiziksel iptal
   * eder). Response 200 `{ payment, order, reopened }`.
   *
   * Hatalar (catch → HTTP map):
   *   - 404 PAYMENT_NOT_FOUND (payment yok / cross-tenant)
   *   - 409 PAYMENT_ALREADY_VOIDED (çift void)
   *   - 409 PAYMENT_VOID_ORDER_TERMINAL (order cancelled/void/merged)
   *   - 409 PAYMENT_VOID_TAKEAWAY_UNSUPPORTED (dine_in değil — K5)
   *   - 409 PAYMENT_VOID_CROSS_DAY (order.store_date < bugün — K2)
   *   - 409 TABLE_ALREADY_OCCUPIED (reopen'da masa dolu → tam rollback, K3.7)
   *   - 400 VALIDATION_ERROR (paymentId UUID değil / reasonCode geçersiz)
   */
  router.post(
    '/:paymentId/void',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    validateBody(PaymentVoidRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorUserId = req.user!.userId;
        const paymentId = req.params.paymentId as string;
        if (!/^[0-9a-f-]{36}$/i.test(paymentId)) {
          return next(domainError('VALIDATION_ERROR', 400));
        }
        const reasonCode = req.body.reasonCode as PaymentVoidReason;
        const repo = createPaymentsRepository(deps.db);

        const result = await deps.db.transaction().execute(async (trx) => {
          const r = await repo.voidPayment(trx, tenantId, paymentId, {
            reasonCode,
            actorUserId,
          });
          // Audit payment.voided — PII-safe (UUID + enum + integer + boolean).
          await writeAudit(trx, {
            tenantId,
            eventType: 'payment.voided',
            actorUserId,
            entityType: 'payment',
            entityId: r.payment.id,
            rawPayload: {
              order_id: r.payment.order_id,
              payment_id: r.payment.id,
              payment_type: r.payment.payment_type,
              amount_cents: r.payment.amount_cents,
              void_reason_code: r.payment.void_reason_code,
              order_reopened: r.reopened,
            },
          });
          // Reopen (paid→open) gerçekleştiyse ayrı order.reopened audit'i.
          if (r.reopened) {
            await writeAudit(trx, {
              tenantId,
              eventType: 'order.reopened',
              actorUserId,
              entityType: 'order',
              entityId: r.order.id,
              rawPayload: {
                order_id: r.order.id,
                table_id: r.order.table_id,
                table_code: r.order.table_code_snapshot,
                previous_status: 'paid',
                payable_cents: r.order.total_cents,
              },
            });
          }
          return r;
        });

        // Reopen → masa türetilmiş "dolu"; tahtalar (web kasiyer + mobil garson)
        // canlı tazelensin. dine-in reopen → takeawayStage null, paid:false.
        if (result.reopened && deps.io !== undefined) {
          emitToTenant(
            {
              io: deps.io,
              eventName: 'orders.statusChanged',
              payloadSchema: OrderStatusChangedPayloadSchema,
            },
            tenantId,
            { orderId: result.order.id, takeawayStage: null, paid: false },
          );
        }

        res.status(200).json({
          data: {
            payment: result.payment,
            order: result.order,
            reopened: result.reopened,
          },
        });
        return;
      } catch (err) {
        // Repo RepositoryError → explicit domainError(CODE, status). Generic
        // `check` yolu tüm kodları ORDER_INVARIANT_VIOLATED'a çökertmesin (merge
        // route Risk R2 paritesi).
        if (err instanceof RepositoryError) {
          if (err.cause === 'not_found' && err.messageKey === 'PAYMENT_NOT_FOUND') {
            return next(domainError('PAYMENT_NOT_FOUND', 404));
          }
          if (err.cause === 'not_found' && err.messageKey === 'ORDER_NOT_FOUND') {
            return next(domainError('ORDER_NOT_FOUND', 404));
          }
          if (err.cause === 'check' && err.messageKey === 'PAYMENT_ALREADY_VOIDED') {
            return next(domainError('PAYMENT_ALREADY_VOIDED', 409));
          }
          if (err.cause === 'check' && err.messageKey === 'PAYMENT_VOID_ORDER_TERMINAL') {
            return next(domainError('PAYMENT_VOID_ORDER_TERMINAL', 409));
          }
          if (
            err.cause === 'check' &&
            err.messageKey === 'PAYMENT_VOID_TAKEAWAY_UNSUPPORTED'
          ) {
            return next(domainError('PAYMENT_VOID_TAKEAWAY_UNSUPPORTED', 409));
          }
          if (err.cause === 'check' && err.messageKey === 'PAYMENT_VOID_CROSS_DAY') {
            return next(domainError('PAYMENT_VOID_CROSS_DAY', 409));
          }
          if (err.cause === 'unique' && err.messageKey === 'TABLE_ALREADY_OCCUPIED') {
            return next(domainError('TABLE_ALREADY_OCCUPIED', 409));
          }
        }
        return next(err);
      }
    },
  );

  return router;
}
