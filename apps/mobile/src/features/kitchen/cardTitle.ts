/**
 * Mutfak kartının başlık metni — saf karar (#790).
 *
 * Ekrandan AYRI tutulur çünkü bu depoda RN bileşeni render eden test altyapısı
 * yoktur (`apps/mobile/vitest.config.ts`): kritik karar saf fonksiyona çekilir,
 * bileşen ikinci bir koşul taşımaz.
 *
 * ## Çözülen hata
 *
 * `tableCodeSnapshot` ham masa kodu DEĞİLDİR. ADR-009 Amendment 2026-06-30
 * Karar A'dan beri sunucu oraya **kanonik etiketi** yazar (`tableLabel()` →
 * bölgeli masada `"Masa {display_no}"`, bölgesiz orphan'da ham `code`). Ekran
 * bu değerin başına bir kez daha "Masa " ekliyordu → kart **"Masa Masa 1"**
 * basıyordu; web kartı (`apps/web/src/features/kds/KdsOrderCard.tsx`) ise
 * snapshot'ı olduğu gibi gösteriyordu, yani iki istemci ayrışmıştı.
 *
 * ## Bölge adı neden şart
 *
 * `display_no` **bölge içinde** kalıcıdır (Karar A), tenant genelinde tekil
 * DEĞİLDİR: prod'da dört ayrı masa `display_no = 1` taşıyor. Bölge adı
 * basılmazsa "Masa 1" dört masayı birden gösterebilir — #790'ın şikâyeti tam
 * buydu. Bölge adı varsa etiketin önüne konur; yoksa (bölgesiz masa) snapshot
 * zaten ham koddur ve tekildir.
 */

/** Başlık için gereken minimum kart şekli (KitchenBatch bunu karşılar). */
export interface KitchenCardTitleInput {
  orderType: 'dine_in' | 'takeaway';
  /** Kanonik masa etiketi snapshot'ı; paket siparişte / masası silinmişse null. */
  tableCodeSnapshot: string | null;
  /** Bölge adı snapshot'ı; bölgesiz masada null. */
  areaNameSnapshot: string | null;
}

/** i18next `t`'nin bu fonksiyonun ihtiyaç duyduğu dar yüzü. */
export type TranslateFn = (
  key: string,
  params?: Record<string, string>,
) => string;

export function kitchenCardTitle(
  card: KitchenCardTitleInput,
  t: TranslateFn,
): string {
  if (card.orderType === 'takeaway') {
    return t('kitchen.takeaway');
  }
  const label = card.tableCodeSnapshot;
  if (label === null) {
    return t('kitchen.tableUnknown');
  }
  if (card.areaNameSnapshot === null) {
    // Snapshot zaten gösterilecek metnin TAMAMI — başına hiçbir şey eklenmez.
    return label;
  }
  return t('kitchen.tableWithArea', { area: card.areaNameSnapshot, label });
}
