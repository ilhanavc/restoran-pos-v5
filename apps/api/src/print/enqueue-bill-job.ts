/**
 * Enqueue an on-demand customer bill (adisyon) print job
 * (ADR-027 Faz A + Amendment 1).
 *
 * Mirrors {@link enqueueKitchenJob}: renders an ESC/POS byte stream and inserts
 * it into `print_jobs` as `status='queued'`; the Print Agent (generic puller —
 * decodes `payload.bytesBase64` regardless of `kind`) prints it. No schema
 * change: `kind: 'bill'` distinguishes it from kitchen jobs in the payload.
 *
 * ADR-027 Amendment 1 — TEK FETCH OTORİTESİ: caller yalnız `{orderId, tenantId,
 * actorUserId}` geçer; bu helper tüm bill verisini orderId'den kendi çeker
 * (order + items + modifiers + payments + garson). İki çağıran (print-bill
 * endpoint + pay-and-print) böylece item-map/detail-fetch tekrarından kurtulur
 * (DRY). Müşteri PII fişe basılmaz → order/items lean SELECT (customer/phone
 * fetch YOK; KVKK yüzeyi minimal).
 *
 * ADR-009 Amendment 2026-06-30 Karar A: masa etiketi kanonik SNAPSHOT
 * (`order.table_code_snapshot` + `area_name_snapshot`), kitchen fişiyle birebir
 * aynı — NOT a live `tables.code` join (board ile drift ederdi).
 *
 * @returns `true` iş kuyruğa girdiyse; `false` order bulunamadıysa (caller 404
 *   map eder — pay-and-print fire-and-forget yolunda dönüş yok sayılır).
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { createPaymentsRepository, type DB } from '@restoran-pos/db';
import { ESC_POS } from '@restoran-pos/shared-domain';
import { renderBillReceipt } from './templates/bill-receipt.js';

export interface BillJobInput {
  orderId: string;
  tenantId: string;
  /** Who triggered the print — payload meta for traceability. */
  actorUserId: string;
}

/** ISO timestamp → "DD.MM.YYYY  HH:MM" (Türkçe tarih; UTC wall-clock, tz v5.1). */
function formatBillDate(iso: string): string {
  const [datePart, timePart] = iso.slice(0, 16).split('T');
  const [y, m, d] = (datePart ?? '').split('-');
  return `${d}.${m}.${y}  ${timePart ?? ''}`;
}

/**
 * Render a customer bill and queue it as a print job. Tenant-scoped throughout.
 */
export async function enqueueBillJob(
  db: Kysely<DB>,
  input: BillJobInput,
): Promise<boolean> {
  const { orderId, tenantId } = input;

  // 1. Order (lean SELECT — yalnız fiş için gereken kolonlar; customer PII YOK).
  const order = await db
    .selectFrom('orders')
    .select([
      'order_no',
      'order_type',
      'waiter_user_id',
      'table_code_snapshot',
      'area_name_snapshot',
      'total_cents',
    ])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', orderId)
    .executeTakeFirst();
  if (order === undefined) return false;

  // 2. Kalemler (created_at asc — girildiği sıra).
  const items = await db
    .selectFrom('order_items')
    .select(['id', 'product_name', 'quantity', 'total_cents', 'note'])
    .where('tenant_id', '=', tenantId)
    .where('order_id', '=', orderId)
    .orderBy('created_at', 'asc')
    .execute();

  // 3. Modifiye seçenekleri (order_item_attributes snapshot; Migration 017,
  //    resolveItemAttributes yazar) → kalem başına option_name_snapshot listesi.
  const itemIds = items.map((it) => it.id);
  const attrRows =
    itemIds.length > 0
      ? await db
          .selectFrom('order_item_attributes')
          .select(['order_item_id', 'option_name_snapshot'])
          .where('tenant_id', '=', tenantId)
          .where('order_item_id', 'in', itemIds)
          .orderBy('created_at', 'asc')
          .orderBy('id', 'asc')
          .execute()
      : [];
  const modsByItem = new Map<string, string[]>();
  for (const r of attrRows) {
    const list = modsByItem.get(r.order_item_id);
    if (list === undefined) modsByItem.set(r.order_item_id, [r.option_name_snapshot]);
    else list.push(r.option_name_snapshot);
  }

  // 4. Ödemeler → tahsil/kalan. findByOrderId created_at asc döner (döküm sırası).
  //    ADR-033 SUM fan-out — findByOrderId voided satırı da DÖNER; fiş tahsil/kalan
  //    toplamı yalnız AKTİF (voided_at IS NULL) ödemeleri sayar.
  const payments = await createPaymentsRepository(db).findByOrderId(tenantId, orderId);
  const activePayments = payments.filter((p) => p.voided_at === null);
  const paidTotalCents = activePayments.reduce((sum, p) => sum + p.amount_cents, 0);
  const remainingCents = order.total_cents - paidTotalCents;

  // 5. Garson adı (waiter snapshot) — null ise render "-" basar.
  let serverName: string | null = null;
  if (order.waiter_user_id !== null) {
    const u = await db
      .selectFrom('users')
      .select(['username'])
      .where('id', '=', order.waiter_user_id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (u !== undefined && u.username !== null && u.username.length > 0) {
      serverName = u.username;
    }
  }

  // 6. Tenant header (fiş başlığı).
  const tenant = await db
    .selectFrom('tenants')
    .select(['name'])
    .where('id', '=', tenantId)
    .executeTakeFirstOrThrow();

  // 7. ESC/POS byte stream render. Kasa fişi (payload.kind='bill') → kasa POS-80
  //    yazıcısına yönlenir (ADR-032); CP857 = ESC t 61 / PAGE61 (ADR-004 Amd3).
  const renderedAt = new Date().toISOString();
  const bytes = renderBillReceipt(
    {
      tenant_header: tenant.name,
      order_no: order.order_no,
      order_type: order.order_type,
      server_name: serverName,
      table_label: order.table_code_snapshot,
      area_label: order.area_name_snapshot,
      items: items.map((it) => ({
        name: it.product_name,
        qty: it.quantity,
        lineTotalCents: it.total_cents,
        note: it.note,
        modifiers: modsByItem.get(it.id) ?? [],
      })),
      totalCents: order.total_cents,
      // ADR-033 — fiş ödeme dökümü yalnız AKTİF ödemeleri gösterir (void'lenmiş
      // satır fişte GÖRÜNMEZ; koşullu parçalı-ödeme dökümü ADR-027 Amd1).
      payments: activePayments.map((p) => ({
        type: p.payment_type,
        amountCents: p.amount_cents,
      })),
      paidTotalCents,
      remainingCents,
      created_at_local: formatBillDate(renderedAt),
    },
    ESC_POS.CODEPAGE_CP857_PAGE61,
  );

  // 8. Print job insert (queued; Print Agent generic puller tüketir). Meta
  //    PII-safe: orderId/orderNo/actor/itemCount/total — not/müşteri YOK.
  await db
    .insertInto('print_jobs')
    .values({
      id: randomUUID(),
      tenant_id: tenantId,
      status: 'queued',
      payload: {
        kind: 'bill',
        bytesBase64: Buffer.from(bytes).toString('base64'),
        meta: {
          orderId,
          orderNo: order.order_no,
          actorUserId: input.actorUserId,
          itemCount: items.length,
          totalCents: order.total_cents,
          renderedAt,
        },
      },
    })
    .execute();

  return true;
}
