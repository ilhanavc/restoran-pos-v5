/**
 * Paket akışının SAF karar noktaları (ADR-039 Amendment 1).
 *
 * `TakeawayOrderScreen` React Native bileşenlerini import ettiği için birim
 * testi ile render edilemez (bkz. `vitest.config.ts` JSDoc'u: bu depoda
 * jest-expo / @testing-library/react-native katmanı bilinçli olarak YOKTUR).
 * Bu yüzden akışın **kritik kararları** bileşenden ayrı, saf fonksiyonlara
 * çekilir; bileşen bu fonksiyonların dışında ikinci bir koşul TAŞIMAZ —
 * tek koruma hattı = tek test noktası.
 */

/** "İleri" sonrası açılacak sheet. `'none'` bu modülde üretilmez. */
export type TakeawaySheet = 'customer' | 'payment';

/**
 * "İleri"ye basıldığında hangi sheet açılır? (Amd1 K3 + K4)
 *
 * - **Müşteri yoksa → `'customer'`** ve akış orada DURUR. Ödeme sheet'i
 *   açılmaz, `POST /orders` denenmez. Bu, `orders_takeaway_customer_required`
 *   DB CHECK'inin UI hattıdır: garson `TAKEAWAY_CUSTOMER_REQUIRED` sunucu
 *   reddini HİÇ görmez (web `OrderScreenPage.tsx:796-800` paritesi).
 * - **Müşteri varsa → `'payment'`** (K4 kısa devresi): ödeme sheet'i kapatılıp
 *   "İleri"ye tekrar basıldığında müşteri ikinci kez sorulmaz.
 */
export function sheetAfterNext(customerId: string | null): TakeawaySheet {
  return customerId === null ? 'customer' : 'payment';
}

/**
 * Kaydet denemesinin idempotency key'i (ADR-013 Amd1 K9 / ADR-039 K1).
 *
 * Mevcut key varsa AYNISI döner — hata sonrası "Tekrar Dene" ikinci bir sipariş
 * yaratmaz, sunucu 200 replay ile yanıtlar. Key yalnız başarıdan sonra `null`'a
 * çekilir (çağıran tarafın sorumluluğu), böylece sonraki sipariş taze başlar.
 *
 * Mobil ağ kararsızdır; bu invaryant olmadan retry = çift sipariş = çift mutfak
 * fişi + çift paket fişi + çift para.
 */
export function resolveIdempotencyKey(
  current: string | null,
  generate: () => string,
): string {
  return current ?? generate();
}
