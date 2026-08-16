import type { ApiOrderItem } from './api';
import type { CartItem, InheritedComposition } from './useOrderCart';

/**
 * ADR-013 Amendment 6 — Katalog-tap ile açılan yeni satırın MİRAS alacağı
 * porsiyon/özellik bileşimini çözer (K1/K2/K6 köprü deseni).
 *
 * Kaynak havuzu = pending sepet (`useOrderCart.items`) ∪ persisted "MEVCUT
 * ÜRÜNLER" satırları (`OrderScreenPage` react-query). Aynı `productId` ile
 * eşleşen satırlar arasından **en son düzenlenen/eklenen** aday seçilir ve
 * bileşimi (`variant` + `selectedAttributes`) seed olarak döner. Eşleşen satır
 * yoksa `null` → çağıran taraf bugünkü `defaultVariantOf` davranışına düşer.
 *
 * Recency kuralı (deterministik, K1/K2):
 *  1. Önce PENDING eşleşenler değerlendirilir — kullanıcının bu oturumda EN SON
 *     dokunduğu satırlar bunlardır; en yüksek `rowId` sıra numaralısı (`line-N`,
 *     monoton artan) kazanır. Pending, aynı oturumun en yeni niyetidir; bu
 *     yüzden persisted'ten önce gelir.
 *  2. Pending eşleşen yoksa PERSISTED eşleşenlerden en yeni `created_at`'li
 *     (eşitlikte `id`) kazanır. `cancelled` satırlar miras kaynağı OLAMAZ.
 * Pending vs persisted arası KATEGORİ önceliği yoktur; yalnız zaman belirler.
 * `unitPriceOverrideCents` bilinçli olarak taşınmaz (K3) — bileşim yalnız
 * porsiyon + özellik.
 */
export function resolveInheritedComposition(
  productId: string,
  pendingItems: readonly CartItem[],
  persistedItems: readonly ApiOrderItem[],
): InheritedComposition | null {
  // 1) Pending eşleşenler — en yüksek rowId sıra numarası kazanır.
  let bestPending: CartItem | null = null;
  let bestPendingSeq = -1;
  for (const it of pendingItems) {
    if (it.productId !== productId) continue;
    const seq = rowSeq(it.rowId);
    if (seq > bestPendingSeq) {
      bestPendingSeq = seq;
      bestPending = it;
    }
  }
  if (bestPending !== null) {
    return {
      variant: bestPending.variant,
      selectedAttributes: bestPending.selectedAttributes.map((a) => ({
        groupId: a.groupId,
        optionId: a.optionId,
        groupName: a.groupName,
        optionName: a.optionName,
        extraPriceCents: a.extraPriceCents,
      })),
    };
  }

  // 2) Persisted eşleşenler — en yeni created_at (eşitlikte id) kazanır;
  //    cancelled hariç.
  let bestPersisted: ApiOrderItem | null = null;
  for (const it of persistedItems) {
    if (it.product_id !== productId || it.status === 'cancelled') continue;
    if (
      bestPersisted === null ||
      it.created_at > bestPersisted.created_at ||
      (it.created_at === bestPersisted.created_at && it.id > bestPersisted.id)
    ) {
      bestPersisted = it;
    }
  }
  if (bestPersisted !== null) {
    return {
      variant:
        bestPersisted.variant_id_snapshot !== null
          ? {
              variantId: bestPersisted.variant_id_snapshot,
              variantName: bestPersisted.variant_name_snapshot ?? '',
              priceDeltaCents:
                bestPersisted.variant_price_delta_cents_snapshot ?? 0,
            }
          : null,
      selectedAttributes: bestPersisted.attributes.map((a) => ({
        groupId: a.attribute_group_id,
        optionId: a.attribute_option_id,
        groupName: a.group_name_snapshot,
        optionName: a.option_name_snapshot,
        extraPriceCents: a.extra_price_cents_snapshot,
      })),
    };
  }

  return null;
}

/** Opak `line-N` rowId'sinden N sıra numarasını ayrıştırır (Amd2 K3 sayacı).
 *  Beklenmeyen biçimde -1 → hiç seçilmez (güvenli varsayılan). */
function rowSeq(rowId: string): number {
  const m = /^line-(\d+)$/.exec(rowId);
  return m ? Number(m[1]) : -1;
}
