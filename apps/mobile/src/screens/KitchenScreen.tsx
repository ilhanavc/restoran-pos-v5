import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { KdsOrder } from '../api/schemas';
import { formatElapsed } from '../features/tables/elapsed';
import { KDS_ORDERS_KEY, useKdsOrders } from '../features/kitchen/queries';
import { colors, minTouchTarget, radius, spacing, typography } from '../theme';

/**
 * Mutfak ekranı (ADR-026 Amendment 5 K7).
 *
 * **Salt-okunur** kuyruk: masa **ve** paket açık siparişlerin mutfağa giden
 * (kitchen_print) kalemleri, EN ESKİ ÜSTTE. Sıralama sunucudan gelir
 * (`created_at ASC`) — istemci yeniden sıralamaz.
 *
 * Aksiyon YOKTUR: durum butonu, dokunma, kaydırma aksiyonu render edilmez.
 * Yazma ucu (`PATCH /orders/:o/items/:i/status`) garsona/kasiyere kapalıdır ve
 * bu ekran onu çağırmaz. Restoranda aşçı KDS durumu güncellemiyor; garsonun
 * ihtiyacı "hangi sipariş sırada" sorusunun cevabı.
 *
 * Tazeleme: sekmeye dönünce refetch + aşağı çekince + yalnız odaklıyken 30 sn
 * poll (queries.ts).
 */
export function KitchenScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const ordersQuery = useKdsOrders(isFocused);

  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: KDS_ORDERS_KEY });
    }, [queryClient]),
  );

  const elapsedLabels = useMemo(
    () => ({
      day: t('tables.elapsed.day'),
      hour: t('tables.elapsed.hour'),
      minute: t('tables.elapsed.minute'),
    }),
    [t],
  );

  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const handleRefresh = async (): Promise<void> => {
    setIsPullRefreshing(true);
    try {
      await ordersQuery.refetch();
    } finally {
      setIsPullRefreshing(false);
    }
  };

  const orders = ordersQuery.data ?? [];

  const renderOrder = ({ item }: { item: KdsOrder }): React.JSX.Element => {
    const isTakeaway = item.orderType === 'takeaway';
    const code = item.tableCodeSnapshot;
    const title = isTakeaway
      ? t('kitchen.takeaway')
      : code === null
        ? t('kitchen.tableUnknown')
        : item.areaNameSnapshot !== null
          ? t('kitchen.tableWithArea', { area: item.areaNameSnapshot, code })
          : t('kitchen.tableLabel', { code });

    const elapsedMs = Date.now() - new Date(item.createdAt).getTime();

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Ionicons
              name={isTakeaway ? 'bag-handle-outline' : 'restaurant-outline'}
              size={18}
              color={isTakeaway ? colors.accent : colors.slate}
            />
            <Text style={styles.cardTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.orderNo}>{`#${item.orderNo}`}</Text>
          </View>
          <Text style={styles.elapsed}>
            {formatElapsed(elapsedMs, elapsedLabels)}
          </Text>
        </View>

        {/* Paket siparişte müşteri adı garsonun teslimde zaten gördüğü alan. */}
        {isTakeaway && item.customerName !== null ? (
          <Text style={styles.customer} numberOfLines={1}>
            {item.customerName}
          </Text>
        ) : null}

        <View style={styles.items}>
          {item.items.map((line) => (
            <View key={line.id} style={styles.itemRow}>
              <Text style={styles.itemQty}>{`${line.quantity}×`}</Text>
              <View style={styles.itemTexts}>
                <Text style={styles.itemName}>
                  {line.variantNameSnapshot === null
                    ? line.productName
                    : `${line.productName} · ${line.variantNameSnapshot}`}
                </Text>
                {line.note !== null && line.note.length > 0 ? (
                  <Text style={styles.itemNote}>{line.note}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('kitchen.title')}</Text>
      </View>

      {ordersQuery.isPending ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.slate} />
          <Text style={styles.hintText}>{t('common.loading')}</Text>
        </View>
      ) : ordersQuery.isLoadingError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{t('kitchen.error')}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => {
              void handleRefresh();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
          >
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(order) => order.id}
          renderItem={renderOrder}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isPullRefreshing}
              onRefresh={() => {
                void handleRefresh();
              }}
              tintColor={colors.slate}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.hintText}>{t('kitchen.empty')}</Text>
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
    backgroundColor: colors.surface,
  },
  header: {
    backgroundColor: colors.slate,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    color: colors.slateText,
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
  },
  list: {
    padding: spacing.md,
    gap: spacing.sm,
    flexGrow: 1,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  cardTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  orderNo: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  elapsed: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  customer: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
  },
  items: {
    gap: spacing.xs,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  itemQty: {
    fontSize: typography.fontSize.md,
    fontWeight: '800',
    color: colors.textPrimary,
    minWidth: 32,
    fontVariant: ['tabular-nums'],
  },
  itemTexts: {
    flex: 1,
  },
  itemName: {
    fontSize: typography.fontSize.md,
    color: colors.textPrimary,
  },
  itemNote: {
    fontSize: typography.fontSize.sm,
    color: colors.occupiedText,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  hintText: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    fontSize: typography.fontSize.md,
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
    fontSize: typography.fontSize.md,
    fontWeight: '700',
  },
});
