import {
  Apple,
  Beef,
  Beer,
  Cake,
  Cherry,
  Coffee,
  Cookie,
  Croissant,
  Drumstick,
  Egg,
  Fish,
  IceCreamBowl,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import { type CategoryIcon } from '@restoran-pos/shared-types';

/**
 * Kategori ikonu adı → lucide bileşeni (DD KOD-3).
 *
 * Yalnız `CATEGORY_ICONS` whitelist'i (18 ikon, ADR-011 Amendment 2026-05-01)
 * STATİK import edilir. Önceki `import * as LucideIcons from 'lucide-react'`
 * + dinamik `LucideIcons[name]` deseni Rollup'ın hangi ikonların kullanıldığını
 * statik çözmesini engelliyor → tüm 3904 ikon bundle'a giriyordu (~876KB).
 * Bu map dinamik-isimle-çizim davranışını korur ama lucide'ı 18 ikona indirir,
 * tree-shaking'i geri kazandırır. Tek kaynak: 3 tüketici (CategoryListItem,
 * IconPicker, ReorderCategoriesModal) buradan okur.
 */
export const CATEGORY_ICON_MAP: Record<CategoryIcon, LucideIcon> = {
  Apple,
  Beef,
  Beer,
  Cake,
  Cherry,
  Coffee,
  Cookie,
  Croissant,
  Drumstick,
  Egg,
  Fish,
  IceCreamBowl,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  UtensilsCrossed,
  Wine,
};

/** Whitelist-dışı / bilinmeyen ad için güvenli fallback (UtensilsCrossed). */
export function resolveCategoryIcon(name: string | undefined | null): LucideIcon {
  if (name && Object.prototype.hasOwnProperty.call(CATEGORY_ICON_MAP, name)) {
    return CATEGORY_ICON_MAP[name as CategoryIcon];
  }
  return UtensilsCrossed;
}
