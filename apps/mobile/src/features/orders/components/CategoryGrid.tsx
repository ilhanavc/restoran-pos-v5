import type { Category } from '@restoran-pos/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, minTouchTarget, radius, spacing, typography } from '../../../theme';

interface CategoryGridProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
}

/**
 * Category tab grid (ADR-026 K2/K3 + Amendment 4 K4, user-revised).
 *
 * Equal-width tiles in a `flexWrap` grid (Adisyo-style orderly tabs — user
 * feedback S99: content-sized chips looked ragged). Labels wrap freely (no
 * numberOfLines) so long names like "IZGARA ÇEŞİTLERİ" never truncate; rows
 * stretch so tiles in the same row stay equal height. Unselected tiles are
 * fill-less outlines so they read as tabs, not product cards (which stay
 * white + shadowed); the selected tile fills with the brand accent (K2).
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
    // Tiles in the same wrapped row stretch to the row's height — equal-size
    // look even when one label wraps to two lines.
    alignItems: 'stretch',
  },
  chip: {
    // Fixed three-column width (equal tiles); labels wrap freely inside, so
    // long names grow the tile instead of clipping. Height keeps the HCI
    // touch target. No fill/shadow: tabs must not read as product cards.
    width: '31.5%',
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
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
