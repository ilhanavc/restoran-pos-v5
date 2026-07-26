import { useCallback, useMemo, useState } from 'react';
import { calculateItemSubtotal } from '@restoran-pos/shared-domain';
import type { ProductWithVariants } from '@restoran-pos/shared-types';
import type { ApiOrderItem } from '../../api/orders';
import type { OrderItemPatch } from '../../api/client';

/**
 * KAYITLI kalem düzenlemelerinin bekleyen (staged) katmanı — ADR-013 Amendment 4
 * (web `apps/web/src/features/orders/useStagedItemEdits.ts` ikizi; K5 "web +
 * mobil davranışı BİREBİR aynı").
 *
 * Amd4'e kadar kayıtlı bir kalemin düzenlenmesi ANINDA `PATCH` atıyordu; yeni
 * ürün sepeti ise Kaydet'e kadar bekliyordu — aynı ekranda iki zihinsel model.
 * Artık ikisi de tek modelde: **sheet Kaydet = stage, adisyon Kaydet = commit.**
 *
 * K1: bekleyen yamalar `itemId → OrderItemPatch` haritasında, ekran-yerel
 * tutulur (sunucuda draft yok — ADR-013 §1'in kayıtlı kalemlere genişlemesi;
 * `cart.ts` `useCart` paterni). react-query cache commit'e kadar MUTASYONA
 * UĞRAMAZ; ekranda gösterilen değer `mergeStagedItem` ile türetilir.
 *
 * K9: ekrandan çıkış = unmount = harita sıfırlanır (sepet paritesi).
 */

export interface UseStagedItemEditsReturn {
  /** itemId → bekleyen yama. Boş harita = kaydedilmemiş düzenleme yok. */
  staged: ReadonlyMap<string, OrderItemPatch>;
  /**
   * Sheet "Kaydet" — yamayı biriktirir. Sunucudaki değere EŞİT alanlar düşürülür
   * (gereksiz PATCH + gereksiz audit kaydı üretmemek için); yama tamamen
   * boşalırsa satır staged olmaktan çıkar.
   */
  stageEdit: (baseItem: ApiOrderItem, patch: OrderItemPatch) => void;
  /** Silme onayı sonrası — satırı "silinecek" işaretler (K3/K4). */
  stageVoid: (itemId: string) => void;
  /** Bekleyen değişikliği geri alır (K4 — commit öncesi vazgeçme). */
  unstage: (itemId: string) => void;
  /** Commit'te başarılı olan satırları haritadan düşürür (K5 best-effort). */
  clearMany: (itemIds: readonly string[]) => void;
  clear: () => void;
  /** K8 — Kaydet butonunun görünürlük koşuluna giren dirty ayağı. */
  isDirty: boolean;
}

export function useStagedItemEdits(): UseStagedItemEditsReturn {
  const [staged, setStaged] = useState<Map<string, OrderItemPatch>>(
    () => new Map(),
  );

  const stageEdit = useCallback(
    (baseItem: ApiOrderItem, patch: OrderItemPatch) => {
      setStaged((prev) => {
        // "Silinecek" işaretli satır düzenlenemez (UI de dokunuşu engeller);
        // burada da yok sayılır ki düzenleme sessizce yutulup kullanıcıya
        // yanlışlıkla "işlendi" denmesin. Kullanıcı önce silmeyi geri alır.
        if (prev.get(baseItem.id)?.status === 'cancelled') return prev;
        const merged: OrderItemPatch = {
          ...(prev.get(baseItem.id) ?? {}),
          ...patch,
        };
        const normalized = dropUnchanged(baseItem, merged);
        const next = new Map(prev);
        if (Object.keys(normalized).length === 0) {
          next.delete(baseItem.id);
        } else {
          next.set(baseItem.id, normalized);
        }
        return next;
      });
    },
    [],
  );

  const stageVoid = useCallback((itemId: string) => {
    setStaged((prev) => {
      const next = new Map(prev);
      // Silme diğer alanları anlamsız kılar: satır zaten kaldırılacak.
      next.set(itemId, { status: 'cancelled' });
      return next;
    });
  }, []);

  const unstage = useCallback((itemId: string) => {
    setStaged((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  const clearMany = useCallback((itemIds: readonly string[]) => {
    if (itemIds.length === 0) return;
    setStaged((prev) => {
      const next = new Map(prev);
      for (const id of itemIds) next.delete(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setStaged(new Map());
  }, []);

  return useMemo(
    () => ({
      staged,
      stageEdit,
      stageVoid,
      unstage,
      clearMany,
      clear,
      isDirty: staged.size > 0,
    }),
    [staged, stageEdit, stageVoid, unstage, clearMany, clear],
  );
}

/** Sunucudaki değerle aynı olan alanları yamadan düşürür. */
function dropUnchanged(
  baseItem: ApiOrderItem,
  patch: OrderItemPatch,
): OrderItemPatch {
  // Silme işareti asla "değişmemiş" sayılmaz — tek başına anlamlıdır.
  if (patch.status === 'cancelled') return { status: 'cancelled' };

  const next: OrderItemPatch = {};
  if (patch.quantity !== undefined && patch.quantity !== baseItem.quantity) {
    next.quantity = patch.quantity;
  }
  if (
    patch.unitPriceCents !== undefined &&
    patch.unitPriceCents !== baseItem.unit_price_cents
  ) {
    next.unitPriceCents = patch.unitPriceCents;
  }
  if (
    patch.variantId !== undefined &&
    (patch.variantId ?? null) !== (baseItem.variant_id_snapshot ?? null)
  ) {
    next.variantId = patch.variantId;
  }
  if (patch.note !== undefined && (patch.note ?? '') !== (baseItem.note ?? '')) {
    next.note = patch.note;
  }
  if (patch.isComped !== undefined && patch.isComped !== baseItem.is_comped) {
    next.isComped = patch.isComped;
  }
  return next;
}

/**
 * K6 — bekleyen porsiyon değişiminin birim fiyat ÖN-GÖSTERİMİ.
 *
 * Fiyat otoritesi sunucudadır (ADR-013 §2): commit'te sunucu eski varyant
 * deltasını düşüp yenisini ekleyerek fiyatı yeniden kurar (Amd3). Buradaki
 * hesap yalnız ekranda gösterilen ön-izlemedir ve sunucunun formülünü birebir
 * izler — ürün tabanı + özellik ekstraları korunur.
 *
 * Kullanıcı fiyatı ELLE girdiyse o kazanır (Amd3 K2).
 */
export function projectUnitPriceCents(
  item: ApiOrderItem,
  patch: OrderItemPatch | undefined,
  product: ProductWithVariants | null,
): number {
  if (patch === undefined) return item.unit_price_cents;
  if (patch.unitPriceCents !== undefined) return patch.unitPriceCents;
  if (patch.variantId === undefined) return item.unit_price_cents;

  const oldDelta = item.variant_price_delta_cents_snapshot ?? 0;
  const newDelta =
    patch.variantId === null
      ? 0
      : product?.variants.find((v) => v.id === patch.variantId)
          ?.priceDeltaCents ?? 0;
  return item.unit_price_cents - oldDelta + newDelta;
}

/**
 * Kayıtlı kalem + bekleyen yama = ekranda gösterilen kalem (K1 "merged
 * display"). Sheet ikinci kez açıldığında da bu değerler ön-doldurulur, böylece
 * garson sunucudakini değil kendi bekleyen değişikliğini görür.
 *
 * `total_cents` saf domain fonksiyonuyla üretilir (K6): ikram/iptal işaretli
 * satır 0 gösterir — mantık kopyalanmaz.
 */
export function mergeStagedItem(
  item: ApiOrderItem,
  patch: OrderItemPatch | undefined,
  product: ProductWithVariants | null,
): ApiOrderItem {
  if (patch === undefined) return item;

  const unitPriceCents = projectUnitPriceCents(item, patch, product);
  const quantity = patch.quantity ?? item.quantity;
  const isComped = patch.isComped ?? item.is_comped;
  const isCancelled =
    patch.status === 'cancelled' || item.status === 'cancelled';
  const variantId =
    patch.variantId !== undefined ? patch.variantId : item.variant_id_snapshot;
  const variantName =
    patch.variantId === undefined
      ? item.variant_name_snapshot
      : patch.variantId === null
        ? null
        : product?.variants.find((v) => v.id === patch.variantId)?.name ?? null;

  return {
    ...item,
    quantity,
    unit_price_cents: unitPriceCents,
    total_cents: calculateItemSubtotal({
      unitPriceCents,
      quantity,
      isComp: isComped,
      isCancelled,
    }),
    is_comped: isComped,
    note: patch.note !== undefined ? patch.note : item.note,
    variant_id_snapshot: variantId,
    variant_name_snapshot: variantName,
  };
}
