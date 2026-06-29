import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ApiTable } from '../api/tables';
import { TableCard } from '../features/tables/TableCard';
import { useAreas, useTables } from '../features/tables/queries';
import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/auth';
import { colors, minTouchTarget, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Tables'>;

const NUM_COLUMNS = 3;

/**
 * Masalar (table board) screen (ADR-026 K2/K3/K6).
 *
 * Dark-slate header with the screen title, a static live-connection indicator
 * (real socket lands in PR-5d), a refresh action and logout. Horizontal region
 * pills ("Salon (N)" / "Bahçe (N)", first region auto-selected, no "Tümü" tab)
 * filter a 3-column grid of square cards. Tapping any card — empty or occupied
 * — opens the order screen for that table (web parity). Pull-to-refresh drives a
 * query refetch.
 *
 * Per K6 the waiter never sees gated affordances (Caller-ID headset, +New
 * region, payment, 3-dot menu); they are simply not rendered. All user-visible
 * text goes through `t()`.
 */
export function TablesScreen({ navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const logout = useAuthStore((state) => state.logout);

  const tablesQuery = useTables();
  const areasQuery = useAreas();

  const areas = useMemo(() => areasQuery.data ?? [], [areasQuery.data]);
  const allTables = useMemo(
    () => tablesQuery.data ?? [],
    [tablesQuery.data],
  );

  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  // First region auto-selected until the waiter taps another (derived, not
  // stored, so it settles as soon as `areas` loads). No "all tables" tab (K2).
  const effectiveAreaId = activeAreaId ?? areas[0]?.id ?? null;

  // Region-local ordinal labels ("Masa 1"...) + occupied/total badge counts.
  const areaCounts = useMemo(() => {
    const map = new Map<string, { occupied: number; total: number }>();
    for (const area of areas) {
      const inArea = allTables.filter((tbl) => tbl.area_id === area.id);
      const occupied = inArea.filter(
        (tbl) => tbl.status === 'occupied',
      ).length;
      map.set(area.id, { occupied, total: inArea.length });
    }
    return map;
  }, [areas, allTables]);

  const sortedTables = useMemo(() => {
    if (effectiveAreaId === null) {
      return [];
    }
    return allTables
      .filter((tbl) => tbl.area_id === effectiveAreaId)
      .sort((a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true }));
  }, [allTables, effectiveAreaId]);

  const tableLabels = useMemo(() => {
    const map = new Map<string, string>();
    sortedTables.forEach((tbl, idx) => {
      map.set(tbl.id, t('tables.tableLabel', { number: idx + 1 }));
    });
    return map;
  }, [sortedTables, t]);

  const isRefreshing =
    tablesQuery.isRefetching || areasQuery.isRefetching;

  const handleRefresh = (): void => {
    void tablesQuery.refetch();
    void areasQuery.refetch();
  };

  const renderCard = ({ item }: { item: ApiTable }): React.JSX.Element => (
    <View style={styles.cell}>
      <TableCard
        table={item}
        displayName={tableLabels.get(item.id) ?? item.code}
        onPress={() => navigation.navigate('Order', { tableId: item.id })}
      />
    </View>
  );

  const isLoading = tablesQuery.isPending || areasQuery.isPending;
  const isError = tablesQuery.isError || areasQuery.isError;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('tables.title')}</Text>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.iconButton}
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel={t('settings.title')}
          >
            <Ionicons name="settings-outline" size={22} color={colors.slateText} />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={handleRefresh}
            accessibilityRole="button"
            accessibilityLabel={t('tables.refresh')}
          >
            <Ionicons name="refresh" size={22} color={colors.slateText} />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => {
              void logout();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('tables.logoutAriaLabel')}
          >
            <Ionicons
              name="log-out-outline"
              size={24}
              color={colors.slateText}
            />
          </Pressable>
        </View>
      </View>

      {areas.length > 0 ? (
        <View style={styles.pillsWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pills}
          >
            {areas.map((area) => {
              const isActive = effectiveAreaId === area.id;
              const counts =
                areaCounts.get(area.id) ?? { occupied: 0, total: 0 };
              return (
                <Pressable
                  key={area.id}
                  style={[styles.pill, isActive && styles.pillActive]}
                  onPress={() => setActiveAreaId(area.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <Text
                    style={[
                      styles.pillText,
                      isActive && styles.pillTextActive,
                    ]}
                  >
                    {`${area.name} (${counts.occupied})`}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.slate} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{t('tables.error')}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={handleRefresh}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
          >
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sortedTables}
          keyExtractor={(item) => item.id}
          numColumns={NUM_COLUMNS}
          renderItem={renderCard}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.slate}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>
                {t('tables.empty.noTablesInArea')}
              </Text>
            </View>
          }
        />
      )}
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    color: colors.slateText,
    fontSize: 20,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillsWrapper: {
    backgroundColor: colors.surface,
  },
  pills: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  pill: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.slate,
    borderColor: colors.slate,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.slateText,
  },
  grid: {
    padding: spacing.md,
    flexGrow: 1,
  },
  row: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cell: {
    flex: 1 / NUM_COLUMNS,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: colors.danger,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: colors.slateText,
    fontSize: 16,
    fontWeight: '700',
  },
});
