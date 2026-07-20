/**
 * Sipariş kalemlerini mutfak istasyonlarına dağıtır (ADR-032 Amendment 1).
 *
 * Restoranda iki mutfak yazıcısı var (FIRIN + IZGARA). Hangi kalemin hangi
 * yazıcıdan basılacağını `categories.print_station` belirler; bu modül o
 * eşlemeyi tek yerden çözer ve **hem mutfak fişi hem iptal fişi** enqueue'su
 * tarafından kullanılır (K14 — iki yol ayrışırsa ızgara kaleminin iptali
 * FIRIN'dan çıkar ve ızgaracı iptali hiç görmez).
 *
 * TASARIM NOTLARI (denetim bulgularından):
 *
 * K4a — JOIN kapsamı: sorgu `order_items`'tan başlar ve products/categories'e
 * **LEFT JOIN** ile bağlanır; `deleted_at` filtresi YOKTUR. Gerekçe:
 * `order_items.product_id` nullable'dır (silinmiş ürün) ve ürün/kategori servis
 * sırasında soft-delete edilebilir. INNER JOIN veya `deleted_at IS NULL`
 * eklenirse o kalem hiçbir gruba düşmez → **hiçbir fişte çıkmaz** ve kimse fark
 * etmez. Girdi olarak verilen her kalem çıktıda MUTLAKA bir gruba düşer.
 *
 * K5 — Fallback `PrintJobKindSchema`'ya karşı DEĞİL, `KITCHEN_STATION_KINDS`
 * alt kümesine karşı çalışır. `'bill'` enum'un geçerli üyesi olduğu için
 * `print_station='bill'` yazım hatası genel şemayla doğrulanırsa fallback
 * tetiklenmez ve mutfak fişi kasa yazıcısından çıkar (v3'ün tip-güvensiz
 * yönlendirme hatası). Alt küme ile bu yapısal olarak imkânsızdır.
 */

import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  DEFAULT_KITCHEN_STATION,
  isKitchenStation,
  type KitchenStationKind,
} from '@restoran-pos/shared-types';

/**
 * İstasyon slug'ının fiş üstünde basılacak Türkçe karşılığı (ADR-032 Amd1 K16).
 * Slug kod-içi İngilizce (proje dili kuralı); kullanıcıya görünen metin Türkçe.
 * Tek-tenant pilot: `kitchen` fiziksel olarak pide fırınının yazıcısıdır.
 */
const STATION_LABELS_TR: Record<KitchenStationKind, string> = {
  kitchen: 'FIRIN',
  grill: 'IZGARA',
};

/** Fiş üstüne basılacak istasyon etiketi (bilinmeyen slug'da boş string). */
export function stationLabelTr(station: KitchenStationKind): string {
  return STATION_LABELS_TR[station];
}

/**
 * Verilen kalem id'lerini istasyonlara göre gruplar.
 *
 * Dönen Map'in anahtar sırası, kalemlerin `itemIds` içindeki sırasını izler
 * (fiş sırası belirlenimli olsun diye). Boş girdi → boş Map.
 *
 * @param itemIds Gruplanacak `order_items.id` listesi (caller zaten çekmiştir).
 */
export async function resolveItemStations(
  db: Kysely<DB>,
  tenantId: string,
  itemIds: readonly string[],
): Promise<Map<KitchenStationKind, string[]>> {
  const groups = new Map<KitchenStationKind, string[]>();
  if (itemIds.length === 0) return groups;

  const rows = await db
    .selectFrom('order_items as oi')
    // LEFT JOIN + tenant koşulu ON içinde (WHERE'e taşınırsa INNER JOIN'e döner
    // ve silinmiş ürünlü kalem sessizce düşer — K4a).
    .leftJoin('products as p', (join) =>
      join.onRef('p.id', '=', 'oi.product_id').on('p.tenant_id', '=', tenantId),
    )
    .leftJoin('categories as c', (join) =>
      join.onRef('c.id', '=', 'p.category_id').on('c.tenant_id', '=', tenantId),
    )
    .select(['oi.id as item_id', 'c.print_station as print_station'])
    .where('oi.tenant_id', '=', tenantId)
    .where('oi.id', 'in', itemIds as string[])
    .execute();

  const stationByItem = new Map<string, KitchenStationKind>();
  for (const row of rows) {
    stationByItem.set(
      row.item_id,
      isKitchenStation(row.print_station) ? row.print_station : DEFAULT_KITCHEN_STATION,
    );
  }

  // itemIds sırasını koruyarak grupla. Satırı hiç dönmeyen kalem (kalem sorgu
  // arası silinmişse) taban istasyona düşer — K4a invaryantı: girdi sayısı =
  // gruplara dağıtılan sayı; kayıp kalem sessizce yutulmaz, iz bırakılır.
  let missing = 0;
  for (const itemId of itemIds) {
    let station = stationByItem.get(itemId);
    if (station === undefined) {
      station = DEFAULT_KITCHEN_STATION;
      missing += 1;
    }
    const list = groups.get(station);
    if (list === undefined) groups.set(station, [itemId]);
    else list.push(itemId);
  }

  if (missing > 0) {
    console.error(
      `[resolveItemStations] ${missing}/${itemIds.length} kalem için istasyon satırı bulunamadı; taban istasyona düşürüldü (tenant=${tenantId})`,
    );
  }

  return groups;
}
