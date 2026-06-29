import type { Category } from '@restoran-pos/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../../../theme';

interface CategoryGridProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
}

/**
 * Colour category grid (ADR-026 K2/K3).
 *
 * Three-column tiles tinted with each category's own `category.color` (not a
 * fixed palette — v5 data). The selected tile inverts to a white face with a
 * coloured underline + coloured label, so the active category reads at a glance
 * during rush hour. Tap targets clear the HCI minimum height.
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
            style={[
              styles.tile,
              isSelected
                ? { backgroundColor: colors.background, borderColor: category.color }
                : { backgroundColor: category.color, borderColor: category.color },
            ]}
            onPress={() => onSelect(category.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={category.name}
          >
            <Text
              style={[
                styles.label,
                { color: isSelected ? category.color : colors.slateText },
              ]}
              numberOfLines={2}
            >
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
    justifyContent: 'space-between',
  },
  tile: {
    width: '31.5%',
    minHeight: 52,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    // Selected tiles use a thick bottom border as the "underline"; others keep
    // a uniform border so the box size never shifts on selection.
    borderWidth: 1.5,
    borderBottomWidth: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
