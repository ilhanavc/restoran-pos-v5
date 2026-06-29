import type {
  Category,
  ProductVariant,
  ProductWithVariants,
} from '@restoran-pos/shared-types';

/**
 * Mock menu backend (ADR-026 K8).
 *
 * Lets the Order screen run on a physical phone with no live API: a colourful
 * category grid (`category.color`) + a catalog of products, a couple with
 * porsiyon variants (pide Tam/Yarım) so the "Tam Porsiyon" line label is
 * exercised. Replaced by the real `GET /menu/categories` + `/menu/products`
 * transport in PR-5d (USE_MOCK = false). Fabricated demo data — no PII.
 *
 * The shapes are the canonical shared-types schemas (`Category`,
 * `ProductWithVariants`) the cloud API already speaks, so PR-5d swaps the mock
 * for a `fetch` + zod parse with no shape change. Money is integer kuruş.
 */

const TENANT_ID = '00000000-0000-4000-8000-0000000000ff';
const MOCK_DELAY_MS = 350;
const NOW_ISO = '2026-06-28T12:00:00.000Z';

// Category ids — `cat0N` suffix. Product ids — `prdNN`. Variant ids — `varNN`.
const CAT = {
  pide: '00000000-0000-4000-8000-00000000ca01',
  lahmacun: '00000000-0000-4000-8000-00000000ca02',
  corba: '00000000-0000-4000-8000-00000000ca03',
  izgara: '00000000-0000-4000-8000-00000000ca04',
  icecek: '00000000-0000-4000-8000-00000000ca05',
  tatli: '00000000-0000-4000-8000-00000000ca06',
} as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeCategory(
  id: string,
  name: string,
  sortOrder: number,
  icon: Category['icon'],
  color: Category['color'],
): Category {
  return {
    id,
    tenantId: TENANT_ID,
    name,
    sortOrder,
    vatRateBps: 1000,
    icon,
    color,
    deletedAt: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

function makeVariant(
  id: string,
  productId: string,
  name: string,
  priceDeltaCents: number,
  isDefault: boolean,
  sortOrder: number,
): ProductVariant {
  return {
    id,
    tenantId: TENANT_ID,
    productId,
    name,
    priceDeltaCents,
    isDefault,
    sortOrder,
    deletedAt: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

function makeProduct(
  id: string,
  categoryId: string,
  name: string,
  priceCents: number,
  sortOrder: number,
  variants: ProductVariant[] = [],
): ProductWithVariants {
  return {
    id,
    tenantId: TENANT_ID,
    categoryId,
    name,
    priceCents,
    description: null,
    barcode: null,
    isActive: true,
    sortOrder,
    deletedAt: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    variants,
  };
}

/** Pide products carry a Tam (default) / Yarım porsiyon pair. */
function pideVariants(productId: string, fullPrice: number): ProductVariant[] {
  return [
    makeVariant(`${productId}-vt`, productId, 'Tam Porsiyon', 0, true, 0),
    // Yarım porsiyon = -40% of the base price (negative delta, integer kuruş).
    makeVariant(
      `${productId}-vy`,
      productId,
      'Yarım Porsiyon',
      -Math.round(fullPrice * 0.4),
      false,
      1,
    ),
  ];
}

function makeCategories(): Category[] {
  return [
    makeCategory(CAT.pide, 'Pideler', 0, 'Pizza', '#dc2626'),
    makeCategory(CAT.lahmacun, 'Lahmacun', 1, 'Sandwich', '#ea580c'),
    makeCategory(CAT.corba, 'Çorbalar', 2, 'Soup', '#d97706'),
    makeCategory(CAT.izgara, 'Izgara', 3, 'Beef', '#16a34a'),
    makeCategory(CAT.icecek, 'İçecekler', 4, 'Beer', '#0891b2'),
    makeCategory(CAT.tatli, 'Tatlılar', 5, 'Cake', '#db2777'),
  ];
}

function makeProducts(): ProductWithVariants[] {
  return [
    // Pideler — varyantlı (Tam/Yarım).
    makeProduct('p01', CAT.pide, 'Kıymalı Pide', 18_000, 0, pideVariants('p01', 18_000)),
    makeProduct('p02', CAT.pide, 'Kaşarlı Pide', 17_000, 1, pideVariants('p02', 17_000)),
    makeProduct('p03', CAT.pide, 'Karışık Pide', 20_000, 2, pideVariants('p03', 20_000)),
    makeProduct('p04', CAT.pide, 'Kuşbaşılı Pide', 22_000, 3, pideVariants('p04', 22_000)),
    // Lahmacun.
    makeProduct('p05', CAT.lahmacun, 'Lahmacun', 7_000, 0),
    makeProduct('p06', CAT.lahmacun, 'Peynirli Lahmacun', 8_500, 1),
    // Çorbalar.
    makeProduct('p07', CAT.corba, 'Mercimek Çorbası', 6_000, 0),
    makeProduct('p08', CAT.corba, 'İşkembe Çorbası', 7_500, 1),
    // Izgara.
    makeProduct('p09', CAT.izgara, 'Adana Kebap', 24_000, 0),
    makeProduct('p10', CAT.izgara, 'Urfa Kebap', 24_000, 1),
    makeProduct('p11', CAT.izgara, 'Tavuk Şiş', 21_000, 2),
    makeProduct('p12', CAT.izgara, 'Izgara Köfte', 20_000, 3),
    // İçecekler.
    makeProduct('p13', CAT.icecek, 'Ayran', 2_500, 0),
    makeProduct('p14', CAT.icecek, 'Kola', 3_000, 1),
    makeProduct('p15', CAT.icecek, 'Şalgam', 2_500, 2),
    makeProduct('p16', CAT.icecek, 'Su', 1_500, 3),
    // Tatlılar.
    makeProduct('p17', CAT.tatli, 'Künefe', 12_000, 0),
    makeProduct('p18', CAT.tatli, 'Sütlaç', 8_000, 1),
    makeProduct('p19', CAT.tatli, 'Baklava', 14_000, 2),
  ];
}

/** Simulate `GET /menu/categories` (sorted by `sortOrder` ASC). */
export async function mockGetMenuCategories(): Promise<Category[]> {
  await delay(MOCK_DELAY_MS);
  return makeCategories();
}

/** Simulate `GET /menu/products` (active products, variants nested). */
export async function mockGetMenuProducts(): Promise<ProductWithVariants[]> {
  await delay(MOCK_DELAY_MS);
  return makeProducts();
}
