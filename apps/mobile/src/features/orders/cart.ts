import type { ProductWithVariants } from '@restoran-pos/shared-types';
import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Local order cart (ADR-026 K4 + Amendment 3 + ADR-013 §1/§10/§11; satır
 * modeli ürün-sahibi kararıyla değişti — 2026-07-20, Adisyo paritesi).
 *
 * Pure local state — the cart is NOT a server draft; nothing is sent to the
 * cloud until "Kaydet". Kept as a React hook owned by the Order screen so it
 * auto-resets when the waiter leaves the table (each table push mounts a fresh
 * screen → fresh cart).
 *
 * SATIR MODELİ (Amd3 K4'ün içerik-anahtarlı birleştirmesini DEĞİŞTİRİR):
 * `rowId` artık opak/benzersizdir (`line-<seq>`), içerik anahtarı DEĞİLDİR.
 * Aynı içerikli iki satır yan yana yaşayabilir — mutfak fişinde ayrı satırlar
 * ayrı partileri temsil eder (Adisyo fişi: "Lahmacun 1 / 3 / 2" üç satır).
 *   - Kart GÖVDESİNE dokunmak (`addProduct`) → HER ZAMAN yeni satır (1 adet).
 *   - Kart stepper "+" (`incrementProduct`) → o ürünün EN YENİ hızlı-ekleme
 *     satırını büyütür (yoksa yeni satır açar).
 *   - Kart stepper "−" (`decrementProduct`) → EN YENİ hızlı-ekleme satırından
 *     düşer (LIFO — "son ekleneni geri al"); 0'a inince satır silinir.
 *   - Adisyon sheet'indeki satır-içi +/- rowId-bazlıdır, davranışı değişmez.
 * "Hızlı-ekleme satırı" = varsayılan porsiyon + özelliksiz + notsuz; porsiyon/
 * özellik/not eklenmiş satırlar kart stepper'ının hedefi DEĞİLDİR (o satırlar
 * Adisyon sheet'inden yönetilir).
 *
 * Money is integer kuruş; `unitPriceCents = product.priceCents + variant delta +
 * Σ selected extra` (display only — the server stays the price authority, K5).
 */

/** A selected attribute on a cart line (drives both the payload and display). */
export interface CartLineAttribute {
  groupId: string;
  optionId: string;
  /** Option label for the Adisyon summary (e.g. "Duble Kaşarlı"). */
  optionName: string;
  /** Signed extra price in kuruş (> 0 shown as `+₺x`); display only (K5). */
  extraPriceCents: number;
}

export interface CartLine {
  /** Opak benzersiz satır kimliği (`line-<seq>`); içerik anahtarı DEĞİL. */
  rowId: string;
  productId: string;
  productName: string;
  variantId: string | null;
  /** Porsiyon label for display ("Tam Porsiyon"); null when the product has none. */
  variantName: string | null;
  /** Base price + variant delta + Σ selected extras, in kuruş (display; K5). */
  unitPriceCents: number;
  /** Selected attributes (K4/K6); empty for a quick-add line. */
  selectedAttributes: CartLineAttribute[];
  /** Kalem notu (max 280 char); null when none. */
  note: string | null;
  quantity: number;
}

/** The editable slice a line-detail save applies to a cart line (K4). */
export interface CartLineEdit {
  variantId: string | null;
  variantName: string | null;
  unitPriceCents: number;
  quantity: number;
  selectedAttributes: CartLineAttribute[];
  note: string | null;
}

export interface UseCartReturn {
  lines: CartLine[];
  /** Kart gövdesine dokunma: HER ZAMAN yeni satır (varsayılan porsiyon, 1 adet). */
  addProduct: (product: ProductWithVariants) => void;
  increment: (rowId: string) => void;
  /** Decrement; removes the line when it would hit zero. */
  decrement: (rowId: string) => void;
  /** Kart stepper "+": bu ürünün EN YENİ hızlı-ekleme satırını büyütür. */
  incrementProduct: (product: ProductWithVariants) => void;
  /** Kart stepper "−": EN YENİ hızlı-ekleme satırından düşer (LIFO). */
  decrementProduct: (product: ProductWithVariants) => void;
  remove: (rowId: string) => void;
  /**
   * Apply a line-detail edit to an existing line. `rowId` opak olduğu için
   * anahtar yeniden hesaplanmaz ve satırlar ASLA birleştirilmez — aynı içerikli
   * iki satır meşrudur (parti modeli; Amd3 K4 çakışma-birleştirmesi kaldırıldı).
   */
  updateLine: (rowId: string, edit: CartLineEdit) => void;
  clear: () => void;
  /** productId → total pending qty (drives the per-card stepper badge). */
  pendingQtyByProductId: Map<string, number>;
  /** Sum of the pending additions only, in kuruş. */
  subtotalCents: number;
  /** Total pending unit count (drives the header cart badge). */
  totalQuantity: number;
  isDirty: boolean;
}

/** Ürünün varsayılan porsiyonu (is_default, yoksa ilki; porsiyonsuzsa null). */
function defaultVariantOf(product: ProductWithVariants) {
  return product.variants.find((v) => v.isDefault) ?? product.variants[0] ?? null;
}

/**
 * Kart stepper'ının hedeflediği satır mı? Hızlı-ekleme satırı = bu ürünün
 * varsayılan porsiyonu + özelliksiz + notsuz. Porsiyon/özellik/not eklenmiş
 * satırlar karttan DEĞİL, Adisyon sheet'inden yönetilir.
 */
function isQuickAddLine(line: CartLine, product: ProductWithVariants): boolean {
  return (
    line.productId === product.id &&
    line.variantId === (defaultVariantOf(product)?.id ?? null) &&
    line.selectedAttributes.length === 0 &&
    line.note === null
  );
}

export function useCart(): UseCartReturn {
  const [lines, setLines] = useState<CartLine[]>([]);
  // Opak satır kimliği sayacı: render'lar arası kalıcı, remount'ta sıfırlanır
  // (masadan çıkınca sepetle birlikte — aynı yaşam döngüsü).
  const nextSeqRef = useRef(1);

  const makeQuickAddLine = useCallback(
    (product: ProductWithVariants): CartLine => {
      // ADR-013 §10.1: a card tap adds the default variant (is_default, else
      // the first) with no modal, no attributes and no note. Variantless
      // products add at the base price.
      const defaultVariant = defaultVariantOf(product);
      const rowId = `line-${nextSeqRef.current}`;
      nextSeqRef.current += 1;
      return {
        rowId,
        productId: product.id,
        productName: product.name,
        variantId: defaultVariant?.id ?? null,
        variantName: defaultVariant?.name ?? null,
        unitPriceCents: product.priceCents + (defaultVariant?.priceDeltaCents ?? 0),
        selectedAttributes: [],
        note: null,
        quantity: 1,
      };
    },
    [],
  );

  const addProduct = useCallback(
    (product: ProductWithVariants) => {
      // Kart gövdesi: HER ZAMAN yeni satır (parti modeli — ürün sahibi
      // 2026-07-20; Adisyo fişindeki "Lahmacun 1 / 3 / 2" ayrı-satır davranışı).
      setLines((prev) => [...prev, makeQuickAddLine(product)]);
    },
    [makeQuickAddLine],
  );

  const incrementProduct = useCallback(
    (product: ProductWithVariants) => {
      // Kart "+": en yeni hızlı-ekleme satırını büyüt; yoksa ilk satırı aç.
      setLines((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const line = prev[i];
          if (line !== undefined && isQuickAddLine(line, product)) {
            return prev.map((l, idx) =>
              idx === i ? { ...l, quantity: l.quantity + 1 } : l,
            );
          }
        }
        return [...prev, makeQuickAddLine(product)];
      });
    },
    [makeQuickAddLine],
  );

  const increment = useCallback((rowId: string) => {
    setLines((prev) =>
      prev.map((line) =>
        line.rowId === rowId ? { ...line, quantity: line.quantity + 1 } : line,
      ),
    );
  }, []);

  const decrement = useCallback((rowId: string) => {
    setLines((prev) =>
      prev
        .map((line) =>
          line.rowId === rowId
            ? { ...line, quantity: line.quantity - 1 }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }, []);

  const decrementProduct = useCallback((product: ProductWithVariants) => {
    // Kart "−": en yeni hızlı-ekleme satırından düş (LIFO — "son ekleneni geri
    // al"); 0'a inen satır silinir, bir sonraki "−" bir önceki satırı hedefler.
    setLines((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const line = prev[i];
        if (line !== undefined && isQuickAddLine(line, product)) {
          return prev
            .map((l, idx) => (idx === i ? { ...l, quantity: l.quantity - 1 } : l))
            .filter((l) => l.quantity > 0);
        }
      }
      return prev;
    });
  }, []);

  const remove = useCallback((rowId: string) => {
    setLines((prev) => prev.filter((line) => line.rowId !== rowId));
  }, []);

  const updateLine = useCallback((rowId: string, edit: CartLineEdit) => {
    // rowId opak → anahtar yeniden hesaplanmaz, satırlar birleştirilmez:
    // düzenleme yalnız kendi satırını günceller (aynı içerikli iki satır
    // meşrudur — parti modeli).
    setLines((prev) =>
      prev.map((line) =>
        line.rowId === rowId
          ? {
              ...line,
              variantId: edit.variantId,
              variantName: edit.variantName,
              unitPriceCents: edit.unitPriceCents,
              selectedAttributes: edit.selectedAttributes,
              note: edit.note,
              quantity: edit.quantity,
            }
          : line,
      ),
    );
  }, []);

  const clear = useCallback(() => {
    setLines([]);
  }, []);

  const pendingQtyByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) {
      map.set(line.productId, (map.get(line.productId) ?? 0) + line.quantity);
    }
    return map;
  }, [lines]);

  const subtotalCents = useMemo(
    () => lines.reduce((acc, line) => acc + line.unitPriceCents * line.quantity, 0),
    [lines],
  );

  const totalQuantity = useMemo(
    () => lines.reduce((acc, line) => acc + line.quantity, 0),
    [lines],
  );

  return {
    lines,
    addProduct,
    increment,
    decrement,
    incrementProduct,
    decrementProduct,
    remove,
    updateLine,
    clear,
    pendingQtyByProductId,
    subtotalCents,
    totalQuantity,
    isDirty: lines.length > 0,
  };
}
