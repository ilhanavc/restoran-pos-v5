import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTables } from '../features/tables/queries';
import type { RootStackParamList } from '../navigation/types';
import { colors, minTouchTarget, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Order'>;

/**
 * Order screen placeholder (ADR-026 K2).
 *
 * PR-5b ships only the shell: a dark-slate header (back chevron + the table's
 * region-local name) over a "coming soon" body. Its purpose is to prove the
 * Masalar -> Order -> back navigation loop on a phone. The real catalog + cart
 * (and the cart bottom-sheet) land in PR-5c. The table name is derived from the
 * cached `useTables` data so the header matches the card the waiter tapped; if
 * the cache is cold we fall back to the raw table code.
 */
export function OrderScreen({ route, navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { tableId } = route.params;

  const tablesQuery = useTables();
  // Region-local ordinal label, matching the tapped card. The card grid already
  // sorts within an area; recompute the same ordinal for this table's region.
  const tables = tablesQuery.data ?? [];
  const table = tables.find((tbl) => tbl.id === tableId) ?? null;
  let title = table?.code ?? '';
  if (table !== null && table.area_id !== null) {
    const peers = tables
      .filter((tbl) => tbl.area_id === table.area_id)
      .sort((a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true }));
    const idx = peers.findIndex((tbl) => tbl.id === table.id);
    if (idx !== -1) {
      title = t('tables.tableLabel', { number: idx + 1 });
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('order.header.back')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.slateText} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.body}>
        <Text style={styles.comingSoon}>{t('order.comingSoon')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.slate,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.slateText,
    fontSize: 18,
    fontWeight: '700',
  },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  comingSoon: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
