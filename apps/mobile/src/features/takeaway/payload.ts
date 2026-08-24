import type { OrderItemInput } from '../../api/orders';
import type { CartLine } from '../orders/cart';

/**
 * Paket sipariş gövdesi — SAF dönüşümler (ADR-039 K1, DoD 23).
 *
 * Ekrandan ayrı bir modül olmasının iki nedeni var:
 *   1. `OrderScreen`'in dine_in eşleyicisiyle AYNI kuralları taşır (porsiyon,
 *      özellik, not, fiyat override). Ayrışırlarsa "paket çalışıyor, masa
 *      çalışmıyor" sınıfı arıza doğar (ADR-039 E alternatifi).
 *   2. React/RN'e bağımlı olmadığı için birim testi mümkündür — "müşterisiz
 *      kaydedilemez" kuralı bir UI detayı değil, doğrulanabilir bir invaryant
 *      olur (sunucu hattını DB CHECK zaten korur; bu ikinci hat).
 */

/** Kaydet için gereken minimum durum (K5 adım 2-4). */
export interface TakeawayDraft {
  customerId: string | null;
  plannedPaymentType: 'cash' | 'card' | null;
  lineCount: number;
}

/**
 * "Kaydet" mümkün mü? ÜÇ koşul birlikte aranır:
 *   - müşteri seçili (DB CHECK `orders_takeaway_customer_required` — müşterisiz
 *     paket sipariş yapısal olarak imkânsızdır, kullanıcıyı duvara toslatmayız)
 *   - en az bir kalem (`items.min(1)` sunucu şeması)
 *   - ödeme tipi planlanmış (`plannedPaymentType` NOT NULL CHECK, ADR-017)
 *
 * Üçü de sunucu/DB tarafından ayrıca zorlanır; burası UI hattıdır (DoD 23).
 */
export function canSubmitTakeaway(draft: TakeawayDraft): boolean {
  return (
    draft.customerId !== null &&
    draft.plannedPaymentType !== null &&
    draft.lineCount > 0
  );
}

/**
 * Sepet satırlarını sunucu kalem gövdesine çevirir.
 *
 * `OrderScreen.handleSave` ile BİREBİR aynı kurallar: opsiyonel alanlar yalnız
 * doluysa eklenir (`undefined` gönderilmez — zod `.optional()` alanlarında
 * anahtar varlığı anlamlıdır), fiyat override yalnız kullanıcı elle yazdıysa
 * gider (ADR-013 Amd5 K1; aksi halde fiyat otoritesi sunucudadır).
 */
export function buildTakeawayItems(lines: CartLine[]): OrderItemInput[] {
  return lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    ...(line.variantId !== null ? { variantId: line.variantId } : {}),
    ...(line.note !== null ? { note: line.note } : {}),
    ...(line.selectedAttributes.length > 0
      ? {
          selectedAttributes: line.selectedAttributes.map((a) => ({
            groupId: a.groupId,
            optionId: a.optionId,
          })),
        }
      : {}),
    ...(line.unitPriceOverrideCents !== null
      ? { unitPriceOverrideCents: line.unitPriceOverrideCents }
      : {}),
  }));
}

/**
 * Müşterinin listede gösterilecek birincil telefonu; yoksa `null`.
 * Birincil işaretli yoksa ilk telefon kullanılır (web davranışı).
 */
export function primaryPhoneOf(
  phones: ReadonlyArray<{ rawPhone: string; isPrimary: boolean }>,
): string | null {
  return (phones.find((p) => p.isPrimary) ?? phones[0])?.rawPhone ?? null;
}
