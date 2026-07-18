import type { Category } from '@restoran-pos/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  categoryPastels,
  colors,
  radius,
  shadow,
  spacing,
  typography,
} from '../../../theme';

interface CategoryGridProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
}

/**
 * Category tab grid (ADR-026 Amendment 4 K4 — S99 pastel revision).
 *
 * Equal-width tiles, each filled with a distinct pastel from a fixed palette
 * cycled by position (Adisyo reference; category data has no distinct colours,
 * so the palette is deterministic and data-independent). The pastel fills make
 * categories read as their own colourful layer, clearly apart from the white
 * product cards below — this replaces the single-accent selected-fill of the
 * first Amendment 4 pass, which the user found too card-like. The selected tile
 * lifts to a white, shadowed card with a dark underline (reference parity).
 * Labels wrap freely (no `numberOfLines`) so long names never truncate; rows
 * stretch so same-row tiles stay equal height. Tap targets clear the HCI min.
 */
export function CategoryGrid({
  categories,
  selectedId,
  onSelect,
}: CategoryGridProps): React.JSX.Element {
  return (
    <View style={styles.grid}>
      {categories.map((category, index) => {
        const isSelected = category.id === selectedId;
        const pastel = categoryPastels[index % categoryPastels.length];
        return (
          <Pressable
            key={category.id}
            style={[
              styles.tile,
              isSelected ? styles.tileSelected : { backgroundColor: pastel },
            ]}
            onPress={() => onSelect(category.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={category.name}
          >
            <Text style={styles.label}>{category.name}</Text>
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
    // Same-row tiles stretch to the row height — equal look even when one label
    // wraps to two lines.
    alignItems: 'stretch',
  },
  tile: {
    // Fixed three-column width (equal tiles); labels wrap freely inside so long
    // names grow the tile instead of clipping. Chunky min-height for a
    // reference-like tap surface, well above the HCI touch minimum.
    width: '31.5%',
    minHeight: 64,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileSelected: {
    // Selected = white raised card + dark underline (reference), so it reads as
    // "active" against the flat pastels.
    backgroundColor: colors.background,
    borderBottomWidth: 3,
    borderBottomColor: colors.slate,
    ...shadow,
  },
  label: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
