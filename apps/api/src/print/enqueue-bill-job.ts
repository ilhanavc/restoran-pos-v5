/**
 * Enqueue an on-demand customer bill (adisyon) print job (ADR-027 Faz A).
 *
 * Mirrors {@link enqueueKitchenJob}: renders an ESC/POS byte stream and inserts
 * it into `print_jobs` as `status='queued'`; the Print Agent (generic puller —
 * decodes `payload.bytesBase64` regardless of `kind`) prints it. No schema
 * change: `kind: 'bill'` distinguishes it from kitchen jobs in the payload.
 *
 * Unlike the kitchen job (auto-enqueued on Kaydet), this is triggered on demand
 * by `POST /orders/:orderId/print-bill` (garson dahil herkes — ADR-027 K2/§7e).
 * The caller has already resolved + 404-checked the order, so the data is passed
 * in; this helper only looks up the tenant header + table code, renders, inserts.
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { renderBillReceipt } from './templates/bill-receipt.js';

export interface BillJobItem {
  name: string;
  quantity: number;
  /** Line total in kuruş (snapshot — order_items.total_cents). */
  lineTotalCents: number;
}

export interface BillJobInput {
  orderId: string;
  tenantId: string;
  /** Who triggered the print — payload meta for traceability. */
  actorUserId: string;
  orderNo: number;
  /** dine_in → table id (code looked up); takeaway/null → "PAKET". */
  tableId: string | null;
  totalCents: number;
  items: BillJobItem[];
  /** ISO timestamp; the bill date is rendered from its `YYYY-MM-DD HH:MM` slice. */
  renderedAt: string;
}

/**
 * Render a customer bill and queue it as a print job. Tenant-scoped throughout.
 */
export async function enqueueBillJob(
  db: Kysely<DB>,
  input: BillJobInput,
): Promise<void> {
  // 1. Tenant header (fiş başlığı).
  const tenant = await db
    .selectFrom('tenants')
    .select(['name'])
    .where('id', '=', input.tenantId)
    .executeTakeFirstOrThrow();

  // 2. Table code (dine_in) — takeaway/null → null → "PAKET" render edilir.
  let tableLabel: string | null = null;
  if (input.tableId !== null) {
    const tbl = await db
      .selectFrom('tables')
      .select(['code'])
      .where('id', '=', input.tableId)
      .where('tenant_id', '=', input.tenantId)
      .executeTakeFirst();
    tableLabel = tbl?.code ?? null;
  }

  // 3. ESC/POS byte stream render. Date = ISO'nun YYYY-MM-DD HH:MM dilimi
  //    (UTC; iş-günü timezone'lu format v5.1).
  const bytes = renderBillReceipt({
    tenant_header: tenant.name,
    order_no: input.orderNo,
    table_label: tableLabel,
    items: input.items.map((it) => ({
      name: it.name,
      qty: it.quantity,
      lineTotalCents: it.lineTotalCents,
    })),
    totalCents: input.totalCents,
    created_at_local: input.renderedAt.slice(0, 16).replace('T', ' '),
  });

  // 4. Print job insert (queued; Print Agent generic puller tüketir).
  await db
    .insertInto('print_jobs')
    .values({
      id: randomUUID(),
      tenant_id: input.tenantId,
      status: 'queued',
      payload: {
        kind: 'bill',
        bytesBase64: Buffer.from(bytes).toString('base64'),
        meta: {
          orderId: input.orderId,
          orderNo: input.orderNo,
          actorUserId: input.actorUserId,
          itemCount: input.items.length,
          totalCents: input.totalCents,
          renderedAt: input.renderedAt,
        },
      },
    })
    .execute();
}
