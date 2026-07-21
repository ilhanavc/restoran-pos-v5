/**
 * Paket (kasa) fişi enqueue — ADR-032 Amendment 3 K4/K5/K6.
 *
 * Paket siparişi girildiği anda KASA yazıcısına bir fiş bırakır. Mutfak
 * fişlerinden bağımsızdır: mutfak "ne pişecek" sorusunu, bu fiş "ne
 * paketlenecek / nereye gidecek / ne kadar" sorusunu yanıtlar.
 *
 * K6 — TEK-FETCH OTORİTESİ (ADR-027 Amd1 / ADR-004 Amd5 K12 paritesi):
 * çağıran yalnız üç kimlik geçer; order + kalemler + seçenekler + müşteri
 * adı/telefonu + tenant başlığı + timezone bu helper'da çekilir. Böylece
 * `orders.ts` handler'ındaki değişiklik tek satır kalır (cerrahi kural).
 *
 * K4 — `payload.kind='bill'`: kasa agent'ı zaten `jobKinds:['bill']` claim
 * ediyor → agent/exe/config/enum'a HİÇ dokunulmaz. Yeni bir `packing` kind'ı
 * eklemek exe rebuild + üç serviste copy-over + cutover riski demekti;
 * ayırt etme `meta.variant='packing'` ile bedelsiz elde ediliyor.
 *
 * K6 — `payload.meta` PII-SAFE (ADR-024): müşteri adı/telefon/adres meta'ya
 * GİRMEZ, yalnız `bytesBase64` içindedir (fişin kendisi; kaçınılmaz).
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  renderPackingReceipt,
  type PackingReceiptItem,
} from './templates/packing-receipt.js';
import { formatReceiptDateTime } from './format-receipt-datetime.js';

export interface PackingJobInput {
  orderId: string;
  tenantId: string;
  /** Siparişi giren kullanıcı — fişte "çalışan" satırı + audit bağlamı. */
  actorUserId: string | null;
}

/**
 * Paket fişini render edip `print_jobs`'a `queued` olarak yazar.
 *
 * @returns Fiş kuyruğa girdiyse `true`; sipariş bulunamadı ya da kalem yoksa
 *   `false` (çağıran best-effort davranır — fiş siparişin doğruluk koşulu
 *   değildir).
 */
export async function enqueuePackingJob(
  db: Kysely<DB>,
  input: PackingJobInput,
): Promise<boolean> {
  const { orderId, tenantId, actorUserId } = input;

  const order = await db
    .selectFrom('orders')
    .select([
      'order_no',
      'order_type',
      'total_cents',
      'delivery_address_snapshot',
      'delivery_note',
      'planned_payment_type',
      'customer_id',
      'created_at',
    ])
    .where('id', '=', orderId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  if (order === undefined) return false;

  // Kalemler — iptal edilenler HARİÇ (paketlenecek olan neyse o basılır).
  const items = await db
    .selectFrom('order_items')
    .select([
      'id',
      'product_name',
      'quantity',
      'note',
      'variant_name_snapshot',
      'total_cents',
      'is_comped',
    ])
    .where('order_id', '=', orderId)
    .where('tenant_id', '=', tenantId)
    .where('status', '!=', 'cancelled')
    .orderBy('created_at', 'asc')
    .execute();
  if (items.length === 0) return false;

  const attrRows = await db
    .selectFrom('order_item_attributes')
    .select(['order_item_id', 'option_name_snapshot'])
    .where('tenant_id', '=', tenantId)
    .where(
      'order_item_id',
      'in',
      items.map((i) => i.id),
    )
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
  const modsByItem = new Map<string, string[]>();
  for (const r of attrRows) {
    const list = modsByItem.get(r.order_item_id);
    if (list === undefined) modsByItem.set(r.order_item_id, [r.option_name_snapshot]);
    else list.push(r.option_name_snapshot);
  }

  const tenant = await db
    .selectFrom('tenants')
    .select(['name'])
    .where('id', '=', tenantId)
    .executeTakeFirstOrThrow();
  const settings = await db
    .selectFrom('tenant_settings')
    .select(['timezone'])
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  const timezone = settings?.timezone ?? 'Europe/Istanbul';

  let serverName: string | null = null;
  if (actorUserId !== null) {
    const u = await db
      .selectFrom('users')
      .select(['username'])
      .where('id', '=', actorUserId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (u !== undefined && u.username !== null && u.username.length > 0) {
      serverName = u.username;
    }
  }

  // Müşteri adı + primary telefon (canlı join — order'a snapshot'lanmıyor).
  let customerName: string | null = null;
  let customerPhone: string | null = null;
  if (order.customer_id !== null) {
    const customer = await db
      .selectFrom('customers')
      .select(['full_name'])
      .where('id', '=', order.customer_id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (customer !== undefined) customerName = customer.full_name;
    const phone = await db
      .selectFrom('customer_phones')
      .select(['raw_phone'])
      .where('customer_id', '=', order.customer_id)
      .where('tenant_id', '=', tenantId)
      .orderBy('is_primary', 'desc')
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    if (phone !== undefined) customerPhone = phone.raw_phone;
  }

  // Adres: sipariş anında seçilen adres `delivery_address_snapshot`'a yazılır
  // (o siparişin OTORİTESİ — sonradan adres kaydı değişse bile fiş siparişin
  // çekildiği adresi göstermeli). Ama snapshot yalnız `customerAddressId`
  // GEÇİLDİYSE dolar (`orders.ts:529`); kasiyer adres seçmeden paket siparişi
  // girdiğinde null kalıyor ve fişte adres satırı hiç çıkmıyordu.
  //
  // Yedek: müşterinin KAYITLI adresi (varsayılan; yoksa en eski). Kurye
  // adressiz kâğıtla yola çıkmasın.
  let deliveryAddress = order.delivery_address_snapshot;
  if (
    (deliveryAddress === null || deliveryAddress.trim() === '') &&
    order.customer_id !== null
  ) {
    const saved = await db
      .selectFrom('customer_addresses')
      .select(['address_line', 'neighborhood', 'district'])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', order.customer_id)
      .where('is_deleted', '=', false)
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    if (saved !== undefined) {
      // `orders.ts` `formatAddressSnapshot` ile AYNI biçim — iki yolun çıktısı
      // kâğıtta ayırt edilemez olmalı.
      const parts: string[] = [saved.address_line];
      if (saved.neighborhood !== null && saved.neighborhood.trim() !== '') {
        parts.push(saved.neighborhood);
      }
      if (saved.district !== null && saved.district.trim() !== '') {
        parts.push(saved.district);
      }
      deliveryAddress = parts.join(', ');
    }
  }

  // İKRAM kalemleri `orders.total_cents`'e GİRMEZ (repositories/orders.ts).
  // Fişte tam tutarıyla basılırsa satırlar TUTAR'ı tutmaz ve kuryenin tahsil
  // ettiği para kâğıtla çelişir → ikramda satır tutarı 0.
  const receiptItems: PackingReceiptItem[] = items.map((it) => ({
    name: it.is_comped ? `${it.product_name} (İKRAM)` : it.product_name,
    qty: it.quantity,
    variantName: it.variant_name_snapshot,
    lineTotalCents: it.is_comped ? 0 : it.total_cents,
    modifiers: modsByItem.get(it.id) ?? [],
    note: it.note,
  }));

  const bytes = renderPackingReceipt({
    tenant_header: tenant.name,
    order_type: order.order_type,
    order_no: order.order_no,
    server_name: serverName,
    created_at_local: formatReceiptDateTime(
      order.created_at.toISOString(),
      timezone,
    ),
    items: receiptItems,
    customer_name: customerName,
    customer_phone: customerPhone,
    delivery_address: deliveryAddress,
    delivery_note: order.delivery_note,
    planned_payment_type: order.planned_payment_type,
    total_cents: order.total_cents,
  });

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
          actorUserId,
          itemCount: receiptItems.length,
          totalCents: order.total_cents,
          variant: 'packing',
          renderedAt: new Date().toISOString(),
        },
      },
    })
    .execute();

  return true;
}
