/**
 * Enqueue a kitchen print job (ADR-004 Phase 3 PR-4b).
 *
 * Render edilen ESC/POS byte stream'ini `print_jobs` tablosuna `status='queued'`
 * olarak insert eder. Caller (orders.ts KDS hook'u), kitchen_print=true item'ların
 * status='sent' UPDATE'i tamamlandıktan sonra bu helper'ı çağırır. Aynı sıralama
 * sebebiyle (eventual consistency'li UPDATE → enqueue → emit), bu insert mevcut
 * `deps.db` üzerinden gerçekleşir; UPDATE ile aynı kısa pencere içinde idempotent
 * recovery PATCH'leri tetiklenirse çift job riski Phase 4'te `order_id` benzersizlik
 * indeksiyle çözülecek (v5.1 backlog).
 *
 * Kapsam kilidi (PR-4b):
 *   - Tek mutfak dest sabit `"MUTFAK"` (secondary printer routing v5.1).
 *   - Modifiers boş array (modifier set kompleks logic v5.1+).
 *   - Multi-dest split YOK (tüm kitchen item'ları tek job).
 *   - Defansif retry / cloud render fallback YOK (Phase 4+).
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { renderKitchenReceipt } from './templates/kitchen-receipt.js';

/**
 * KDS hook'undan toplanan minimum order context. Caller, mevcut handler scope'una
 * uyacak şekilde doldurur:
 *   - dine_in: `repo.create()` dönüş değerinden (`order.order_no`, `order.waiter_user_id`,
 *     `order.table_code_snapshot`).
 *   - takeaway: `createTakeawayOrder()` void döner → order_no için ayrı SELECT
 *     gerekir veya `findOrderById` sonucundan alınır.
 */
export interface KitchenJobOrderContext {
  /** UUID of the order — used for SELECT items + payload meta. */
  orderId: string;
  /** Multi-tenant scope (FK to tenants.id). */
  tenantId: string;
  /** Per-tenant per-store_date sequential fish numarası. */
  orderNo: number;
  /**
   * Kanonik masa etiketi snapshot (dine_in) — `order.table_code_snapshot`,
   * ADR-009 Amendment 2026-06-30 Karar A sonrası "Masa 2" / orphan code;
   * null (takeaway → "PAKET" render edilir).
   */
  tableCodeSnapshot: string | null;
  /**
   * Bölge adı snapshot (`order.area_name_snapshot`) — per-bölge display_no
   * çakışmasını fişte ayırt etmek için ("Bahçe · Masa 2"). null = bölgesiz/paket.
   */
  areaNameSnapshot: string | null;
  /** Garson user_id (snapshot) — null ise "—" render edilir. */
  waiterUserId: string | null;
}

/**
 * Sent edilmiş kitchen item'ları için ESC/POS byte stream render eder ve
 * print_jobs tablosuna queued insert eder. Sent item bulunamazsa no-op.
 */
export async function enqueueKitchenJob(
  db: Kysely<DB>,
  ctx: KitchenJobOrderContext,
): Promise<void> {
  // 1. Sent item'ları çek (status='sent' filter; KDS hook bunu az önce set etti).
  const sentItems = await db
    .selectFrom('order_items')
    .select(['product_name', 'quantity', 'note'])
    .where('order_id', '=', ctx.orderId)
    .where('tenant_id', '=', ctx.tenantId)
    .where('status', '=', 'sent')
    .execute();

  if (sentItems.length === 0) return;

  // 2. Tenant header (fiş başlığı).
  const tenant = await db
    .selectFrom('tenants')
    .select(['name'])
    .where('id', '=', ctx.tenantId)
    .executeTakeFirstOrThrow();

  // 3. Server name (waiter snapshot) — null ise "—".
  let serverName = '—';
  if (ctx.waiterUserId !== null) {
    const u = await db
      .selectFrom('users')
      .select(['username'])
      .where('id', '=', ctx.waiterUserId)
      .where('tenant_id', '=', ctx.tenantId)
      .executeTakeFirst();
    if (u !== undefined && u.username !== null && u.username.length > 0) {
      serverName = u.username;
    }
  }

  // 4. ESC/POS byte stream render.
  const renderedAt = new Date().toISOString();
  const bytes = renderKitchenReceipt({
    tenant_header: tenant.name,
    order_no: ctx.orderNo,
    table_label: ctx.tableCodeSnapshot,
    area_label: ctx.areaNameSnapshot,
    server_name: serverName,
    items: sentItems.map((it) => {
      const base: { name: string; qty: number; modifiers: string[]; note?: string } = {
        name: it.product_name,
        qty: it.quantity,
        modifiers: [], // Modifier set kompleks logic v5.1+ (kapsam kilidi).
      };
      if (it.note !== null && it.note.length > 0) {
        base.note = it.note;
      }
      return base;
    }),
    created_at_local: renderedAt,
    kitchen_dest_label: 'MUTFAK', // Sabit; secondary printer routing v5.1.
  });

  // 5. Print job insert (queued; Print Agent puller PR-5'te tüketecek).
  await db
    .insertInto('print_jobs')
    .values({
      id: randomUUID(),
      tenant_id: ctx.tenantId,
      status: 'queued',
      payload: {
        kind: 'kitchen',
        bytesBase64: Buffer.from(bytes).toString('base64'),
        meta: {
          orderId: ctx.orderId,
          orderNo: ctx.orderNo,
          itemCount: sentItems.length,
          renderedAt,
        },
      },
    })
    .execute();
}
