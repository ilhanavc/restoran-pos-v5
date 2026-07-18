import type { Category } from '@restoran-pos/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, minTouchTarget, radius, shadow, spacing, typography } from '../../../theme';

interface CategoryGridProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
}

/**
 * Category chip strip (ADR-026 K2/K3 + Amendment 4 K4).
 *
 * A `flexWrap` row of content-sized chips — each chip is only as wide as its
 * label, so long category names are never truncated (they wrap to a second line
 * instead). This replaces the old fixed 31.5%-wide three-column grid where names
 * like "IZGARA ÇEŞİTLERİ" clipped. The selected chip fills with the single brand
 * accent + white label (Amendment 4 K2); the rest are soft-shadowed white chips.
 * Tap targets clear the HCI minimum height.
 */
export function CategoryGrid({
  categories,
  selectedId,
  onSelect,
}: CategoryGridProps): React.JSX.Element {
  return (
    <View style={styles.grid}>
      {categories.map((category) => {
        const isSelected = category.id === selectedId;
        return (
          <Pressable
            key={category.id}
            style={[styles.chip, isSelected && styles.chipSelected]}
            onPress={() => onSelect(category.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={category.name}
          >
            <Text style={[styles.label, isSelected && styles.labelSelected]}>
              {category.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    // Content-sized (no fixed width) so the chip hugs its label and long names
    // wrap instead of clipping. Height keeps the HCI touch target.
    minHeight: minTouchTarget,
    maxWidth: '100%',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  label: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  labelSelected: {
    color: colors.slateText,
  },
});
