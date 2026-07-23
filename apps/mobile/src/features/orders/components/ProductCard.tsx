import type { ProductWithVariants } from '@restoran-pos/shared-types';
import { formatMoney } from '@restoran-pos/shared-domain';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadow, spacing, typography } from '../../../theme';
import { QtyStepper } from './QtyStepper';

interface ProductCardProps {
  product: ProductWithVariants;
  /** Pending qty already in the cart for this product (0 = not added yet). */
  quantity: number;
  /**
   * Bu üründen ADİSYONA KAYDEDİLMİŞ toplam adet (0 = yok) — S104, ürün sahibi
   * talebi (Adisyo paritesi): "kaydettikten sonra masaya girince hangi üründen
   * kaç tane olduğu kartta görünsün".
   *
   * Sayaçta `quantity` ile TOPLANARAK gösterilir (Adisyo paritesi), ama
   * DÜŞÜRÜLEMEZ: `−` yalnız sepetteki kısmı azaltır, sepet bitince pasifleşir.
   * Kaydedilmiş kalemi azaltmak sipariş kalemi İPTALİDİR (yetki + audit +
   * mutfağa iptal fişi, ADR-027 Amd2) ve bu karttan yapılamaz.
   */
  savedQuantity: number;
  /** Card width in px (the catalog computes a 2- or 3-column grid). */
  width: number;
  /** Kart gövdesi: YENİ satır açar (parti modeli — 2026-07-20 kararı). */
  onAdd: () => void;
  /** Stepper "+": mevcut EN YENİ hızlı-ekleme satırını büyütür. */
  onIncrement: () => void;
  onDecrement: () => void;
}

/**
 * Single product card (ADR-026 K2: "ürüne dokun = direkt sepete ekle").
 *
 * Tapping anywhere on the card adds the product's default variant as a NEW
 * adisyon line — no modal (ADR-013 §10.1; parti modeli 2026-07-20: gövde = yeni
 * satır, stepper "+" = son satırı büyüt). The right rail is ALWAYS reserved (empty until the item is in
 * the cart), so the name/price column keeps a constant width — adding to the
 * cart never reflows the text (reference parity). When in the cart the rail
 * holds a bare vertical control: `+` top-right, the count centred, `−`/trash
 * bottom-right. The buttons capture their own touches, so they never double as a
 * card tap.
 */
export function ProductCard({
  product,
  quantity,
  savedQuantity,
  width,
  onAdd,
  onIncrement,
  onDecrement,
}: ProductCardProps): React.JSX.Element {
  const { t } = useTranslation();
  /**
   * Kartta gösterilen sayı = ADİSYONDAKİ + SEPETTEKİ (S104, ürün sahibi:
   * "Adisyo gibi olsun — kaydettikten sonra da kartta kaç tane olduğu görünsün").
   *
   * `−` YALNIZ sepetteki kısmı düşürür; sepet biterse pasifleşir — kayıtlı
   * kalemi karttan silmek mümkün DEĞİLDİR (iptal ayrı akış: yetki + audit +
   * mutfağa iptal fişi, ADR-027 Amd2).
   */
  const totalQuantity = savedQuantity + quantity;
  const hasAny = totalQuantity > 0;
  const canDecrement = quantity > 0;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { width },
        hasAny && styles.cardInCart,
        pressed && styles.cardPressed,
      ]}
      onPress={onAdd}
      accessibilityRole="button"
      accessibilityLabel={`${product.name} — ${formatMoney(product.priceCents)}`}
    >
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.price}>{formatMoney(product.priceCents)}</Text>
      </View>

      {/* Always-reserved right rail — keeps the name column width constant. */}
      <View style={styles.rail}>
        {hasAny ? (
          <QtyStepper
            spanHeight
            quantity={totalQuantity}
            onIncrement={onIncrement}
            onDecrement={onDecrement}
            // Çöp ikonu YALNIZ sepetteki son adet silinecekken; kayıtlı kalem
            // varken bir daha basmak satırı silmez → çöp göstermek yanıltıcı.
            decrementIcon={quantity === 1 && savedQuantity === 0 ? 'trash' : 'remove'}
            decrementDisabled={!canDecrement}
            increaseLabel={t('order.card.increase')}
            decreaseLabel={t('order.card.decrease')}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    // Reference parity: name top-left, price bottom-left, +/count/− pinned down
    // the right edge. Tight padding so the buttons hug the card corners. A thin
    // border + soft shadow (Amendment 4 K3) replaces the old heavy border.
    minHeight: 104,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.xs,
    ...shadow,
  },
  cardInCart: {
    borderColor: colors.slate,
  },
  cardPressed: {
    opacity: 0.85,
  },
  body: {
    flex: 1,
    justifyContent: 'space-between',
  },
  rail: {
    width: 30,
  },
  // hci pos-checklist "min 14pt": name/price stay >=15 in BOTH column modes
  // (Amd4 gate blocker — the old 12-13px dense variant violated the floor).
  name: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.semibold,
    color: colors.textPrimary,
  },
  price: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
});
