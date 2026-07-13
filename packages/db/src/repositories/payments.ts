import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type {
  DB,
  Orders,
  Payments,
  PaymentScope,
  PaymentType,
} from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';
import { canCloseOrder } from '@restoran-pos/shared-domain';

export type PaymentRow = Selectable<Payments>;
/** ADR-033 — void sonrası dönen order satırı (orders.ts `OrderRow` ile aynı
 *  şekil; barrel çakışmasını önlemek için burada re-export edilmez). */
export type VoidedOrderRow = Selectable<Orders>;

/**
 * ADR-033 K6 — void sebep kodu (Migration 044 CHECK ile aynı küme). db paketi
 * framework-free (shared-types'a bağımlı değil) → union burada yerel; route
 * `PaymentVoidRequestSchema` (shared-types) ile doğrular, aynı literal küme.
 */
export type PaymentVoidReasonCode =
  | 'wrong_payment_type'
  | 'wrong_amount'
  | 'wrong_table'
  | 'duplicate'
  | 'other';

export interface PaymentItemAllocation {
  orderItemId: string;
  quantity: number;
}

export interface CreatePaymentParams {
  id: string;
  orderId: string;
  paymentType: PaymentType;
  paymentScope: PaymentScope;
  amountCents: number;
  idempotencyKey: string;
  createdByUserId: string;
  /** payment_items junction (yalnız scope='item'). ADR-014 §9 Karar 9.4
   *  partial-qty allocations: aynı order_item_id N satırda olabilir,
   *  SUM(quantity) per item ≤ order_items.quantity. */
  itemAllocations?: PaymentItemAllocation[];
  /** ADR-014 Karar 6 — *_close ise atomik order status='paid' transition. */
  closeOrder?: boolean;
  /** ADR-014 §10 Karar 10.5 — Migration 024 yeni alanlar. */
  cashReceivedCents?: number;
  payerNo?: number;
  payerLabel?: string;
  note?: string;
  /** ADR-014 §11 Karar 11.3 — bahşiş Migration 025. */
  tipAmountCents?: number;
}

/**
 * ADR-024 K1/K3 — `createTx` dönüşü. Route audit kararını bununla verir:
 *   - `replayed=true` → idempotency replay (mutation YOK) → audit YAZILMAZ.
 *   - `replayed=false` → yeni payment → `payment.created` audit + (close ise)
 *     `order.paid` audit yazılır.
 *   - `orderClosed` → bu çağrıda order.status='paid' transition'ı oldu mu
 *     (closeOrder=true + invariant geçti). Audit payload `order_closed` alanı.
 */
export interface CreatePaymentTxResult {
  payment: PaymentRow;
  /** true → idempotency replay (mevcut payment döndü, INSERT olmadı). */
  replayed: boolean;
  /** true → bu tx'te order.status='paid' transition gerçekleşti. */
  orderClosed: boolean;
}

/** ADR-033 K3/K6 — `voidPayment` girdisi (route validated değerleri geçer). */
export interface VoidPaymentParams {
  reasonCode: PaymentVoidReasonCode;
  actorUserId: string;
}

/** ADR-033 — `voidPayment` dönüşü. Route audit + emit kararını bununla verir. */
export interface VoidPaymentTxResult {
  /** Void'lenmiş payment satırı (voided_* dolu). */
  payment: PaymentRow;
  /** Void sonrası GÜNCEL order satırı (reopen olduysa status='open'). */
  order: VoidedOrderRow;
  /** true → paid→open auto-reopen gerçekleşti (K3 adım 6) → route reopen audit
   *  + `orders.statusChanged {paid:false}` emit eder. */
  reopened: boolean;
}

export interface PaymentsRepository {
  /**
   * Atomik ödeme akışı — ADR-014 §4 idempotency + §6 close transition.
   *
   * Akış:
   *   1. SELECT mevcut idempotency_key → varsa return (replay safety)
   *   2. SELECT order FOR UPDATE — terminal status reddi (paid/cancelled/void)
   *   3. INSERT payments
   *   4. (scope='item') INSERT payment_items batch — comped item DB trigger reddeder
   *   5. (closeOrder) UPDATE orders SET status='paid', closed_at=now()
   *
   * Hatalar (RepositoryError):
   *   - 'not_found' ORDER_NOT_FOUND
   *   - 'check' ORDER_INVARIANT_VIOLATED — closed/cancelled/void order
   *   - 'check' COMP_ITEM_IN_PAYMENT — DB trigger
   *   - 'foreign_key' ORDER_ITEM_NOT_FOUND — orderItemIds tenant/order eşleşmiyor
   */
  create(tenantId: string, params: CreatePaymentParams): Promise<PaymentRow>;
  /**
   * ADR-024 K1 — `create` tx-variant. Caller-owned transaction; route aynı tx'te
   * `payment.created` (+ close ise `order.paid`) audit yazabilsin diye
   * (ADR-002 §10.4). Gövde `create` ile BİREBİR aynı (#194 retry/idempotency
   * davranışı DEĞİŞMEZ). Public `create` bunu sarmalar. Ek olarak audit kararı
   * için `replayed` + `orderClosed` sinyalini döndürür (K3: replay'de audit yok).
   */
  createTx(
    trx: Transaction<DB>,
    tenantId: string,
    params: CreatePaymentParams,
  ): Promise<CreatePaymentTxResult>;

  /** Idempotency lookup — handler aynı key 2. kez geldiğinde replay döner. */
  findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<PaymentRow | null>;

  /** Sipariş için tüm payments — partial scope toplam takibi UI için.
   *  ADR-033: voided satırlar da DÖNER (UI üstü-çizili gösterir); yalnız
   *  *aritmetik* SUM siteleri `voided_at IS NULL` ile filtreler. */
  findByOrderId(tenantId: string, orderId: string): Promise<PaymentRow[]>;

  /**
   * ADR-033 K3 — aynı-gün ödeme void + koşullu ATOMİK auto-reopen. TEK primitive,
   * caller-owned transaction (route audit + emit'i aynı tx/sonrası verir).
   *
   * Akış (deadlock-safe SABİT kilit sırası payment→order):
   *   1. payment FOR UPDATE → yoksa PAYMENT_NOT_FOUND; voided ise PAYMENT_ALREADY_VOIDED
   *   2. order FOR UPDATE (payment.order_id)
   *   3. order cancelled/void/merged → PAYMENT_VOID_ORDER_TERMINAL
   *   4. order takeaway/delivery → PAYMENT_VOID_TAKEAWAY_UNSUPPORTED (K5)
   *   5. K2 aynı-gün: order.store_date < bugün → PAYMENT_VOID_CROSS_DAY
   *   6. UPDATE payments SET voided_* (all-or-none)
   *   7. order 'paid' ise → UPDATE status='open' (reopen); 23505 →
   *      TABLE_ALREADY_OCCUPIED + TÜM tx rollback (void+reopen bölünemez, K3.7)
   *
   * Kilit sırası neden deadlock-safe: mevcut FOR UPDATE alan payment yolu YALNIZ
   * budur (createTx/payOrderTx order'ı kilitler ama var olan payment'a FOR UPDATE
   * ALMAZ) → payment→order kilit döngüsü oluşamaz.
   */
  voidPayment(
    trx: Transaction<DB>,
    tenantId: string,
    paymentId: string,
    params: VoidPaymentParams,
  ): Promise<VoidPaymentTxResult>;
}

export function createPaymentsRepository(db: Kysely<DB>): PaymentsRepository {
  return {
    async findByIdempotencyKey(tenantId, idempotencyKey) {
      const row = await db
        .selectFrom('payments')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('idempotency_key', '=', idempotencyKey)
        .executeTakeFirst();
      return (row ?? null) as PaymentRow | null;
    },

    async findByOrderId(tenantId, orderId) {
      const rows = await db
        .selectFrom('payments')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('order_id', '=', orderId)
        .orderBy('created_at', 'asc')
        .execute();
      return rows as PaymentRow[];
    },

    // ADR-024 K1 — public `create` artık tx-variant'ı sarmalayan ince delege.
    // #194 retry/idempotency mantığı `createTx`'e TAŞINDI (bit-identical).
    // Geriye uyumlu: mevcut çağıranlar (route, testler) yalnız PaymentRow
    // bekliyor; tx-variant sinyallerini soyutlayıp aynı row'u döndürür.
    async create(tenantId, params) {
      const result = await db
        .transaction()
        .execute((trx) => this.createTx(trx, tenantId, params));
      return result.payment;
    },

    async createTx(trx, tenantId, params) {
      // 1. Idempotency replay — transaction içinde tekrar kontrol
      const existing = await trx
        .selectFrom('payments')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('idempotency_key', '=', params.idempotencyKey)
        .executeTakeFirst();
      if (existing !== undefined) {
        // Replay: mutation yok → route audit yazmaz (K3).
        return {
          payment: existing as PaymentRow,
          replayed: true,
          orderClosed: false,
        };
      }

      // 2. Order lock + invariant
      const order = await trx
        .selectFrom('orders')
        .select(['id', 'status', 'tenant_id', 'total_cents', 'is_fully_comped'])
        .where('id', '=', params.orderId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (order === undefined) {
        throw new RepositoryError('not_found', 'ORDER_NOT_FOUND');
      }
      if (
        order.status === 'paid' ||
        order.status === 'cancelled' ||
        order.status === 'void'
      ) {
        throw new RepositoryError(
          'check',
          'ORDER_INVARIANT_VIOLATED',
          `status=${order.status}`,
        );
      }

      // 3. INSERT payments
      // §10.5 — change auto-calc (cash mode'da)
      const cashReceived =
        params.paymentType === 'cash'
          ? (params.cashReceivedCents ?? params.amountCents)
          : null;
      const changeAmount =
        cashReceived !== null
          ? Math.max(0, cashReceived - params.amountCents)
          : null;

      // Idempotency yarışı: ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      // — kaybeden INSERT hata FIRLATMAZ (0 satır döner). Eski try/catch deseni
      // 23505 sonrası recovery SELECT'i aborted transaction'da (25P02) çalıştırmaya
      // çalışıyordu → replay yerine 500 (DB-TX-05). Postgres, çakışan satır henüz
      // commit edilmemişse INSERT'i o tx sonuçlanana kadar bekletir; commit olursa
      // 0 satır, abort olursa bizim INSERT geçer — her iki dalda da tx sağlıklı.
      let inserted: PaymentRow | undefined;
      try {
        inserted = (await trx
          .insertInto('payments')
          .values({
            id: params.id,
            tenant_id: tenantId,
            order_id: params.orderId,
            payment_type: params.paymentType,
            payment_scope: params.paymentScope,
            amount_cents: params.amountCents,
            idempotency_key: params.idempotencyKey,
            created_by_user_id: params.createdByUserId,
            payer_no: params.payerNo ?? null,
            payer_label: params.payerLabel ?? null,
            cash_received_cents: cashReceived,
            change_amount_cents: changeAmount,
            tip_amount_cents: params.tipAmountCents ?? null,
            note: params.note ?? null,
          })
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'idempotency_key']).doNothing(),
          )
          .returningAll()
          .executeTakeFirst()) as PaymentRow | undefined;
      } catch (err) {
        // Idempotency-dışı ihlaller (FK, CHECK, başka unique) eski davranışla
        // birebir: RepositoryError'a map'le, map'lenemeyeni aynen fırlat.
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
      }

      if (inserted === undefined) {
        // Yarışı kaybeden istek — satır paralel request tarafından yazıldı.
        // Tx aborted DEĞİL (conflict yutuldu) → replay SELECT güvenle çalışır.
        // #194 davranışı: yeniden okunan satır replay sayılır → audit yok (K3).
        const replay = await trx
          .selectFrom('payments')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('idempotency_key', '=', params.idempotencyKey)
          .executeTakeFirstOrThrow();
        return {
          payment: replay as PaymentRow,
          replayed: true,
          orderClosed: false,
        };
      }

      // 4. payment_items (scope='item') — partial-qty allocations
      if (
        params.paymentScope === 'item' &&
        params.itemAllocations !== undefined &&
        params.itemAllocations.length > 0
      ) {
        // 4a. Order_items snapshot — unit_price + quantity için
        const itemIds = [
          ...new Set(params.itemAllocations.map((a) => a.orderItemId)),
        ];
        const orderItems = await trx
          .selectFrom('order_items')
          .select(['id', 'quantity', 'unit_price_cents'])
          .where('tenant_id', '=', tenantId)
          .where('order_id', '=', params.orderId)
          .where('id', 'in', itemIds)
          .execute();
        if (orderItems.length !== itemIds.length) {
          throw new RepositoryError(
            'foreign_key',
            'ORDER_ITEM_NOT_FOUND',
            'order_item_ids contain invalid id(s) for this order',
          );
        }
        const itemMap = new Map(orderItems.map((it) => [it.id, it]));

        // 4b. Cross-row qty validation: SUM(existing + new) ≤ order_items.quantity
        const existingAlloc = await trx
          .selectFrom('payment_items')
          .select(['order_item_id', 'quantity'])
          .where('tenant_id', '=', tenantId)
          .where('order_item_id', 'in', itemIds)
          .execute();
        const existingByItem = new Map<string, number>();
        for (const e of existingAlloc) {
          existingByItem.set(
            e.order_item_id,
            (existingByItem.get(e.order_item_id) ?? 0) + e.quantity,
          );
        }
        const newByItem = new Map<string, number>();
        for (const a of params.itemAllocations) {
          newByItem.set(
            a.orderItemId,
            (newByItem.get(a.orderItemId) ?? 0) + a.quantity,
          );
        }
        for (const [itemId, addQty] of newByItem.entries()) {
          const oi = itemMap.get(itemId)!;
          const totalAfter = (existingByItem.get(itemId) ?? 0) + addQty;
          if (totalAfter > oi.quantity) {
            throw new RepositoryError(
              'check',
              'PAYMENT_QTY_EXCEEDS_ORDER_ITEM',
              `order_item_id=${itemId} total_alloc=${totalAfter} > order_qty=${oi.quantity}`,
            );
          }
        }

        // 4c. INSERT batch (Migration 024 payer_no/label denormalize)
        try {
          await trx
            .insertInto('payment_items')
            .values(
              params.itemAllocations.map((a) => {
                const oi = itemMap.get(a.orderItemId)!;
                return {
                  payment_id: inserted.id,
                  order_item_id: a.orderItemId,
                  tenant_id: tenantId,
                  quantity: a.quantity,
                  unit_price_cents_snapshot: oi.unit_price_cents,
                  line_total_cents: a.quantity * oi.unit_price_cents,
                  payer_no: params.payerNo ?? null,
                  payer_label: params.payerLabel ?? null,
                };
              }),
            )
            .execute();
        } catch (err) {
          const mapped = mapPgError(err);
          if (mapped?.cause === 'check') {
            // DB trigger payment_items_block_comped_insert (§10.5.2 C1)
            throw new RepositoryError(
              'check',
              'COMP_ITEM_IN_PAYMENT',
              mapped.detail,
            );
          }
          if (mapped !== null) throw mapped;
          throw err;
        }
      }

      // 5. Atomik close (operation=*_close)
      let orderClosed = false;
      if (params.closeOrder === true) {
        // ADR-014 §12 — close invariant: SUM(payments.amount_cents) === payable.
        // total_cents zaten comped/cancelled kalemleri dışlar (= net payable,
        // ADR-013 §9.3 — ayrı comped_amount_cents kolonu yok). canCloseOrder
        // underpaid (<) ve overpaid (>) ikisini de reddeder; tx içinde, order
        // satırı FOR UPDATE kilitliyken → race-free.
        const paid = await trx
          .selectFrom('payments')
          .select((eb) => [
            eb.fn
              .coalesce(eb.fn.sum<number>('amount_cents'), eb.lit(0))
              .as('paid_total'),
            eb.fn.countAll<number>().as('cnt'),
          ])
          .where('tenant_id', '=', tenantId)
          .where('order_id', '=', params.orderId)
          // ADR-033 SUM fan-out — void'lenmiş ödemeler close-invariant'a SAYILMAZ.
          // Bir ödeme void → reopen → doğru ödeme → yeniden kapat döngüsünde void
          // satır kalır; filtrelenmezse eski (geçersiz) tutar tekrar sayılır.
          .where('voided_at', 'is', null)
          .executeTakeFirstOrThrow();
        const closeCheck = canCloseOrder({
          isFullyComped: order.is_fully_comped,
          payableCents: order.total_cents,
          paymentsTotalCents: Number(paid.paid_total ?? 0),
          paymentsCount: Number(paid.cnt ?? 0),
        });
        if (!closeCheck.ok) {
          const code =
            closeCheck.reason === 'underpaid'
              ? 'PAYMENT_INSUFFICIENT_FOR_CLOSE'
              : closeCheck.reason === 'overpaid'
                ? 'PAYMENT_EXCEEDS_TOTAL'
                : 'ORDER_INVARIANT_VIOLATED';
          throw new RepositoryError(
            'check',
            code,
            `reason=${closeCheck.reason} paid=${Number(paid.paid_total ?? 0)} payable=${order.total_cents}`,
          );
        }

        await trx
          .updateTable('orders')
          .set({
            status: 'paid',
            updated_at: sql`now()`,
          })
          .where('id', '=', params.orderId)
          .where('tenant_id', '=', tenantId)
          .execute();
        orderClosed = true;
      }

      return { payment: inserted, replayed: false, orderClosed };
    },

    async voidPayment(trx, tenantId, paymentId, params) {
      // 1. Payment satırını kilitle (SABİT kilit sırası payment→order).
      const payment = await trx
        .selectFrom('payments')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', paymentId)
        .forUpdate()
        .executeTakeFirst();
      if (payment === undefined) {
        throw new RepositoryError('not_found', 'PAYMENT_NOT_FOUND');
      }
      // 2. Çift-void reddi (FOR UPDATE + voided_at kontrolü → K8 iii).
      if (payment.voided_at !== null) {
        throw new RepositoryError('check', 'PAYMENT_ALREADY_VOIDED');
      }

      // 3. Order satırını kilitle (payment'tan SONRA).
      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', payment.order_id)
        .forUpdate()
        .executeTakeFirst();
      if (order === undefined) {
        // FK garantisi altında olmamalı; defansif.
        throw new RepositoryError('not_found', 'ORDER_NOT_FOUND');
      }

      // 4. Order terminal (cancelled/void/merged) → void EDİLEMEZ. 'paid' bu
      //    bağlamda terminal DEĞİL (reopen edilebilir) → ayrı yol (adım 8).
      if (
        order.status === 'cancelled' ||
        order.status === 'void' ||
        order.status === 'merged'
      ) {
        throw new RepositoryError(
          'check',
          'PAYMENT_VOID_ORDER_TERMINAL',
          `status=${order.status}`,
        );
      }

      // 5. K5 — reopen yalnız dine_in. Takeaway paid/delivered void + stage
      //    geri-alma karmaşık → v5.1.
      if (order.order_type !== 'dine_in') {
        throw new RepositoryError(
          'check',
          'PAYMENT_VOID_TAKEAWAY_UNSUPPORTED',
          `type=${order.order_type}`,
        );
      }

      // 6. K2 — aynı-gün guard. Karşılaştırma PG'de (JS date-parse tuzağı yok);
      //    order FOR UPDATE kilitli → store_date tutarlı. store_date(now(),
      //    0::smallint, tz) takeaway paritesi (cutoff YOK — Migration 026).
      const dayGuard = await trx
        .selectFrom('orders as o')
        .innerJoin('tenant_settings as ts', 'ts.tenant_id', 'o.tenant_id')
        .select(
          sql<boolean>`o.store_date < store_date(now(), 0::smallint, ts.timezone::text)`.as(
            'cross_day',
          ),
        )
        .where('o.id', '=', order.id)
        .where('o.tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();
      if (dayGuard.cross_day) {
        throw new RepositoryError(
          'check',
          'PAYMENT_VOID_CROSS_DAY',
          `store_date=${String(order.store_date)}`,
        );
      }

      // 7. UPDATE payment → soft-void (all-or-none: üç alan birlikte, Migration 044
      //    CHECK zorlar). RETURNING → voided_* dolu güncel satır.
      const voidedPayment = (await trx
        .updateTable('payments')
        .set({
          voided_at: sql`now()`,
          voided_by_user_id: params.actorUserId,
          void_reason_code: params.reasonCode,
        })
        .where('id', '=', paymentId)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .executeTakeFirstOrThrow()) as PaymentRow;

      // 8. Koşullu auto-reopen (K3 adım 6). Order 'paid' ise close-invariant kesin
      //    bozuldu (close tam-eşitlikti, her ödeme amount>0 → SUM artık < payable)
      //    → reopen. Non-terminal (open/working) ise dokunma (kısmi ödeme geri
      //    alındı, order açık kalır → remaining artar).
      let reopened = false;
      if (order.status === 'paid') {
        try {
          await trx
            .updateTable('orders')
            .set({ status: 'open', updated_at: sql`now()` })
            .where('id', '=', order.id)
            .where('tenant_id', '=', tenantId)
            .execute();
          reopened = true;
        } catch (err) {
          // Reopen orders_tenant_table_open_uq (Mig041) tetikler: masada başka
          // aktif sipariş varsa 23505 → TABLE_ALREADY_OCCUPIED + TÜM tx rollback
          // (void da geri alınır — void+reopen bölünemez, K3 adım 7). throw →
          // caller transaction rollback.
          const mapped = mapPgError(err);
          if (mapped?.cause === 'unique') {
            throw new RepositoryError('unique', 'TABLE_ALREADY_OCCUPIED');
          }
          if (mapped !== null) throw mapped;
          throw err;
        }
      }

      // 9. Güncel order satırı (reopen sonrası status='open').
      const refreshedOrder = (await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', order.id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow()) as VoidedOrderRow;

      return { payment: voidedPayment, order: refreshedOrder, reopened };
    },
  };
}
