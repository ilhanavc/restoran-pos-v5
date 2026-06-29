import type { ProductWithVariants } from '@restoran-pos/shared-types';
import { formatMoney } from '@restoran-pos/shared-domain';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../../../theme';
import { QtyStepper } from './QtyStepper';

interface ProductCardProps {
  product: ProductWithVariants;
  /** Pending qty already in the cart for this product (0 = not added yet). */
  quantity: number;
  /** Card width in px (the catalog computes a 3-column grid). */
  width: number;
  onAdd: () => void;
  onDecrement: () => void;
}

/**
 * Single product card (ADR-026 K2: "ürüne dokun = direkt sepete ekle").
 *
 * Tapping anywhere on the card adds the product's default variant — no modal
 * (ADR-013 §10.1). The right rail is ALWAYS reserved (empty until the item is in
 * the cart), so the name/price column keeps a constant width — adding to the
 * cart never reflows the text (reference parity). When in the cart the rail
 * holds a bare vertical control: `+` top-right, the count centred, `−`/trash
 * bottom-right. The buttons capture their own touches, so they never double as a
 * card tap.
 */
export function ProductCard({
  product,
  quantity,
  width,
  onAdd,
  onDecrement,
}: ProductCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const inCart = quantity > 0;
  // Roomy two-column cards can afford larger type; tight three-column cards
  // shrink it so long names still wrap to two lines without truncating.
  const roomy = width >= 140;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { width },
        inCart && styles.cardInCart,
        pressed && styles.cardPressed,
      ]}
      onPress={onAdd}
      accessibilityRole="button"
      accessibilityLabel={`${product.name} — ${formatMoney(product.priceCents)}`}
    >
      <View style={styles.body}>
        <Text style={[styles.name, roomy && styles.nameRoomy]} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={[styles.price, roomy && styles.priceRoomy]}>
          {formatMoney(product.priceCents)}
        </Text>
      </View>

      {/* Always-reserved right rail — keeps the name column width constant. */}
      <View style={styles.rail}>
        {inCart ? (
          <QtyStepper
            spanHeight
            quantity={quantity}
            onIncrement={onAdd}
            onDecrement={onDecrement}
            decrementIcon={quantity > 1 ? 'remove' : 'trash'}
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
    // the right edge. Tight padding so the buttons hug the card corners.
    minHeight: 104,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.xs,
  },
  cardInCart: {
    borderColor: colors.slate,
    borderWidth: 2,
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
  name: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  nameRoomy: {
    fontSize: 15,
  },
  price: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  priceRoomy: {
    fontSize: 15,
  },
});
