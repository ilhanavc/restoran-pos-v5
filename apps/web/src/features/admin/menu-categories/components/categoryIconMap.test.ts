import { describe, it, expect } from 'vitest';
import { CATEGORY_ICONS } from '@restoran-pos/shared-types';
import { CATEGORY_ICON_MAP, resolveCategoryIcon } from './categoryIconMap';

/**
 * DD KOD-3 regresyon koruması: namespace-import kaldırıldıktan sonra dinamik
 * ikon-isimle-çizim davranışının korunduğunu ve lucide'ın tree-shake edildiğini
 * garanti eder. `Record<CategoryIcon, LucideIcon>` zaten derleme-zamanı tam
 * kapsamı zorlar; bu testler runtime davranışını kilitler.
 */
describe('categoryIconMap', () => {
  it('CATEGORY_ICONS whitelist ile map birebir örtüşür (eksik/fazla yok)', () => {
    const mapKeys = Object.keys(CATEGORY_ICON_MAP).sort();
    const whitelist = [...CATEGORY_ICONS].sort();
    expect(mapKeys).toEqual(whitelist);
  });

  it('whitelist ikonlarının hepsi geçerli bir bileşene çözülür', () => {
    for (const name of CATEGORY_ICONS) {
      const Cmp = resolveCategoryIcon(name);
      expect(Cmp).toBeTruthy();
      expect(typeof Cmp === 'function' || typeof Cmp === 'object').toBe(true);
    }
  });

  it('bilinmeyen/boş ad → UtensilsCrossed fallback', () => {
    const fallback = CATEGORY_ICON_MAP.UtensilsCrossed;
    expect(resolveCategoryIcon('NotARealIcon')).toBe(fallback);
    expect(resolveCategoryIcon('')).toBe(fallback);
    expect(resolveCategoryIcon(null)).toBe(fallback);
    expect(resolveCategoryIcon(undefined)).toBe(fallback);
  });

  it('prototype kirlenmesine karşı güvenli (constructor/toString ad değil)', () => {
    // hasOwnProperty guard'ı prototip zincirinden gelen adları reddetmeli
    expect(resolveCategoryIcon('constructor')).toBe(CATEGORY_ICON_MAP.UtensilsCrossed);
    expect(resolveCategoryIcon('toString')).toBe(CATEGORY_ICON_MAP.UtensilsCrossed);
  });
});
