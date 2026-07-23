/**
 * İptal fişi print job üretimi — ADR-004 Amendment 6 Bölüm A (A5/A6/A7).
 *
 * Route hook'ları iptal İŞLEMİ BAŞARILI OLDUKTAN SONRA çağırır (tx dışı,
 * best-effort — fiş üretilemezse iptal geri alınmaz; bugünkü davranışa
 * [mutfak sözlü] düşülür). Kalem id listesi ÇAĞIRANDAN gelir:
 *   - item-cancel:  [itemId] (canlı→cancelled geçişi route guard'ında)
 *   - order-cancel: iptal ANINDA canlı olan kalemlerin id'leri (route,
 *     cancel'dan ÖNCE toplar — önceden tek tek iptal edilmiş kalemler kendi
 *     İPTAL fişini zaten gördü, ADİSYON İPTAL fişinde TEKRAR listelenmez; A5).
 *
 * Kalem satırları soft-cancel'dır (order_items silinmez) → fetch iptal
 * SONRASI güvenle snapshot kolonlarını okur.
 *
 * Routing — A2: `kind: 'kitchen'` DEĞİŞMEZ (ADR-032 yönlendirme anahtarı;
 * mutfak-agent'ı bunu claim eder). Varyant `meta.variant`'ta taşınır: kurulu
 * eski agent exe'leri payload'ı zod'suz index-erişimle okur
 * (`payload['bytesBase64']`, print-agent/src/index.ts:343) → yeni meta key'i
 * onlara ŞEFFAF; yeni exe/MSI/config/migration GEREKMEZ (cutover-sıfır).
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { formatReceiptDateTime } from './format-receipt-datetime.js';
import { resolveItemStations } from './resolve-item-stations.js';
import {
  renderCancelReceipt,
  type CancelReceiptItem,
} from './templates/cancel-receipt.js';

export interface CancelJobContext {
  tenantId: string;
  orderId: string;
  /** Fiş varyantı — meta'ya da yazılır (gözlemlenebilirlik; agent-opaque). */
  variant: 'item-cancel' | 'order-cancel';
  /** İptal edilen kalem id'leri (çağıran toplar — yukarıdaki kontrat). */
  itemIds: readonly string[];
}

/**
 * İptal fişini kuyruğa bırakır. Kalem listesi boşsa NO-OP (A5 guard'ının
 * çift emniyeti: 0-canlı-kalemli adisyon iptali fiş üretmez).
 */
export async function enqueueCancelJob(
  db: Kysely<DB>,
  ctx: CancelJobContext,
): Promise<void> {
  if (ctx.itemIds.length === 0) return;

  // 1. Order satırı — kimlik bloğu alanları tek fetch'te (bill-job "tek-fetch
  //    otoritesi" paritesi): yerleşim (order_type) + no + masa/bölge + garson.
  const order = await db
    .selectFrom('orders')
    .select([
      'order_type',
      'order_no',
      'table_code_snapshot',
      'area_name_snapshot',
      'waiter_user_id',
    ])
    .where('id', '=', ctx.orderId)
    .where('tenant_id', '=', ctx.tenantId)
    .executeTakeFirst();
  if (order === undefined) return;

  // 2. İptal edilen kalemler (soft-cancel — snapshot kolonları yerinde).
  //    FİYAT ÇEKİLMEZ (mutfak fişi; A3).
  //
  //    S104 — `categories.kitchen_print = true` FİLTRESİ ZORUNLU: mutfağa hiç
  //    GİTMEMİŞ kalemin iptali mutfaktan basılmaz. İçecekler (`kitchen_print
  //    =false`) sipariş fişinde çıkmıyordu ama iptal fişinde çıkıyordu —
  //    ürün sahibi bildirdi. Filtre neden BURADA (çağıranda değil): üç çağıran
  //    da (paket iptal / dine-in iptal / tek kalem void) aynı kuralı ister;
  //    tek yerde durursa ayrışamaz.
  //
  //    ⚠️ `resolveItemStations` istasyonsuz kalemi DEFAULT_KITCHEN_STATION'a
  //    düşürür → filtre olmadan içecek iptali FIRINDAN çıkardı.
  const items = await db
    .selectFrom('order_items')
    .innerJoin('products', (join) =>
      join
        .onRef('products.id', '=', 'order_items.product_id')
        .onRef('products.tenant_id', '=', 'order_items.tenant_id'),
    )
    .innerJoin('categories', (join) =>
      join
        .onRef('categories.id', '=', 'products.category_id')
        .onRef('categories.tenant_id', '=', 'products.tenant_id'),
    )
    .select([
      'order_items.id as id',
      'order_items.product_name as product_name',
      'order_items.quantity as quantity',
      'order_items.note as note',
      'order_items.variant_name_snapshot as variant_name_snapshot',
    ])
    .where('order_items.order_id', '=', ctx.orderId)
    .where('order_items.tenant_id', '=', ctx.tenantId)
    .where('order_items.id', 'in', [...ctx.itemIds])
    .where('categories.kitchen_print', '=', true)
    .orderBy('order_items.created_at', 'asc')
    .execute();
  // Yalnız içecek iptal edildiyse burada 0 kalır → hiç fiş basılmaz (A5 guard).
  if (items.length === 0) return;

  // 3. Seçenek snapshot'ları (kitchen-job read-join paritesi).
  const attrRows = await db
    .selectFrom('order_item_attributes')
    .select(['order_item_id', 'option_name_snapshot'])
    .where('tenant_id', '=', ctx.tenantId)
    .where(
      'order_item_id',
      'in',
      items.map((it) => it.id),
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

  // 4. Timezone (yerel saat — Amd5 K9).
  const settings = await db
    .selectFrom('tenant_settings')
    .select(['timezone'])
    .where('tenant_id', '=', ctx.tenantId)
    .executeTakeFirst();
  const timezone = settings?.timezone ?? 'Europe/Istanbul';

  // 5. Çalışan adı (kitchen-job paritesi; null → template '-' basar).
  let serverName: string | null = null;
  if (order.waiter_user_id !== null) {
    const u = await db
      .selectFrom('users')
      .select(['username'])
      .where('id', '=', order.waiter_user_id)
      .where('tenant_id', '=', ctx.tenantId)
      .executeTakeFirst();
    if (u !== undefined && u.username !== null && u.username.length > 0) {
      serverName = u.username;
    }
  }

  // 6. İstasyon gruplaması (ADR-032 Amd1 K14). İptal fişi de mutfak fişiyle
  //    AYNI yönlendirmeyi izlemek ZORUNDA: aksi halde ızgara kaleminin iptali
  //    FIRIN'dan çıkar, ızgaracı iptali hiç görmez ve ürünü pişirmeye devam
  //    eder — yani bölünmenin çözmeyi vaat ettiği semptom iptal yolunda aynen
  //    sürer.
  //
  //    K4b (Layout B bölünmez) burada GEÇERLİ DEĞİL: iptal fişi sipariş-seviyesi
  //    tutar/müşteri PII basmaz, dolayısıyla paket siparişlerde de bölünür.
  const renderedAt = new Date().toISOString();
  const itemById = new Map(items.map((it) => [it.id, it]));
  const groups = await resolveItemStations(
    db,
    ctx.tenantId,
    items.map((it) => it.id),
  );

  // 7. Grup başına render + print job insert — `kind` = istasyon (A2 payload
  //    ŞEKLİ değişmez), varyant meta'da. Meta PII-safe (ADR-024).
  //    Tek grup → bugünkü davranışla birebir aynı (`kind='kitchen'`).
  for (const [station, itemIds] of groups) {
    const receiptItems: CancelReceiptItem[] = [];
    for (const itemId of itemIds) {
      const it = itemById.get(itemId);
      if (it === undefined) continue;
      receiptItems.push({
        name: it.product_name,
        qty: it.quantity,
        variantName: it.variant_name_snapshot,
        modifiers: modsByItem.get(it.id) ?? [],
        note: it.note,
      });
    }
    if (receiptItems.length === 0) continue;

    const bytes = renderCancelReceipt({
      variant: ctx.variant,
      order_type: order.order_type,
      order_no: order.order_no,
      table_label: order.table_code_snapshot,
      area_label: order.area_name_snapshot,
      server_name: serverName,
      created_at_local: formatReceiptDateTime(renderedAt, timezone),
      items: receiptItems,
    });

    await db
      .insertInto('print_jobs')
      .values({
        id: randomUUID(),
        tenant_id: ctx.tenantId,
        status: 'queued',
        payload: {
          kind: station,
          bytesBase64: Buffer.from(bytes).toString('base64'),
          meta: {
            orderId: ctx.orderId,
            orderNo: order.order_no,
            variant: ctx.variant,
            itemCount: receiptItems.length,
            renderedAt,
          },
        },
      })
      .execute();
  }
}
