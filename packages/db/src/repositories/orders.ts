import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type {
  DB,
  Orders,
  OrderItems,
  OrderItemAttributes,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  TakeawayStage,
} from '../generated.js';
import { tableLabel } from '@restoran-pos/shared-domain';
import { mapPgError, RepositoryError } from '../errors.js';
// ADR-029 — `merged` yeni terminal statüsü tüm aktif/terminal türetimlerine
// sızmalı; kanonik liste ayrı modülde (repository'ler arası circular import
// önlemi). Public API'nin `TERMINAL_ORDER_STATUSES` importu korunsun diye
// buradan re-export edilir.
export { TERMINAL_ORDER_STATUSES } from './order-status.js';
import { TERMINAL_ORDER_STATUSES } from './order-status.js';

/** Kysely executor — top-level connection veya açık transaction. */
type DbExecutor = Kysely<DB> | Transaction<DB>;

/**
 * ADR-017 §2 — Takeaway sipariş create payload (repository-ready).
 * Caller (route/service) snapshot/total hesaplarını yapıp hazır verir.
 * Para birimi integer kuruş; UI'dan gelen değerler önceden doğrulanır.
 */
export interface CreateTakeawayOrderRow {
  /** UUID v7, caller üretir. */
  id: string;
  tenantId: string;
  /** ADR-017 §2: takeaway için zorunlu (DB CHECK). */
  customerId: string;
  /** ADR-008 §4.1: actor (admin/cashier/waiter) user_id. ABAC waiter scope
   *  filter'ı bunu kullanır (waiter sadece kendi siparişlerini görür). */
  waiterUserId?: string | null;
  /** Caller-resolved adres referansı; orders tablosunda persist edilmez,
   *  audit/log için ihtiyaç olduğunda. */
  customerAddressId?: string | null;
  /** ADR §3: opsiyonel — "Müşteri kendi alacak" akışında null. */
  deliveryAddressSnapshot?: string | null;
  deliveryNote?: string | null;
  plannedPaymentType: 'cash' | 'card';
  items: Array<{
    productId: string;
    productNameSnapshot: string;
    quantity: number;
    unitPriceCents: number;
    notes?: string | null;
    /** Actor rozeti (ADR-013 §5 + Migration 019). dine_in'le aynı pattern;
     *  caller route handler users.username/full_name lookup'ı yapar. */
    createdByUserId?: string | null;
    createdByName?: string | null;
  }>;
  /** Subtotal/tax bilgi amaçlı; orders tablosunda yalnız total persist edilir. */
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/** Detaylı takeaway sipariş projeksiyonu — items + customer (+ phones). */
export interface TakeawayOrderDetail {
  order: Selectable<Orders>;
  items: Array<Selectable<OrderItems>>;
  customer: {
    id: string;
    full_name: string;
    phones: Array<{ id: string; normalized_phone: string }>;
  } | null;
}

/** Masalar sağ paneli kart projeksiyonu (open takeaway listesi). */
export interface OpenTakeawayOrderSummary {
  id: string;
  order_no: number;
  customer_id: string | null;
  customer_name: string | null;
  total_cents: number;
  takeaway_stage: TakeawayStage;
  planned_payment_type: 'cash' | 'card' | null;
  created_at: Date;
}

export type OrderRow = Selectable<Orders>;
export type OrderItemAttributeRow = Selectable<OrderItemAttributes>;
/** ADR-013 §10 + §11: persisted satır + nested attribute snapshot. */
export type OrderItemRow = Selectable<OrderItems> & {
  attributes: OrderItemAttributeRow[];
};

export interface CreateOrderParams {
  id: string;
  tableId: string | null;
  orderType: OrderType;
  note?: string | null;
  customerId?: string | null;
  waiterUserId?: string | null;
  /**
   * Session 53b — ADR-003 + ADR-009 Amendment 2026-05-05.
   * tables hard delete pattern'inde rapor invariant'ını korumak için handler
   * INSERT öncesi `table.code` + `area.name` çekip buraya yazar (Migration 030
   * orders.table_code_snapshot + area_name_snapshot kolonları).
   * Takeaway/delivery (tableId === null) → snapshot null kalır.
   */
  tableCodeSnapshot?: string | null;
  areaNameSnapshot?: string | null;
  /**
   * ADR-013 Amendment 1 (FAZ 1 / PR-3) — per-attempt idempotency token.
   * OPSİYONEL (Karar 5): dolu ise `createTx` retry/yarışta `orders.idempotency_key`
   * partial-unique guard'ıyla tek sipariş garantiler (retry → replay); null ise
   * legacy yol (eski APK, guard yok). Payments `idempotency_key` paritesi.
   */
  idempotencyKey?: string | null;
}

/**
 * order_item_attributes insert payload — handler/service katmanında DB'den
 * resolve edilip repo'ya hazır olarak verilir (ADR-013 §10 Karar 10.5,
 * Migration 017). `id` pre-generated UUID; FK doğrudan DB'ye yazılır,
 * isim + fiyat snapshot'lar audit izi için (ADR-003 §7).
 */
export interface OrderItemAttributeSnapshot {
  id: string;
  attributeGroupId: string;
  attributeOptionId: string;
  groupNameSnapshot: string;
  optionNameSnapshot: string;
  extraPriceCentsSnapshot: number;
}

/**
 * order_items insert payload — handler katmanında products repo + categories
 * lookup ile snapshot resolve edilip repo'ya **hazır** olarak verilir.
 * Repo iş kuralı bilmez (price hesabı, vat_rate vs. handler/service sorumluluğu).
 *
 * `id` her satır için pre-generated UUID. `totalCents` = unit_price_cents × qty
 * (UI'dan değil server hesabından gelmeli — ADR-013 §2 snapshot kuralı).
 *
 * `attributes` (PR-6 / ADR-013 §10): order_item_attributes nested insert için
 * hazır snapshot listesi; boş array özellik seçilmediği anlamına gelir.
 */
export interface OrderItemSnapshot {
  id: string;
  productId: string | null;
  productName: string;
  categoryNameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  totalCents: number;
  note?: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  attributes?: OrderItemAttributeSnapshot[];
  /** ADR-013 §11 — porsiyon snapshot (Migration 021). */
  variantIdSnapshot?: string | null;
  variantNameSnapshot?: string | null;
  variantPriceDeltaCentsSnapshot?: number | null;
}

export interface OrderListFilters {
  status?: OrderStatus;
  tableId?: string;
  /**
   * İş-günü filtresi — `YYYY-MM-DD` STRING (ADR-015 Amd5 K10 deseni): JS Date
   * bağlaması node-pg'de süreç-TZ'siyle serialize edilir (UTC-batısı host'ta
   * D-1'e kayardı); string `::date` cast'i TZ-bağımsızdır.
   */
  storeDate?: string;
  orderType?: OrderType;
  /**
   * ABAC waiter scope filter (ADR-008 §1/§2). Repo role-agnostic; karar
   * route handler'da verilir. SQL three-valued logic gereği `=` operatörü
   * NULL `waiter_user_id` satırları otomatik dışlar.
   */
  waiterUserId?: string;
  /**
   * ABAC garson tenant-geneli açık adisyon kapsamı (ADR-008 Amendment
   * 2026-06-28 / ADR-025 K4). `true` → yalnız terminal olmayan siparişler
   * (`status NOT IN (paid, cancelled, void)`). Kapalı/historical siparişler
   * garsona görünmez (onlar rapor = admin/cashier). Repo role-agnostic;
   * kararı route handler verir.
   */
  openOnly?: boolean;
}

export interface OrderWithItems {
  order: OrderRow;
  items: OrderItemRow[];
}

/**
 * ADR-013 Amendment 1 (FAZ 1 / PR-3) — idempotent sipariş-yazma dönüşü.
 * `createTx` + `addItemsTx` bunu döndürür. `replayed` sinyali route'un yan-etki
 * (KDS enqueue + realtime emit) bastırma kararını verir (Karar 6): replay =
 * mutation olmadı → tekrar-fiş/emit YOK. Payments `CreatePaymentTxResult.replayed`
 * paritesi.
 */
export interface OrderIdempotentWriteResult extends OrderWithItems {
  /** true → idempotency replay (mevcut sipariş döndü, INSERT olmadı). */
  replayed: boolean;
}

export interface UpdateOrderItemParams {
  note?: string | null;
  /** Yalnız 'cancelled' MVP'de — diğer FSM geçişleri Phase 3. */
  status?: 'cancelled';
  isComped?: boolean;
}

/**
 * ADR-024 K1/K3 — `updateItemTx` dönüşü. `OrderWithItems`'a ek olarak audit
 * için before-değerleri taşır; route bunlarla `order_item.comped` /
 * `order_item.voided` payload'ını kurar ve **gerçek değişim** olup olmadığını
 * (no-op toggle audit yazmaz) belirler. Tüm alanlar UUID/integer/boolean/enum —
 * PII yok (comp_reason kolonu YOK, v5.1).
 */
export interface UpdateItemTxResult extends OrderWithItems {
  /** Değişen kalemin DB snapshot'ı (route audit payload + total_cents için). */
  itemBefore: {
    productId: string | null;
    isComped: boolean;
    status: OrderItemStatus;
    totalCents: number;
  };
}

export interface OrdersRepository {
  /**
   * Atomic order create — items array verilirse aynı transaction'da
   * order + order_items insert + orders.total_cents recalc (ADR-013 §1).
   * items boş/yok ise header-only insert (PR-1 davranışı geriye uyumluluk).
   */
  create(
    tenantId: string,
    params: CreateOrderParams,
    items?: OrderItemSnapshot[],
  ): Promise<OrderRow>;
  /**
   * ADR-013 Amendment 1 K7 — `create` tx-variant + idempotency guard. Route bunu
   * `db.transaction()` içinde çağırır; `replayed` sinyaliyle yan-etki (KDS/emit)
   * kararını verir (Karar 6). Akış: (1) `params.idempotencyKey` varsa tx-içi
   * pre-check SELECT → mevcut sipariş varsa masa-doluluk 409'una TAKILMADAN replay
   * döner (Karar 7 — retry 200-not-409). (2) INSERT orders `ON CONFLICT
   * (tenant_id, idempotency_key) WHERE ... IS NOT NULL DO NOTHING` (partial index
   * arbiter). (3) 0 satır (aynı-key yarışı) → aborted-tx-safe replay SELECT
   * (catch-23505-recovery KULLANMA — DB-TX-05). Public `create` bunu sarmalar.
   */
  createTx(
    trx: Transaction<DB>,
    tenantId: string,
    params: CreateOrderParams,
    items?: OrderItemSnapshot[],
  ): Promise<OrderIdempotentWriteResult>;
  /**
   * Mevcut siparişe kalem ekleme — atomik transaction.
   * order.status closed/cancelled ise reddeder (handler 409).
   */
  addItems(
    tenantId: string,
    orderId: string,
    items: OrderItemSnapshot[],
  ): Promise<OrderWithItems>;
  /**
   * ADR-013 Amendment 1 K7 — `addItems` tx-variant + batch-marker idempotency.
   * `batchKey` dolu ise (1) `order_item_batches`'e INSERT `ON CONFLICT
   * (tenant_id, batch_key) DO NOTHING`; (2) 0 satır (retry/yarış) → kalem EKLEME,
   * güncel siparişi döndür (`replayed: true`); (3) satır girdiyse kalem-insert +
   * `replayed: false`. `batchKey` null ise legacy: doğrudan insert (bugünkü
   * davranış). Route `if (!replayed)` ile KDS enqueue + emit bastırır (Karar 6).
   */
  addItemsTx(
    trx: Transaction<DB>,
    tenantId: string,
    orderId: string,
    items: OrderItemSnapshot[],
    batchKey?: string | null,
    createdByUserId?: string | null,
  ): Promise<OrderIdempotentWriteResult>;
  /**
   * Persisted kalem partial update (ADR-013 §6 + §9.2). Atomik transaction:
   *   1. SELECT item + order JOIN (status kontrolü)
   *   2. UPDATE order_items (note/status/is_comped)
   *   3. status='cancelled' veya is_comped değişimi → orders.total_cents recalc
   *
   * status='cancelled' kalemler total_cents hesabından düşer (`is_comped=true`
   * de aynı mantıkla — comp_amount kolonu yok, ADR-013 §9.3).
   *
   * Hatalar:
   *   - ITEM_NOT_FOUND (handler'da 404)
   *   - ORDER_INVARIANT_VIOLATED (handler'da 409): closed/cancelled order
   */
  updateItem(
    tenantId: string,
    orderId: string,
    itemId: string,
    params: UpdateOrderItemParams,
  ): Promise<OrderWithItems>;
  /**
   * ADR-024 K1 — `updateItem` tx-variant. Caller-owned transaction; route
   * `db.transaction()` açıp aynı tx'te `writeAudit(trx)` çağırabilsin diye
   * (ADR-002 §10.4). Gövde `updateItem` ile BİREBİR aynı; public `updateItem`
   * bunu sarmalar. Ek olarak audit için **before-değerleri** döndürür: route
   * gerçek değişimi (before != after) tespit edip no-op'ta audit atlar (K3).
   */
  updateItemTx(
    trx: Transaction<DB>,
    tenantId: string,
    orderId: string,
    itemId: string,
    params: UpdateOrderItemParams,
  ): Promise<UpdateItemTxResult>;
  findMany(tenantId: string, filters?: OrderListFilters): Promise<OrderRow[]>;
  findByIdWithItems(
    tenantId: string,
    orderId: string,
  ): Promise<OrderWithItems | null>;
  /**
   * ADR-014 §9 Karar 9.6 — sipariş iptali (3-nokta menü "Siparişi İptal Et").
   * Atomik transaction:
   *   1. SELECT order FOR UPDATE — terminal status (paid/cancelled/void) reddi
   *   2. UPDATE orders SET status='cancelled', updated_at=now()
   *   3. UPDATE order_items SET status='cancelled' WHERE order_id=? (kalemleri de cancel)
   *   4. orders.total_cents = 0 recalc (tüm kalemler cancelled)
   *
   * NOT: payments yatırılmış sipariş iptal edilirse `paid` status olamaz; bu
   * durumda 409 ORDER_INVARIANT_VIOLATED. Refund akışı v5.1+.
   */
  cancelOrder(
    tenantId: string,
    orderId: string,
  ): Promise<OrderWithItems>;
  /**
   * ADR-014 Amd1 K2 — `cancelOrder` tx-variant. Caller-owned transaction;
   * route, kalem-iptal tx'i içinde son-canlı-kalem otomatik iptalini ve
   * `order.cancelled` audit'ini AYNI tx'te koşabilsin diye. Gövde
   * `cancelOrder` ile BİREBİR aynı; public `cancelOrder` bunu sarmalar
   * (ADR-024 K1 payOrder/payOrderTx paterni).
   */
  cancelOrderTx(
    trx: Transaction<DB>,
    tenantId: string,
    orderId: string,
  ): Promise<OrderWithItems>;

  /**
   * ADR-014 §10 Karar 10.4 — Mod B "Masayı Kapat" (zaten tamamen ödenmiş
   * sipariş close). Atomik transaction:
   *   1. SELECT order FOR UPDATE — terminal reddi
   *   2. SUM(payments.amount_cents) >= orders.total_cents kontrol
   *      → eksikse PAYMENT_INSUFFICIENT_FOR_CLOSE
   *   3. UPDATE orders SET status='paid', updated_at=now()
   */
  payOrder(tenantId: string, orderId: string): Promise<OrderWithItems>;
  /**
   * ADR-024 K1 — `payOrder` tx-variant (Mod B close). Caller-owned transaction;
   * route aynı tx'te `order.paid` audit yazabilsin diye. Gövde `payOrder` ile
   * BİREBİR aynı (#193 close-validation davranışı DEĞİŞMEZ). Public `payOrder`
   * bunu sarmalar.
   */
  payOrderTx(
    trx: Transaction<DB>,
    tenantId: string,
    orderId: string,
  ): Promise<OrderWithItems>;

  // ============================================================
  // ADR-017 — Takeaway (paket servis) akışı (Session B)
  // Caller-owned transaction pattern. Route handler `db.transaction()`
  // açar, repository method'una `tx` (Transaction<DB>) verir; böylece
  // aynı tx içinde audit log + socket emit invariant'larını koruyabilir.
  // ============================================================

  /**
   * Atomik takeaway sipariş insert — orders + order_items.
   * - `takeaway_stage='preparing'`, `status='open'` zorunlu (DB CHECK §28).
   * - `customer_id` zorunlu (DB CHECK §28).
   * - order_no aynı (tenant, store_date) için artar (000_init order_no_counters).
   * - total_cents caller'dan gelir (UI değil, server hesabı — caller validate).
   * - items snapshot: product_name + category_name (kategori snapshot YOK
   *   bu akışta — caller doldurmazsa boş string yazılır; ileride genişletilebilir).
   *
   * Returns: yeni order id.
   */
  createTakeawayOrder(
    tx: Transaction<DB>,
    row: CreateTakeawayOrderRow,
  ): Promise<string>;

  /**
   * Sipariş detay — items + customer + phones join. Tenant-scoped (cross
   * tenant null). DbExecutor: route'tan gelen db veya açık tx.
   */
  findOrderById(
    db: DbExecutor,
    tenantId: string,
    orderId: string,
  ): Promise<TakeawayOrderDetail | null>;

  /**
   * Açık takeaway siparişler (Masalar sağ paneli). Partial index kullanır:
   *   WHERE order_type='takeaway' AND status='open'
   * Sıralama: created_at DESC. Customer name LEFT JOIN.
   */
  listOpenTakeawayOrders(
    db: DbExecutor,
    tenantId: string,
  ): Promise<OpenTakeawayOrderSummary[]>;

  /**
   * Atomik stage transition (ADR-017 §4). Tek SQL UPDATE…RETURNING:
   *   WHERE tenant_id=$1 AND id=$2 AND order_type='takeaway'
   *         AND status='open' AND takeaway_stage=$fromStage
   * RETURNING boşsa rowCount=0 → caller 409 döner.
   *
   * `toStage='delivered'` özel akış: aynı tx içinde
   *   - orders.status='paid' set
   *   - payments INSERT (idempotency_key='takeaway:'+orderId,
   *     ON CONFLICT DO NOTHING) → çift delivered idempotent
   *   - amount_cents = orders.total_cents (CHECK > 0; 0 ise insert atlanır)
   *
   * NOT: payment scope='full_order', payment_type=order.planned_payment_type;
   * planned_payment_type NULL ise (eski satır) cash varsayılır defansif olarak
   * — ancak yeni takeaway siparişlerde NOT NULL'a yakın (CHECK constraint
   * planlamada yok, caller her zaman set ediyor).
   */
  updateTakeawayStage(
    tx: Transaction<DB>,
    tenantId: string,
    orderId: string,
    fromStage: TakeawayStage,
    toStage: TakeawayStage,
  ): Promise<{ rowCount: 0 | 1; paid?: boolean }>;

  /**
   * Takeaway iptali — yalnız `status='open' AND takeaway_stage='preparing'`.
   * Diğer durumlarda rowCount=0 (caller 409 / 404 ayırımını HTTP'da yapar).
   * order_items hepsi cancelled, total_cents=0.
   */
  cancelTakeawayOrder(
    tx: Transaction<DB>,
    tenantId: string,
    orderId: string,
  ): Promise<{ rowCount: 0 | 1 }>;

  /**
   * Session 53 — PATCH /orders/:id/customer (v3 paritesi).
   *
   * Persisted siparişe müşteri ata / kaldır. `order_type` DEĞİŞMEZ — yalnız
   * `customer_id` UPDATE edilir. Caller-owned transaction.
   *
   * Validasyon (RepositoryError ile sinyal):
   *   - ORDER_NOT_FOUND (not_found): sipariş yok / başka tenant
   *   - ORDER_INVARIANT_VIOLATED (check): terminal status (paid|cancelled|void)
   *   - TAKEAWAY_CUSTOMER_REQUIRED (check): takeaway + customerId=null
   *     (Migration 028 CHECK constraint defansı, handler önce reddeder).
   *   - CUSTOMER_NOT_FOUND (not_found): customerId verildi ama
   *     customers.deleted_at IS NOT NULL veya cross-tenant.
   *   - CUSTOMER_BLACKLISTED (check): müşteri kara listede (ADR-016 §11).
   *
   * No-op (zaten aynı customer): UPDATE atlanır, customerIdBefore döner.
   */
  assignCustomer(
    tx: Transaction<DB>,
    tenantId: string,
    orderId: string,
    customerId: string | null,
  ): Promise<{ customerIdBefore: string | null }>;

  /**
   * ADR-028 — Masayı Değiştir. Aktif dine_in siparişi aynı tenant içinde BAŞKA
   * bir BOŞ masaya taşır. Caller-owned transaction (route audit'i aynı tx'te
   * yazar, ADR-002 §10.4). `assignCustomer` presedentinin ikizi.
   *
   * Adımlar (tek tx, satır kilitli):
   *   1. SELECT order FOR UPDATE (tenant-scoped) → yoksa ORDER_NOT_FOUND.
   *   2. order_type === 'dine_in' değilse ORDER_NOT_DINE_IN.
   *   3. status terminal (paid|cancelled|void) ise ORDER_ALREADY_CLOSED.
   *   4. targetTableId === order.table_id ise TABLE_MOVE_SAME_TABLE (no-op reddi).
   *   5. Hedef masa yok / cross-tenant / deleted → TABLE_NOT_FOUND.
   *   6. Hedef masa dolu (aktif sipariş) → TABLE_ALREADY_OCCUPIED (app-level +
   *      23505 partial unique index atomik backstop).
   *   7. UPDATE table_id + snapshot (create'teki tableLabel()+areas.name deriv;
   *      hedef bölgesiz/orphan → area_name_snapshot=NULL). updated_at trigger
   *      ile otomatik bump; created_at/store_date DOKUNULMAZ.
   *
   * Döner: audit için before/after kanıt alanları
   *   { fromTableId, toTableId, fromTableCode, toTableCode }.
   *
   * Hatalar (RepositoryError ile sinyal, route HTTP'ye map eder):
   *   - ORDER_NOT_FOUND (not_found) / ORDER_NOT_DINE_IN (check) /
   *     ORDER_ALREADY_CLOSED (check) / TABLE_MOVE_SAME_TABLE (check) /
   *     TABLE_NOT_FOUND (not_found) / TABLE_ALREADY_OCCUPIED (unique)
   */
  moveToTable(
    tx: Transaction<DB>,
    tenantId: string,
    orderId: string,
    targetTableId: string,
  ): Promise<{
    fromTableId: string | null;
    toTableId: string;
    fromTableCode: string | null;
    toTableCode: string | null;
  }>;

  /**
   * ADR-029 — Adisyon Birleştir. Kaynak dolu masanın adisyonunu (sourceOrderId)
   * `targetTableId` ile seçilen BAŞKA bir DOLU masanın aktif adisyonuna aktarır:
   * kaynak `order_items` hedef siparişe re-parent edilir, hedef `total_cents`
   * yeniden hesaplanır, kaynak sipariş terminal (`merged` + `merged_into_order_id`)
   * olur → kaynak masa boşalır. Caller-owned transaction (route audit'i aynı
   * tx'te yazar, ADR-002 §10.4). `moveToTable` presedentinin ikizi (fark: hedef
   * DOLU, kalemler re-parent, kaynak terminal).
   *
   * Adımlar (tek tx, her iki sipariş id-sırasıyla FOR UPDATE — deadlock-safe):
   *   1. Kaynak sipariş (tenant-scoped) → yoksa ORDER_NOT_FOUND.
   *   2. Hedef masanın aktif siparişi (non-terminal) → yoksa MERGE_TARGET_NOT_OCCUPIED.
   *   3. Her iki satırı id-sırasıyla tek sorguda FOR UPDATE kilitle.
   *   4. Guard: kaynak ≠ hedef sipariş (MERGE_SAME_ORDER) · her ikisi dine_in
   *      (ORDER_NOT_DINE_IN) · her ikisi non-terminal (ORDER_ALREADY_CLOSED) ·
   *      kaynak+hedef ödemesiz (ORDER_HAS_PAYMENTS).
   *   5. UPDATE order_items SET order_id=<hedef> WHERE order_id=<kaynak> (snapshot
   *      kolonları DOKUNULMAZ — ADR-003 §7, K2 APPEND). Taşınan kalem sayısını al.
   *   6. Hedef orders.total_cents recalc (SUM WHERE status!='cancelled' AND !is_comped).
   *   7. Kaynak status='merged', merged_into_order_id=<hedef>.
   *
   * Döner: audit + emit + response projeksiyonu için gereken kanıt alanları.
   *
   * Hatalar (RepositoryError ile sinyal, route HTTP'ye map eder):
   *   - ORDER_NOT_FOUND (not_found) / MERGE_TARGET_NOT_OCCUPIED (check) /
   *     MERGE_SAME_ORDER (check) / ORDER_NOT_DINE_IN (check) /
   *     ORDER_ALREADY_CLOSED (check) / ORDER_HAS_PAYMENTS (check)
   */
  mergeInto(
    tx: Transaction<DB>,
    tenantId: string,
    sourceOrderId: string,
    targetTableId: string,
  ): Promise<{
    sourceOrderId: string;
    targetOrderId: string;
    sourceTableId: string | null;
    targetTableId: string | null;
    sourceTableCode: string | null;
    movedItemCount: number;
    oldTargetTotalCents: number;
    newTargetTotalCents: number;
  }>;
}

/**
 * Bu repo SADECE `Kysely<DB>` alır (Transaction<DB> değil), çünkü tüm
 * mutation metodları `db.transaction().execute(...)` çağırıyor —
 * Transaction<DB> üzerinde `.transaction()` yasak. Caller-owned transaction
 * pattern'ine geçiş ayrı ADR + PR.
 */
export function createOrdersRepository(db: Kysely<DB>): OrdersRepository {
  /**
   * order_items + nested order_item_attributes batch fetch (caller'a ait
   * transaction context). findByIdWithItems / addItems / updateItem üç noktada
   * aynı şekilde yapıştırma için helper.
   */
  async function fetchItemsWithAttributes(
    exec: Kysely<DB> | Transaction<DB>,
    tenantId: string,
    orderId: string,
  ): Promise<OrderItemRow[]> {
    const items = await exec
      .selectFrom('order_items')
      .selectAll()
      .where('order_id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .execute();
    if (items.length === 0) return [];
    const itemIds = items.map((i) => i.id);
    const attrRows = await exec
      .selectFrom('order_item_attributes')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('order_item_id', 'in', itemIds)
      .orderBy('created_at', 'asc')
      .execute();
    const attrsByItem = new Map<string, OrderItemAttributeRow[]>();
    for (const a of attrRows) {
      const list = attrsByItem.get(a.order_item_id);
      if (list === undefined)
        attrsByItem.set(a.order_item_id, [a as OrderItemAttributeRow]);
      else list.push(a as OrderItemAttributeRow);
    }
    return items.map((it) => ({
      ...it,
      attributes: attrsByItem.get(it.id) ?? [],
    })) as OrderItemRow[];
  }

  /**
   * INSERT order_items batch + orders.total_cents recalc — ortak yardımcı.
   * Caller (create / addItems) zaten transaction context'i sağlar (trx).
   * Boş items dizisi no-op döner.
   */
  async function insertItemsAndRecalc(
    trx: Transaction<DB>,
    tenantId: string,
    orderId: string,
    items: OrderItemSnapshot[],
  ): Promise<void> {
    if (items.length === 0) return;

    await trx
      .insertInto('order_items')
      .values(
        items.map((it) => ({
          id: it.id,
          tenant_id: tenantId,
          order_id: orderId,
          product_id: it.productId,
          product_name: it.productName,
          category_name_snapshot: it.categoryNameSnapshot,
          unit_price_cents: it.unitPriceCents,
          quantity: it.quantity,
          total_cents: it.totalCents,
          note: it.note ?? null,
          created_by_user_id: it.createdByUserId,
          created_by_name: it.createdByName,
          variant_id_snapshot: it.variantIdSnapshot ?? null,
          variant_name_snapshot: it.variantNameSnapshot ?? null,
          variant_price_delta_cents_snapshot:
            it.variantPriceDeltaCentsSnapshot ?? null,
        })),
      )
      .execute();

    // PR-6 (ADR-013 §10 Karar 10.5): nested attribute snapshot insert,
    // aynı transaction. Boş özellik listesine sahip kalemler atlanır.
    const attributeRows = items.flatMap((it) =>
      (it.attributes ?? []).map((a) => ({
        id: a.id,
        tenant_id: tenantId,
        order_item_id: it.id,
        attribute_group_id: a.attributeGroupId,
        attribute_option_id: a.attributeOptionId,
        group_name_snapshot: a.groupNameSnapshot,
        option_name_snapshot: a.optionNameSnapshot,
        extra_price_cents_snapshot: a.extraPriceCentsSnapshot,
      })),
    );
    if (attributeRows.length > 0) {
      await trx.insertInto('order_item_attributes').values(attributeRows).execute();
    }

    // orders.total_cents = SUM(order_items.total_cents) — iptal edilmiş ve
    // ikram (comped) kalemler HARİÇ. Filtre updateItemTx (859) ve mergeInto
    // (1614) recalc'larıyla birebir: iptal edilen bir kalemin tutarı yeni
    // kalem eklenince "dirilmez" (MONEY-01). Tek UPDATE, tx içinde race-free.
    await trx
      .updateTable('orders')
      .set({
        total_cents: sql<number>`(SELECT COALESCE(SUM(total_cents), 0)
                                   FROM order_items
                                   WHERE order_id = ${orderId}
                                     AND tenant_id = ${tenantId}
                                     AND status != 'cancelled'
                                     AND is_comped = false)`,
        updated_at: new Date(),
      })
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  return {
    /**
     * items? verilirse aynı transaction'da nested insert.
     * store_date: ADR-015 Amd5 K3 — caller hesaplamaz; tx-içi SQL
     * `store_date(now(),0,tz)` (trigger ile aynı an, R7-TZ-13).
     */
    // ADR-013 Amendment 1 K7 — public `create` artık `createTx`'i saran ince
    // delege (payments `create`/`createTx` paritesi). Davranış birebir; ek
    // idempotency guard yalnız `params.idempotencyKey` dolu iken devreye girer.
    async create(tenantId, params, items = []) {
      const result = await db
        .transaction()
        .execute((trx) => this.createTx(trx, tenantId, params, items));
      return result.order;
    },

    async createTx(trx, tenantId, params, items = []) {
      // ADR-013 Amd1 K7 — idempotency pre-check ÖNCE gelir: başarılı bir create'in
      // retry'ı masa-doluluk 409'una TAKILMADAN 200 replay döner (Bağlam
      // belirsizliği çözülür). Yalnız key dolu iken anlamlı.
      if (params.idempotencyKey != null) {
        const existing = await trx
          .selectFrom('orders')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('idempotency_key', '=', params.idempotencyKey)
          .executeTakeFirst();
        if (existing !== undefined) {
          const existingItems = await fetchItemsWithAttributes(
            trx,
            tenantId,
            existing.id,
          );
          return { order: existing, items: existingItems, replayed: true };
        }
      }

      // dine_in için masa rezervasyon kontrolü
      if (params.orderType === 'dine_in' && params.tableId !== null) {
        const occupying = await trx
          .selectFrom('orders')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('table_id', '=', params.tableId)
          // ADR-029: aktif = terminal-hariç (merged dahil terminal). Kanonik
          // TERMINAL_ORDER_STATUSES — merged sipariş masayı bloke etmez.
          .where('status', 'not in', [...TERMINAL_ORDER_STATUSES])
          .executeTakeFirst();
        if (occupying !== undefined) {
          throw new RepositoryError('unique', 'TABLE_ALREADY_OCCUPIED');
        }
      }

      // ADR-015 Amd5 K3 (R7-TZ-13) — business_date tx-içi SQL'de hesaplanır:
      // trigger `populate_order_store_date` NEW.created_at (=now(), tx-sabiti)
      // üzerinden aynı `store_date(ts,0,tz)` fonksiyonunu koşar → sayaç günü
      // ile satırın store_date'i yapısal olarak aynı (JS-Date ırkı kapandı).
      // Desen: createTakeawayOrder (aşağıda) ile birebir.
      const tzRowForDate = await trx
        .selectFrom('tenant_settings')
        .select(['timezone'])
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();
      const storeDateRow = await trx
        .selectNoFrom((eb) =>
          eb
            .fn<Date>('store_date', [
              sql`now()`,
              sql`0::smallint`,
              sql`${tzRowForDate.timezone}::text`,
            ])
            .as('d'),
        )
        .executeTakeFirstOrThrow();
      const storeDate = storeDateRow.d as unknown as Date;

      // Atomik order_no counter
      const counter = await trx
        .insertInto('order_no_counters')
        .values({
          tenant_id: tenantId,
          business_date: storeDate,
          last_no: 1,
        })
        .onConflict((oc) =>
          oc
            .columns(['tenant_id', 'business_date'])
            .doUpdateSet({
              last_no: sql<number>`order_no_counters.last_no + 1`,
            }),
        )
        .returning('last_no')
        .executeTakeFirstOrThrow();

      // ADR-013 Amd1 K7 — INSERT + ON CONFLICT (tenant_id, idempotency_key) WHERE
      // IS NOT NULL DO NOTHING (partial index arbiter). Aynı-key yarışını kaybeden
      // istek 0 satır alır (hata FIRLATMAZ) → tx sağlıklı → aborted-tx-safe replay
      // SELECT (DB-TX-05: catch-23505 sonrası recovery-SELECT aborted-tx'te 25P02
      // ile patlıyordu). Key null (legacy) ise partial index'e girmez, çakışmaz.
      let inserted: OrderRow | undefined;
      try {
        inserted = (await trx
          .insertInto('orders')
          .values({
            id: params.id,
            tenant_id: tenantId,
            table_id: params.tableId,
            order_type: params.orderType,
            order_no: counter.last_no,
            store_date: storeDate,
            customer_id: params.customerId ?? null,
            note: params.note ?? null,
            waiter_user_id: params.waiterUserId ?? null,
            // Session 53b — ADR-003 §7 snapshot invariant. Masa veya bölge
            // ileride hard delete edilse bile rapor query'leri buradan okur.
            table_code_snapshot: params.tableCodeSnapshot ?? null,
            area_name_snapshot: params.areaNameSnapshot ?? null,
            idempotency_key: params.idempotencyKey ?? null,
          })
          .onConflict((oc) =>
            oc
              .columns(['tenant_id', 'idempotency_key'])
              .where('idempotency_key', 'is not', null)
              .doNothing(),
          )
          .returningAll()
          .executeTakeFirst()) as OrderRow | undefined;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'check') {
          throw new RepositoryError('check', 'ORDER_INVARIANT_VIOLATED', mapped.detail);
        }
        if (mapped?.cause === 'foreign_key') {
          const detail = mapped.detail ?? '';
          if (detail.includes('table_id')) {
            throw new RepositoryError('foreign_key', 'TABLE_NOT_FOUND', mapped.detail);
          }
          if (detail.includes('customer_id')) {
            throw new RepositoryError('foreign_key', 'CUSTOMER_NOT_FOUND', mapped.detail);
          }
          throw err;
        }
        if (mapped !== null) throw mapped;
        throw err;
      }

      if (inserted === undefined) {
        // Aynı-key create yarışını kaybeden istek — conflict yutuldu, tx sağlıklı.
        // (order_no counter bu dalda tüketildi = nadir yarışta numara boşluğu,
        // ADR-013 §11 tolere edilir.) Replay SELECT güvenli.
        const replay = await trx
          .selectFrom('orders')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('idempotency_key', '=', params.idempotencyKey!)
          .executeTakeFirstOrThrow();
        const replayItems = await fetchItemsWithAttributes(trx, tenantId, replay.id);
        return { order: replay, items: replayItems, replayed: true };
      }

      // Nested items insert + total_cents recalc
      if (items.length > 0) {
        await insertItemsAndRecalc(trx, tenantId, inserted.id, items);
      }
      // Recalc sonrası taze order satırı (total_cents güncel) + canonical items.
      const finalOrder =
        items.length > 0
          ? await trx
              .selectFrom('orders')
              .selectAll()
              .where('id', '=', inserted.id)
              .where('tenant_id', '=', tenantId)
              .executeTakeFirstOrThrow()
          : inserted;
      const itemRows = await fetchItemsWithAttributes(trx, tenantId, inserted.id);
      return { order: finalOrder, items: itemRows, replayed: false };
    },

    // ADR-013 Amendment 1 K7 — public `addItems` `addItemsTx`'i sarar (legacy:
    // batchKey geçilmez → doğrudan insert, bugünkü davranış birebir).
    async addItems(tenantId, orderId, items) {
      const result = await db
        .transaction()
        .execute((trx) => this.addItemsTx(trx, tenantId, orderId, items));
      return { order: result.order, items: result.items };
    },

    async addItemsTx(
      trx,
      tenantId,
      orderId,
      items,
      batchKey = null,
      createdByUserId = null,
    ) {
      // FOR UPDATE — kalem ekleme ile eşzamanlı cancelOrder/payOrderTx
      // (ikisi de order satırını kilitler) yarışını serialize eder; aksi
      // halde "cancelled ama total>0 + aktif kalem" tutarsız state oluşur
      // (DB-TX-01). Kilit alındıktan sonra terminal-status guard okunur.
      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (order === undefined) {
        throw new RepositoryError('not_found', 'ORDER_NOT_FOUND');
      }
      // Closed/cancelled siparişe kalem eklenemez (ADR-013 §6 + v3 paritesi).
      if (
        order.status === 'paid' ||
        order.status === 'cancelled' ||
        order.status === 'void'
      ) {
        throw new RepositoryError('check', 'ORDER_INVARIANT_VIOLATED', `status=${order.status}`);
      }

      // ADR-013 Amd1 K7 — batch-marker idempotency guard (key varsa). INSERT
      // ON CONFLICT (tenant_id, batch_key) DO NOTHING → 0 satır (retry/yarış) →
      // kalem EKLEME, güncel siparişi döndür (replayed). Tam full-unique index
      // (partial değil) → columns() arbiter yeterli.
      if (batchKey != null) {
        let marker: { id: string } | undefined;
        try {
          marker = await trx
            .insertInto('order_item_batches')
            .values({
              id: randomUUID(),
              tenant_id: tenantId,
              order_id: orderId,
              batch_key: batchKey,
              created_by_user_id: createdByUserId,
            })
            .onConflict((oc) => oc.columns(['tenant_id', 'batch_key']).doNothing())
            .returning('id')
            .executeTakeFirst();
        } catch (err) {
          const mapped = mapPgError(err);
          if (mapped !== null) throw mapped;
          throw err;
        }

        if (marker === undefined) {
          // Retry/yarış — batch zaten işlendi. Kalem EKLEME (idempotent); güncel
          // siparişi döndür (aborted-tx-safe: conflict yutuldu, tx sağlıklı).
          const refreshed = await trx
            .selectFrom('orders')
            .selectAll()
            .where('id', '=', orderId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirstOrThrow();
          const replayItems = await fetchItemsWithAttributes(trx, tenantId, orderId);
          return { order: refreshed, items: replayItems, replayed: true };
        }
      }

      // Yeni batch (veya legacy keysiz) — kalem insert + total_cents recalc.
      await insertItemsAndRecalc(trx, tenantId, orderId, items);

      const refreshed = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();

      const itemRows = await fetchItemsWithAttributes(trx, tenantId, orderId);

      return { order: refreshed, items: itemRows, replayed: false };
    },

    async findMany(tenantId, filters = {}) {
      let query = db
        .selectFrom('orders')
        .selectAll()
        .where('tenant_id', '=', tenantId);

      if (filters.status !== undefined) {
        query = query.where('status', '=', filters.status);
      }
      if (filters.tableId !== undefined) {
        query = query.where('table_id', '=', filters.tableId);
      }
      if (filters.storeDate !== undefined) {
        // Amd5 K10 — string + ::date cast (TZ-bağımsız bağlama).
        query = query.where('store_date', '=', sql<Date>`${filters.storeDate}::date`);
      }
      if (filters.orderType !== undefined) {
        query = query.where('order_type', '=', filters.orderType);
      }
      if (filters.waiterUserId !== undefined) {
        query = query.where('waiter_user_id', '=', filters.waiterUserId);
      }
      if (filters.openOnly === true) {
        query = query.where('status', 'not in', TERMINAL_ORDER_STATUSES);
      }

      return query.orderBy('created_at', 'desc').limit(500).execute();
    },

    async findByIdWithItems(tenantId, orderId) {
      const order = await db
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (order === undefined) return null;
      const items = await fetchItemsWithAttributes(db, tenantId, orderId);
      return { order, items };
    },

    // ADR-024 K1 — public `updateItem` artık tx-variant'ı sarmalayan ince
    // delege. Mantık `updateItemTx`'e TAŞINDI (değişMEDİ); davranış birebir.
    // Geriye uyumlu: mevcut çağıranlar (route, testler) dokunulmadan çalışır.
    async updateItem(tenantId, orderId, itemId, params) {
      const result = await db
        .transaction()
        .execute((trx) =>
          this.updateItemTx(trx, tenantId, orderId, itemId, params),
        );
      return { order: result.order, items: result.items };
    },

    async updateItemTx(trx, tenantId, orderId, itemId, params) {
      // Order + item lookup (tenant-scoped, cross-tenant 404).
      // FOR UPDATE — kalem güncelleme ile eşzamanlı cancel/pay yarışını
      // serialize eder (DB-TX-01; addItems ile aynı gerekçe).
      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
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

      const item = await trx
        .selectFrom('order_items')
        .selectAll()
        .where('id', '=', itemId)
        .where('order_id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (item === undefined) {
        throw new RepositoryError('not_found', 'ORDER_ITEM_NOT_FOUND');
      }

      // ADR-024 K3 — before-snapshot (route audit payload + no-op tespiti için).
      const itemBefore = {
        productId: item.product_id,
        isComped: item.is_comped,
        status: item.status,
        totalCents: item.total_cents,
      };

      // Partial update — note her zaman güncellenebilir; status='cancelled'
      // yalnız aktif satırda anlamlı; is_comped toggle (handler RBAC).
      const patch: Partial<OrderItemRow> = {};
      if (params.note !== undefined) patch.note = params.note;
      if (params.status !== undefined) patch.status = params.status;
      if (params.isComped !== undefined) patch.is_comped = params.isComped;

      if (Object.keys(patch).length === 0) {
        // Schema empty_body refine yakalamış olmalı; defansif.
        throw new RepositoryError('check', 'ORDER_INVARIANT_VIOLATED', 'empty patch');
      }

      await trx
        .updateTable('order_items')
        .set(patch)
        .where('id', '=', itemId)
        .where('tenant_id', '=', tenantId)
        .execute();

      // total_cents recalc — cancelled/comped item'lar dışlanır.
      // Comp için ayrı `comped_amount_cents` kolonu yok (ADR-013 §9.3 v5.1 backlog);
      // total_cents direkt aktif+ödenecek tutarı yansıtır.
      const needsRecalc =
        params.status !== undefined || params.isComped !== undefined;
      if (needsRecalc) {
        await trx
          .updateTable('orders')
          .set({
            total_cents: sql<number>`(
              SELECT COALESCE(SUM(total_cents), 0)
              FROM order_items
              WHERE order_id = ${orderId}
                AND tenant_id = ${tenantId}
                AND status != 'cancelled'
                AND is_comped = false
            )`,
            updated_at: new Date(),
          })
          .where('id', '=', orderId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      const refreshed = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();

      const itemRows = await fetchItemsWithAttributes(trx, tenantId, orderId);

      return { order: refreshed, items: itemRows, itemBefore };
    },

    // ADR-024 K1 — public `payOrder` artık tx-variant'ı sarmalayan ince delege.
    // #193 close-validation davranışı `payOrderTx`'e TAŞINDI (bit-identical).
    async payOrder(tenantId, orderId) {
      return db
        .transaction()
        .execute((trx) => this.payOrderTx(trx, tenantId, orderId));
    },

    async payOrderTx(trx, tenantId, orderId) {
      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
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

      // SUM(payments.amount_cents) kontrolü
      const paid = await trx
        .selectFrom('payments')
        .select((eb) =>
          eb.fn.coalesce(eb.fn.sum<number>('amount_cents'), eb.lit(0)).as(
            'paid_total',
          ),
        )
        .where('tenant_id', '=', tenantId)
        .where('order_id', '=', orderId)
        // ADR-033 SUM fan-out — void'lenmiş ödemeler kapanış toplamına SAYILMAZ.
        .where('voided_at', 'is', null)
        .executeTakeFirstOrThrow();
      const paidTotal = Number(paid.paid_total ?? 0);
      if (paidTotal < order.total_cents) {
        throw new RepositoryError(
          'check',
          'PAYMENT_INSUFFICIENT_FOR_CLOSE',
          `paid=${paidTotal} required=${order.total_cents}`,
        );
      }

      await trx
        .updateTable('orders')
        .set({ status: 'paid', updated_at: new Date() })
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const refreshed = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();
      const itemRows = await fetchItemsWithAttributes(trx, tenantId, orderId);
      return { order: refreshed, items: itemRows };
    },

    // ADR-014 Amd1 K2 — public `cancelOrder` artık tx-variant'ı sarmalayan
    // ince delege (payOrder/payOrderTx paterni; davranış bit-identical).
    async cancelOrder(tenantId, orderId) {
      return db
        .transaction()
        .execute((trx) => this.cancelOrderTx(trx, tenantId, orderId));
    },

    async cancelOrderTx(trx, tenantId, orderId) {
      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
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
          'ORDER_CANCEL_NOT_ALLOWED',
          `status=${order.status}`,
        );
      }

      // Sipariş iptali — order_items hepsi cancelled
      await trx
        .updateTable('order_items')
        .set({ status: 'cancelled' })
        .where('order_id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .where('status', '!=', 'cancelled')
        .execute();

      await trx
        .updateTable('orders')
        .set({
          status: 'cancelled',
          total_cents: 0,
          updated_at: new Date(),
        })
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const refreshed = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();
      const itemRows = await fetchItemsWithAttributes(trx, tenantId, orderId);
      return { order: refreshed, items: itemRows };
    },

    // ============================================================
    // ADR-017 Takeaway implementation
    // ============================================================

    async createTakeawayOrder(tx, row) {
      // 1. store_date hesabı — Migration 026 + 029 sonrası DB trigger
      //    `store_date(ts, 0::smallint, tz)` ile takvim günü hesaplıyor.
      //    Counter için aynı değeri elde etmek üzere bu repo da
      //    cutoff_hour=0 kullanır. SMALLINT ve TEXT cast'leri zorunlu —
      //    PG named-arg / unknown literal otomatik cast etmiyor.
      const tsRow = await tx
        .selectFrom('tenant_settings')
        .select(['timezone'])
        .where('tenant_id', '=', row.tenantId)
        .executeTakeFirstOrThrow();
      const storeDateRow = await tx
        .selectNoFrom((eb) =>
          eb
            .fn<Date>('store_date', [
              sql`now()`,
              sql`0::smallint`,
              sql`${tsRow.timezone}::text`,
            ])
            .as('d'),
        )
        .executeTakeFirstOrThrow();
      const storeDate = storeDateRow.d as unknown as Date;

      const counter = await tx
        .insertInto('order_no_counters')
        .values({
          tenant_id: row.tenantId,
          business_date: storeDate,
          last_no: 1,
        })
        .onConflict((oc) =>
          oc
            .columns(['tenant_id', 'business_date'])
            .doUpdateSet({
              last_no: sql<number>`order_no_counters.last_no + 1`,
            }),
        )
        .returning('last_no')
        .executeTakeFirstOrThrow();

      // 2. orders insert — store_date trigger populate edecek; explicit ver
      //    ki Kysely tip zorunluluğu kalksın (NOT NULL).
      try {
        await tx
          .insertInto('orders')
          .values({
            id: row.id,
            tenant_id: row.tenantId,
            table_id: null,
            customer_id: row.customerId,
            // ADR-008 §4.1: actor user_id; ABAC waiter scope buna göre filtreler.
            waiter_user_id: row.waiterUserId ?? null,
            order_type: 'takeaway',
            status: 'open',
            order_no: counter.last_no,
            store_date: storeDate,
            total_cents: row.totalCents,
            takeaway_stage: 'preparing',
            planned_payment_type: row.plannedPaymentType,
            delivery_address_snapshot: row.deliveryAddressSnapshot ?? null,
            delivery_note: row.deliveryNote ?? null,
          })
          .execute();
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'check') {
          throw new RepositoryError(
            'check',
            'ORDER_INVARIANT_VIOLATED',
            mapped.detail,
          );
        }
        if (mapped?.cause === 'foreign_key') {
          throw new RepositoryError(
            'foreign_key',
            'CUSTOMER_NOT_FOUND',
            mapped.detail,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }

      // 3. order_items batch insert (snapshot). category_name_snapshot
      //    bu akışta caller'dan gelmiyor — boş string yazılır; ADR-013
      //    snapshot disiplini için ileride genişletilebilir (route
      //    handler products+categories join'inden doldurabilir).
      if (row.items.length > 0) {
        await tx
          .insertInto('order_items')
          .values(
            row.items.map((it) => ({
              id: sql<string>`gen_random_uuid()`,
              tenant_id: row.tenantId,
              order_id: row.id,
              product_id: it.productId,
              product_name: it.productNameSnapshot,
              category_name_snapshot: '',
              unit_price_cents: it.unitPriceCents,
              quantity: it.quantity,
              total_cents: it.unitPriceCents * it.quantity,
              note: it.notes ?? null,
              created_by_user_id: it.createdByUserId ?? null,
              created_by_name: it.createdByName ?? null,
            })),
          )
          .execute();
      }

      return row.id;
    },

    async findOrderById(exec, tenantId, orderId) {
      const order = await exec
        .selectFrom('orders')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', orderId)
        .executeTakeFirst();
      if (order === undefined) return null;

      const items = await exec
        .selectFrom('order_items')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('order_id', '=', orderId)
        .orderBy('created_at', 'asc')
        .execute();

      let customer: TakeawayOrderDetail['customer'] = null;
      if (order.customer_id !== null) {
        const cust = await exec
          .selectFrom('customers')
          .select(['id', 'full_name'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', order.customer_id)
          .executeTakeFirst();
        if (cust !== undefined) {
          const phones = await exec
            .selectFrom('customer_phones')
            .select(['id', 'normalized_phone'])
            .where('tenant_id', '=', tenantId)
            .where('customer_id', '=', cust.id)
            .orderBy('created_at', 'asc')
            .execute();
          customer = {
            id: cust.id,
            full_name: cust.full_name,
            phones,
          };
        }
      }

      return { order, items, customer };
    },

    async listOpenTakeawayOrders(exec, tenantId) {
      const rows = await exec
        .selectFrom('orders as o')
        .leftJoin('customers as c', (j) =>
          j
            .onRef('c.id', '=', 'o.customer_id')
            .onRef('c.tenant_id', '=', 'o.tenant_id'),
        )
        .select([
          'o.id',
          'o.order_no',
          'o.customer_id',
          'c.full_name as customer_name',
          'o.total_cents',
          'o.takeaway_stage',
          'o.planned_payment_type',
          'o.created_at',
        ])
        .where('o.tenant_id', '=', tenantId)
        .where('o.order_type', '=', 'takeaway')
        .where('o.status', '=', 'open')
        .orderBy('o.created_at', 'desc')
        .execute();

      // takeaway_stage NULL filtresi — DB CHECK garanti veriyor ama TS
      // tip daralması için defansif map.
      return rows
        .filter((r) => r.takeaway_stage !== null)
        .map((r) => ({
          id: r.id,
          order_no: r.order_no,
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          total_cents: r.total_cents,
          takeaway_stage: r.takeaway_stage as TakeawayStage,
          planned_payment_type: r.planned_payment_type as
            | 'cash'
            | 'card'
            | null,
          created_at: r.created_at,
        }));
    },

    async updateTakeawayStage(tx, tenantId, orderId, fromStage, toStage) {
      // delivered transition: aynı tx içinde status='paid' + payments insert.
      if (toStage === 'delivered') {
        const updated = await tx
          .updateTable('orders')
          .set({
            takeaway_stage: 'delivered',
            status: 'paid',
            updated_at: new Date(),
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', orderId)
          .where('order_type', '=', 'takeaway')
          .where('status', '=', 'open')
          .where('takeaway_stage', '=', fromStage)
          .returning(['id', 'total_cents', 'planned_payment_type'])
          .executeTakeFirst();

        if (updated === undefined) {
          return { rowCount: 0 };
        }

        // Payments insert idempotent (tenant_id, idempotency_key UNIQUE).
        // amount_cents CHECK > 0 — 0 totalli sipariş defansif atlanır.
        if (updated.total_cents > 0) {
          // payments.idempotency_key UUID — string prefix kullanılamaz.
          // Takeaway 1:1 (sipariş başına tek delivered ödemesi); orderId
          // doğal idempotency key, tenant scope'lu UNIQUE garantisi yeterli.
          const paymentType: 'cash' | 'card' =
            updated.planned_payment_type === 'card' ? 'card' : 'cash';
          await tx
            .insertInto('payments')
            .values({
              id: sql<string>`gen_random_uuid()`,
              tenant_id: tenantId,
              order_id: orderId,
              payment_type: paymentType,
              payment_scope: 'full',
              amount_cents: updated.total_cents,
              idempotency_key: orderId,
            })
            .onConflict((oc) =>
              oc.columns(['tenant_id', 'idempotency_key']).doNothing(),
            )
            .execute();
        }

        return { rowCount: 1, paid: true };
      }

      // Diğer transition'lar (preparing→out_for_delivery vs.) — saf UPDATE.
      const updated = await tx
        .updateTable('orders')
        .set({
          takeaway_stage: toStage,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', orderId)
        .where('order_type', '=', 'takeaway')
        .where('status', '=', 'open')
        .where('takeaway_stage', '=', fromStage)
        .returning('id')
        .executeTakeFirst();

      return { rowCount: updated === undefined ? 0 : 1 };
    },

    async cancelTakeawayOrder(tx, tenantId, orderId) {
      const updated = await tx
        .updateTable('orders')
        .set({
          status: 'cancelled',
          total_cents: 0,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', orderId)
        .where('order_type', '=', 'takeaway')
        .where('status', '=', 'open')
        .where('takeaway_stage', '=', 'preparing')
        .returning('id')
        .executeTakeFirst();

      if (updated === undefined) {
        return { rowCount: 0 };
      }

      await tx
        .updateTable('order_items')
        .set({ status: 'cancelled' })
        .where('tenant_id', '=', tenantId)
        .where('order_id', '=', orderId)
        .where('status', '!=', 'cancelled')
        .execute();

      return { rowCount: 1 };
    },

    /**
     * Session 53 — `assignCustomer` (caller-owned tx). Tüm
     * validasyonlar tek tx içinde + FOR UPDATE row-lock.
     */
    async assignCustomer(tx, tenantId, orderId, customerId) {
      const order = await tx
        .selectFrom('orders')
        .select(['id', 'order_type', 'status', 'customer_id'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', orderId)
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
      if (order.order_type === 'takeaway' && customerId === null) {
        // Migration 028 CHECK defansı; pratikte handler 400 reddeder.
        throw new RepositoryError('check', 'TAKEAWAY_CUSTOMER_REQUIRED');
      }
      if (customerId !== null) {
        const customer = await tx
          .selectFrom('customers')
          .select(['id', 'is_blacklisted'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', customerId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (customer === undefined) {
          throw new RepositoryError('not_found', 'CUSTOMER_NOT_FOUND');
        }
        if (customer.is_blacklisted) {
          throw new RepositoryError('check', 'CUSTOMER_BLACKLISTED');
        }
      }

      // No-op skip — aynı müşteri zaten atanmış.
      if (order.customer_id === customerId) {
        return { customerIdBefore: order.customer_id };
      }

      await tx
        .updateTable('orders')
        .set({ customer_id: customerId, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', orderId)
        .execute();

      return { customerIdBefore: order.customer_id };
    },

    async moveToTable(tx, tenantId, orderId, targetTableId) {
      // 1. Sipariş satır kilidi (race önlem) + tenant-scope.
      const order = await tx
        .selectFrom('orders')
        .select(['id', 'order_type', 'status', 'table_id', 'table_code_snapshot'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', orderId)
        .forUpdate()
        .executeTakeFirst();

      if (order === undefined) {
        throw new RepositoryError('not_found', 'ORDER_NOT_FOUND');
      }
      // 2. Yalnız dine_in taşınabilir — takeaway/delivery'nin masası yok.
      if (order.order_type !== 'dine_in') {
        throw new RepositoryError(
          'check',
          'ORDER_NOT_DINE_IN',
          `order_type=${order.order_type}`,
        );
      }
      // 3. Terminal (kapalı/ödenmiş/iptal) sipariş taşınamaz.
      if (
        order.status === 'paid' ||
        order.status === 'cancelled' ||
        order.status === 'void'
      ) {
        throw new RepositoryError(
          'check',
          'ORDER_ALREADY_CLOSED',
          `status=${order.status}`,
        );
      }
      // 4. No-op taşıma reddi (v3 paritesi — aynı masa reddedilir).
      if (order.table_id === targetTableId) {
        throw new RepositoryError('check', 'TABLE_MOVE_SAME_TABLE');
      }

      // 5. Hedef masa var + tenant-scoped + silinmemiş mi? Snapshot türetimi
      //    create'teki (orders.ts:889-913) ile BİREBİR aynı: tableLabel() +
      //    areas.name; hedef bölgesiz/orphan ise area_name_snapshot=NULL.
      const target = await tx
        .selectFrom('tables')
        .leftJoin('areas', (join) =>
          join
            .onRef('areas.id', '=', 'tables.area_id')
            .onRef('areas.tenant_id', '=', 'tables.tenant_id'),
        )
        .select([
          'tables.code as t_code',
          'tables.area_id as area_id',
          'tables.display_no as display_no',
          'areas.name as a_name',
        ])
        .where('tables.tenant_id', '=', tenantId)
        .where('tables.id', '=', targetTableId)
        .where('tables.deleted_at', 'is', null)
        .executeTakeFirst();

      if (target === undefined) {
        throw new RepositoryError('not_found', 'TABLE_NOT_FOUND');
      }

      // 6. Hedef masa boş mu? App-level ön-kontrol (create'teki occupancy
      //    check'in ikizi). Partial unique index atomik backstop 7. adımda.
      const occupied = await tx
        .selectFrom('orders')
        .select('id')
        // ADR-029: aktif = terminal-hariç (merged dahil terminal). Kanonik
        // TERMINAL_ORDER_STATUSES — merged kaynak masayı dolu göstermez.
        .where('tenant_id', '=', tenantId)
        .where('table_id', '=', targetTableId)
        .where('status', 'not in', [...TERMINAL_ORDER_STATUSES])
        .executeTakeFirst();
      if (occupied !== undefined) {
        throw new RepositoryError('unique', 'TABLE_ALREADY_OCCUPIED');
      }

      const toTableCode = tableLabel({
        code: target.t_code,
        area_id: target.area_id,
        display_no: target.display_no,
      });
      const areaNameSnapshot = target.a_name;

      // 7. UPDATE. updated_at trigger ile otomatik bump; created_at/store_date
      //    dokunulmaz (orders_reject_temporal_update tetiklenmez). Concurrent
      //    occupy race → 23505 (orders_tenant_table_open_uq) → 409.
      try {
        await tx
          .updateTable('orders')
          .set({
            table_id: targetTableId,
            table_code_snapshot: toTableCode,
            area_name_snapshot: areaNameSnapshot,
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', orderId)
          .execute();
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError('unique', 'TABLE_ALREADY_OCCUPIED');
        }
        // Hedef masa SELECT ile UPDATE arasında hard-delete edildiyse FK
        // (23503) ihlali → temiz 404 TABLE_NOT_FOUND (generic 500 yerine).
        if (mapped?.cause === 'foreign_key') {
          throw new RepositoryError('foreign_key', 'TABLE_NOT_FOUND');
        }
        if (mapped !== null) throw mapped;
        throw err;
      }

      return {
        fromTableId: order.table_id,
        toTableId: targetTableId,
        fromTableCode: order.table_code_snapshot,
        toTableCode,
      };
    },

    async mergeInto(tx, tenantId, sourceOrderId, targetTableId) {
      // 1. Kaynak sipariş (tenant-scoped) — henüz kilitsiz, yalnız hedef
      //    siparişin id'sini bulmak için (deadlock-safe tek FOR UPDATE 3. adımda).
      const sourceProbe = await tx
        .selectFrom('orders')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', sourceOrderId)
        .executeTakeFirst();
      if (sourceProbe === undefined) {
        throw new RepositoryError('not_found', 'ORDER_NOT_FOUND');
      }

      // 2. Hedef masanın AKTİF (non-terminal) siparişi — yoksa hedef masa boş
      //    (Masayı Değiştir kullanılmalı). Kanonik TERMINAL_ORDER_STATUSES
      //    (merged dahil terminal → merged sipariş "dolu" saymaz).
      const targetProbe = await tx
        .selectFrom('orders')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('table_id', '=', targetTableId)
        .where('status', 'not in', [...TERMINAL_ORDER_STATUSES])
        .executeTakeFirst();
      if (targetProbe === undefined) {
        throw new RepositoryError(
          'check',
          'MERGE_TARGET_NOT_OCCUPIED',
          `targetTableId=${targetTableId}`,
        );
      }

      // 3. Deadlock önlemi: iki siparişi TEK sorguda id-sırasıyla FOR UPDATE
      //    kilitle (`ORDER BY id` → concurrent iki merge aynı kilit sırasını
      //    izler). Kilitli satırlar üzerinde guard'lar yeniden değerlendirilir.
      const locked = await tx
        .selectFrom('orders')
        .select(['id', 'order_type', 'status', 'table_id', 'table_code_snapshot'])
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', [sourceOrderId, targetProbe.id])
        .orderBy('id')
        .forUpdate()
        .execute();

      const source = locked.find((o) => o.id === sourceOrderId);
      const target = locked.find((o) => o.id === targetProbe.id);
      // Kaynak satır kilit-sonrası kaybolduysa (concurrent silme, olağandışı).
      if (source === undefined) {
        throw new RepositoryError('not_found', 'ORDER_NOT_FOUND');
      }
      // Hedef satır kilit-sonrası kaybolduysa → hedef masa artık boş.
      if (target === undefined) {
        throw new RepositoryError(
          'check',
          'MERGE_TARGET_NOT_OCCUPIED',
          `targetTableId=${targetTableId}`,
        );
      }

      // 4. Guard sırası (ADR-029 Karar E adım 2). Kaynak = hedef sipariş?
      if (source.id === target.id) {
        throw new RepositoryError('check', 'MERGE_SAME_ORDER');
      }
      // Her ikisi dine_in — takeaway/delivery'nin masası yok, birleştirilemez.
      if (source.order_type !== 'dine_in' || target.order_type !== 'dine_in') {
        throw new RepositoryError(
          'check',
          'ORDER_NOT_DINE_IN',
          `source=${source.order_type} target=${target.order_type}`,
        );
      }
      // Her ikisi non-terminal (paid|cancelled|void|merged kapalı sayılır) —
      // kanonik TERMINAL_ORDER_STATUSES ile tutarlı.
      const isTerminal = (s: OrderStatus): boolean =>
        TERMINAL_ORDER_STATUSES.includes(s);
      if (isTerminal(source.status) || isTerminal(target.status)) {
        throw new RepositoryError(
          'check',
          'ORDER_ALREADY_CLOSED',
          `source=${source.status} target=${target.status}`,
        );
      }
      // Kaynak+hedef ödemesiz olmalı (K3 — MERGE YASAK ödeme varsa).
      const paymentRow = await tx
        .selectFrom('payments')
        .select(({ fn }) => fn.countAll<string>().as('cnt'))
        .where('tenant_id', '=', tenantId)
        .where('order_id', 'in', [source.id, target.id])
        .executeTakeFirst();
      if (paymentRow !== undefined && Number(paymentRow.cnt) > 0) {
        throw new RepositoryError('check', 'ORDER_HAS_PAYMENTS');
      }

      // 5. Re-parent: kaynak kalemleri hedef siparişe taşı. Snapshot kolonları
      //    (ürün adı/fiyat/actor/variant/attr) DOKUNULMAZ (ADR-003 §7, K2 APPEND);
      //    yalnız order_id + updated_at değişir. Taşınan satır sayısını al.
      const reparent = await tx
        .updateTable('order_items')
        .set({ order_id: target.id, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('order_id', '=', source.id)
        .executeTakeFirst();
      const movedItemCount = Number(reparent.numUpdatedRows);

      // 6. Hedef total_cents recalc — cancelled/comped kalemler dışlanır
      //    (ADR-013 formülü, is_comped toggle recalc ikizi). Eski total'i audit
      //    için önceden oku, güncel total'i UPDATE sonrası oku.
      const targetBefore = await tx
        .selectFrom('orders')
        .select(['total_cents'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', target.id)
        .executeTakeFirstOrThrow();
      const oldTargetTotalCents = targetBefore.total_cents;

      await tx
        .updateTable('orders')
        .set({
          total_cents: sql<number>`(
            SELECT COALESCE(SUM(total_cents), 0)
            FROM order_items
            WHERE order_id = ${target.id}
              AND tenant_id = ${tenantId}
              AND status != 'cancelled'
              AND is_comped = false
          )`,
          updated_at: new Date(),
        })
        .where('id', '=', target.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      const targetAfter = await tx
        .selectFrom('orders')
        .select(['total_cents'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', target.id)
        .executeTakeFirstOrThrow();
      const newTargetTotalCents = targetAfter.total_cents;

      // 7. Kaynağı terminal yap — status='merged' + forensic iz + total_cents=0.
      //    Tüm kalemler hedefe taşındı → kaynak bomboş; total_cents'i 0'a set
      //    et (aksi halde hayalet tutar kalır: rapor/board bayat gösterir). Masa
      //    boşalır (partial unique index predicate aktif-statü whitelist'i →
      //    'merged' liste-dışı = hedefe yeni sipariş açılabilir; Migration 042).
      await tx
        .updateTable('orders')
        .set({
          status: 'merged',
          merged_into_order_id: target.id,
          total_cents: 0,
          updated_at: new Date(),
        })
        .where('id', '=', source.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      return {
        sourceOrderId: source.id,
        targetOrderId: target.id,
        sourceTableId: source.table_id,
        targetTableId: target.table_id,
        sourceTableCode: source.table_code_snapshot,
        movedItemCount,
        oldTargetTotalCents,
        newTargetTotalCents,
      };
    },
  };
}
