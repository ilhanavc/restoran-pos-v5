/**
 * Enqueue a kitchen print job (ADR-004 Phase 3 PR-4b + Amendment 5).
 *
 * Render edilen ESC/POS byte stream'ini `print_jobs` tablosuna `status='queued'`
 * olarak insert eder. Caller (orders.ts KDS hook'u), kitchen_print=true item'ların
 * status='sent' UPDATE'i tamamlandıktan sonra bu helper'ı çağırır. Aynı sıralama
 * sebebiyle (eventual consistency'li UPDATE → enqueue → emit), bu insert mevcut
 * `deps.db` üzerinden gerçekleşir; UPDATE ile aynı kısa pencere içinde idempotent
 * recovery PATCH'leri tetiklenirse çift job riski Phase 4'te `order_id` benzersizlik
 * indeksiyle çözülecek (v5.1 backlog).
 *
 * ADR-004 Amd5 K12 — fetch otoritesi genişledi (enqueue-bill-job paritesi):
 * caller context'i DEĞİŞMEDİ (3 çağıran cerrahi korunur); ek veriyi bu helper
 * kendi çeker: order satırı (order_type + paket alanları) + kalem variant/tutar
 * + attribute seçenekleri + tenant timezone (K9 yerel saat) + paket dalında
 * müşteri adı/telefonu (K8). Yerleşim A/B seçimini order_type belirler (K1).
 *
 * ADR-032 Amendment 1 — istasyon yönlendirmesi: kalemler `categories.print_station`
 * değerine göre gruplanır ve HER GRUP ayrı fiş + ayrı `print_jobs` satırı olur
 * (`payload.kind` = istasyon). Tüm kategoriler atanmamışsa (NULL) tek grup çıkar
 * → çıktı bugünküyle birebir aynıdır. **ADR-032 Amd3 K1: bölünme TÜM sipariş
 * türlerinde** — Amd1 K4b'nin `dine_in` kısıtı geri alındı (ön koşulu Amd3 K3:
 * mutfak fişinden fiyat/TUTAR kaldırıldı).
 *
 * Kapsam kilidi: modifier SET kompleks logic v5.1; ürün-seviyesi istasyon
 * override + kategori→çoklu istasyon v5.1 (ADR-032 Amd1 K12).
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  renderKitchenReceipt,
  type KitchenReceiptItem,
} from './templates/kitchen-receipt.js';
import { formatReceiptDateTime } from './format-receipt-datetime.js';
import { resolveItemStations } from './resolve-item-stations.js';
import type { KitchenStationKind } from '@restoran-pos/shared-types';

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
   * null (takeaway → Layout B paket fişi).
   */
  tableCodeSnapshot: string | null;
  /**
   * Bölge adı snapshot (`order.area_name_snapshot`) — per-bölge display_no
   * çakışmasını fişte ayırt etmek için ("Bahçe | Masa 2"). null = bölgesiz/paket.
   */
  areaNameSnapshot: string | null;
  /** Garson user_id (snapshot) — null ise "-" render edilir. */
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
  // 1. Sent item'ları çek (status='sent'; KDS hook az önce set etti). Amd5 K4/K6:
  //    variant_name_snapshot (porsiyon). total_cents ARTIK ÇEKİLMİYOR —
  //    Amd3 K3 ile mutfak fişinde tutar basılmıyor.
  const sentItems = await db
    .selectFrom('order_items')
    .select([
      'id',
      'product_name',
      'quantity',
      'note',
      'variant_name_snapshot',
    ])
    .where('order_id', '=', ctx.orderId)
    .where('tenant_id', '=', ctx.tenantId)
    .where('status', '=', 'sent')
    .orderBy('created_at', 'asc')
    .execute();

  if (sentItems.length === 0) return;

  // 2. Order satırı — Amd5 K1 yerleşim seçimi (order_type) + müşteri ADI için
  //    customer_id (K8).
  //
  //    ADR-032 Amd3 K14 — `delivery_address_snapshot` / `delivery_note` /
  //    `planned_payment_type` ve müşteri TELEFONU artık ÇEKİLMİYOR: mutfak
  //    fişi bunları basmıyor. Render'ı kaldırıp fetch'i bırakmak KVKK m.4
  //    (veri minimizasyonu) ihlali olurdu ve canlı bir footgun bırakırdı —
  //    bir gün `meta`'ya `...order` spread edilse PII sessizce sızardı.
  const order = await db
    .selectFrom('orders')
    .select([
      'order_type',
      'customer_id',
    ])
    .where('id', '=', ctx.orderId)
    .where('tenant_id', '=', ctx.tenantId)
    .executeTakeFirst();
  if (order === undefined) return;

  // 3. Seçenek snapshot'ları (K6; enqueue-bill-job read-join paritesi).
  const itemIds = sentItems.map((it) => it.id);
  const attrRows = await db
    .selectFrom('order_item_attributes')
    .select(['order_item_id', 'option_name_snapshot'])
    .where('tenant_id', '=', ctx.tenantId)
    .where('order_item_id', 'in', itemIds)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
  const modsByItem = new Map<string, string[]>();
  for (const r of attrRows) {
    const list = modsByItem.get(r.order_item_id);
    if (list === undefined) modsByItem.set(r.order_item_id, [r.option_name_snapshot]);
    else list.push(r.option_name_snapshot);
  }

  // 4. Tenant header (Layout B başlığı) + timezone (K9 yerel saat).
  const tenant = await db
    .selectFrom('tenants')
    .select(['name'])
    .where('id', '=', ctx.tenantId)
    .executeTakeFirstOrThrow();
  const settings = await db
    .selectFrom('tenant_settings')
    .select(['timezone'])
    .where('tenant_id', '=', ctx.tenantId)
    .executeTakeFirst();
  const timezone = settings?.timezone ?? 'Europe/Istanbul';

  // 5. Çalışan adı (waiter snapshot) — null ise template "-" basar (K10:
  //    eski em-dash '—' placeholder CP857'de YOK → render çökerdi).
  let serverName: string | null = null;
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

  // 6. Paket dalında müşteri adı + primary telefon (K8 — canlı join; ad/tel
  //    order'a snapshot'lanmıyor, fiş sipariş anında basılır). Müşterisiz
  //    manuel pakette null kalır → Layout B bloğu kısalır, çökmez.
  let customerName: string | null = null;
  if (order.order_type !== 'dine_in' && order.customer_id !== null) {
    const customer = await db
      .selectFrom('customers')
      .select(['full_name'])
      .where('id', '=', order.customer_id)
      .where('tenant_id', '=', ctx.tenantId)
      .executeTakeFirst();
    if (customer !== undefined) customerName = customer.full_name;
  }

  // 7. İstasyon gruplaması (ADR-032 Amd1 K4). Kalemler `categories.print_station`
  //    değerine göre gruplanır; her grup KENDİ yazıcısına ayrı fiş olarak gider.
  //
  //    ADR-032 Amd3 K1 — Amd1'in K4b kararı (yalnız `dine_in` bölünür) GERİ
  //    ALINDI: bölünme artık TÜM sipariş türlerinde. K4b'nin gerekçesi
  //    "bölünürse her istasyon fişinde TUTAR tekrarlanır ve kalem-toplamıyla
  //    çelişir" idi; Amd3 K3 fiyat/TUTAR'ı Layout B'den TAMAMEN kaldırdığı
  //    için o çelişki yapısal olarak yok oldu (K3, K1'in ÖN KOŞULUdur).
  //
  //    K4b'nin dayandığı "şikâyet zaten salon mutfağıydı" varsayımı
  //    2026-07-21'de canlıda yanlışlandı: paket siparişteki ızgara kalemleri
  //    FIRIN'dan çıkıyor, IZGARA hiç görmüyordu — ızgarada KDS de olmadığı
  //    için kalem hiçbir kâğıtta ve hiçbir ekranda yoktu. Ayrıca iptal fişi
  //    (`enqueue-cancel-job.ts`) bölünmeyi ZATEN koşulsuz yapıyordu → aynı
  //    ürünün sipariş fişi FIRIN'dan, iptal fişi IZGARA'dan çıkıyordu.
  const renderedAt = new Date().toISOString();
  const sentItemIds = sentItems.map((it) => it.id);
  const itemById = new Map(sentItems.map((it) => [it.id, it]));

  const groups: ReadonlyArray<{
    readonly station: KitchenStationKind;
    readonly itemIds: readonly string[];
  }> = [...(await resolveItemStations(db, ctx.tenantId, sentItemIds))].map(
    ([station, itemIds]) => ({ station, itemIds }),
  );

  const groupCount = groups.length;

  // 8. Grup başına render + print job insert (queued; Print Agent puller
  //    tüketir). Meta PII-safe (ADR-024): müşteri adı/telefon/adres META'ya
  //    GİRMEZ — yalnız bytesBase64 içinde (kurye fişinin kendisi; kaçınılmaz).
  //
  //    Tek grup (bugünkü normal durum) → tek job, `kind='kitchen'`, istasyon
  //    etiketi YOK → çıktı bugünküyle BİREBİR aynı.
  for (const [groupIndex, group] of groups.entries()) {
    const groupItems: KitchenReceiptItem[] = [];
    for (const itemId of group.itemIds) {
      const it = itemById.get(itemId);
      if (it === undefined) continue;
      groupItems.push({
        name: it.product_name,
        qty: it.quantity,
        variantName: it.variant_name_snapshot,
        modifiers: modsByItem.get(it.id) ?? [],
        note: it.note,
      });
    }
    if (groupItems.length === 0) continue;

    const isSplit = groupCount > 1;
    const bytes = renderKitchenReceipt({
      order_type: order.order_type,
      tenant_header: tenant.name,
      order_no: ctx.orderNo,
      table_label: ctx.tableCodeSnapshot,
      area_label: ctx.areaNameSnapshot,
      server_name: serverName,
      created_at_local: formatReceiptDateTime(renderedAt, timezone),
      items: groupItems,
      customer_name: customerName,
      customer_phone: null,
      delivery_address: null,
      delivery_note: null,
      planned_payment_type: null,
      // K16 — yalnız bölünmüş siparişte; tek grupta null → bugünkü fiş.
    });

    await db
      .insertInto('print_jobs')
      .values({
        id: randomUUID(),
        tenant_id: ctx.tenantId,
        status: 'queued',
        payload: {
          kind: group.station,
          bytesBase64: Buffer.from(bytes).toString('base64'),
          meta: {
            orderId: ctx.orderId,
            orderNo: ctx.orderNo,
            // K4c — meta artık GRUP bazlı: itemCount o grubun kalem sayısıdır.
            itemCount: groupItems.length,
            groupIndex: groupIndex + 1,
            groupCount,
            renderedAt,
          },
        },
      })
      .execute();
  }
}
