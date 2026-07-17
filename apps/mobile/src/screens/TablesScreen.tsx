import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  UNASSIGNED_AREA,
  groupOccupiedTotal,
  selectVisibleTables,
  tableDisplayNo,
} from '@restoran-pos/shared-domain';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
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
import {
  TableActionsController,
  type TableActionTarget,
} from '../features/payments/TableActionsController';
import { TableCard } from '../features/tables/TableCard';
import { useAreas, useTables } from '../features/tables/queries';
import type { RootStackParamList } from '../navigation/types';
import { useSocketStatus } from '../realtime/useSocketStatus';
import { useAuthStore } from '../store/auth';
import { colors, minTouchTarget, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Tables'>;

const NUM_COLUMNS = 3;

/**
 * Masalar (table board) screen (ADR-026 K2/K3/K6).
 *
 * Dark-slate header with the screen title, a live connection-status dot
 * (ADR-026 Amd2 K1 — real socket status: green/amber/red), a refresh action
 * and logout. Horizontal region
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
  const queryClient = useQueryClient();
  // ADR-026 Amd2 K1 — header'daki kalıcı bağlantı-durumu noktası.
  const socketStatus = useSocketStatus();

  const areas = useMemo(() => areasQuery.data ?? [], [areasQuery.data]);
  const allTables = useMemo(
    () => tablesQuery.data ?? [],
    [tablesQuery.data],
  );

  // ADR-009 Amendment 2026-06-30 Karar D — bölgesiz (orphan) masa sayısı.
  // >0 ise gerçek bölgelerden SONRA bir "Bölgesiz" sözde-grup tab'ı gösterilir;
  // occupied orphan (kurtarılan açık adisyon) garsona MUTLAKA görünür olmalı ki
  // masaya girip servis edebilsin. Web ile aynı sentinel (tek kaynak).
  const orphanCount = useMemo(
    () => allTables.filter((tbl) => tbl.area_id === null).length,
    [allTables],
  );

  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  // Dolu masa 3-nokta menüsü hedefi (ADR-027 K4); null = kapalı.
  const [actionTarget, setActionTarget] = useState<TableActionTarget | null>(
    null,
  );
  // First region auto-selected until the waiter taps another (derived, not
  // stored, so it settles as soon as `areas` loads). No "all tables" tab (K2);
  // if there are no real areas but orphans exist, the "Bölgesiz" group is active.
  const effectiveAreaId =
    activeAreaId ??
    areas[0]?.id ??
    (orphanCount > 0 ? UNASSIGNED_AREA : null);

  // Region + "Bölgesiz" badge counts via shared groupOccupiedTotal (Karar D) →
  // web + mobil (dolu/toplam) matematiği birebir aynı.
  const areaCounts = useMemo(() => {
    const map = new Map<string, { occupied: number; total: number }>();
    for (const area of areas) {
      map.set(area.id, groupOccupiedTotal(allTables, area.id));
    }
    map.set(UNASSIGNED_AREA, groupOccupiedTotal(allTables, UNASSIGNED_AREA));
    return map;
  }, [areas, allTables]);

  // Karar D: filtre + sıralama TEK kaynaktan (selectVisibleTables) — dolu masa
  // önce, sonra display_no artan (null orphan en sona), sonra code doğal-sayı.
  // "Bölgesiz" seçiliyse area_id=null orphan masalar döner (web paritesi).
  const sortedTables = useMemo(() => {
    if (effectiveAreaId === null) {
      return [];
    }
    return selectVisibleTables(allTables, effectiveAreaId);
  }, [allTables, effectiveAreaId]);

  // ADR-009 Amendment 2026-06-30 Karar A: pozisyonel ordinal yerine KALICI
  // per-bölge display_no (silme/sync ile kaymaz, fiziksel masayla eşleşir).
  // Bölgesiz orphan (null) → ham code. Web board + fiş + KDS ile birebir aynı.
  const tableLabels = useMemo(() => {
    const map = new Map<string, string>();
    sortedTables.forEach((tbl) => {
      const n = tableDisplayNo(tbl);
      map.set(tbl.id, n !== null ? t('tables.tableLabel', { number: n }) : tbl.code);
    });
    return map;
  }, [sortedTables, t]);

  // ADR-026 Amendment 1 K2 — the pull-to-refresh spinner tracks a LOCAL pull
  // state, not the queries' global `isRefetching`: background refetches (socket
  // invalidate, focus resync, 45 s safety-net poll) must update the board
  // silently. Binding `refreshing` to `isRefetching` dragged the iOS spinner
  // down on every background refetch and left it lingering after order-save
  // (stacked refetches toggling it on/off).
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);

  const handleRefresh = async (): Promise<void> => {
    setIsPullRefreshing(true);
    try {
      await Promise.all([tablesQuery.refetch(), areasQuery.refetch()]);
    } finally {
      setIsPullRefreshing(false);
    }
  };

  const renderCard = ({ item }: { item: ApiTable }): React.JSX.Element => (
    <View style={styles.cell}>
      <TableCard
        table={item}
        displayName={tableLabels.get(item.id) ?? item.code}
        onPress={() => navigation.navigate('Order', { tableId: item.id })}
        // Kebab yalnız aktif siparişi olan (dolu) masada; ödenecek/bastırılacak
        // sipariş yoksa 3-nokta yok (ADR-027 K4 + actions.visibleTableActions).
        onActionPress={
          item.active_order_id !== null
            ? () =>
                setActionTarget({
                  orderId: item.active_order_id as string,
                  tableLabel: tableLabels.get(item.id) ?? item.code,
                  tableId: item.id,
                })
            : undefined
        }
      />
    </View>
  );

  const isLoading = tablesQuery.isPending || areasQuery.isPending;
  // ADR-026 Amendment 1 (hci-gate bulgusu) — yalnız İLK yükleme hatası tam-ekran
  // hataya düşer (`isLoadingError`: cache boş, gösterilecek şey yok). Arka-plan
  // refetch hatası (socket/focus/45sn-poll; ör. kısa Wi-Fi blip'i) cache'li
  // board'u SİLMEZ — kartlar bayat veriyle kalır, bir sonraki başarılı
  // refetch kendini düzeltir. (`isError` global'i refetch hatasında da true
  // olur → rush-hour'da board'u tam-ekran hatayla değiştiriyordu.)
  const isError = tablesQuery.isLoadingError || areasQuery.isLoadingError;

  // ADR-026 Amd2 K2 — soğuk başlangıç 10 sn'i geçerse erken "Tekrar Dene"
  // görünür; buton askıdaki ilk fetch'i cancelQueries ile kesip ANINDA yeni
  // deneme başlatır (iptal edilmezse refetch dedupe olur, 15 sn REST
  // timeout'unun dolması beklenirdi — timeout/retry ayarına dokunulmaz).
  const [showSlowLoadRetry, setShowSlowLoadRetry] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setShowSlowLoadRetry(false);
      return;
    }
    const timer = setTimeout(() => setShowSlowLoadRetry(true), 10_000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const handleColdRetry = async (): Promise<void> => {
    await queryClient.cancelQueries({ queryKey: ['tables'] });
    await queryClient.cancelQueries({ queryKey: ['areas'] });
    void tablesQuery.refetch();
    void areasQuery.refetch();
  };

  // ADR-026 Amd2 K1 — durum → etiket/renk (dinamik i18n-key kullanılmaz;
  // i18n-key tarayıcısı literal key ister).
  const connectionLabel =
    socketStatus === 'connected'
      ? t('tables.connection.connected')
      : socketStatus === 'connecting'
        ? t('tables.connection.connecting')
        : t('tables.connection.offline');
  const connectionColor =
    socketStatus === 'connected'
      ? colors.syncOnline
      : socketStatus === 'connecting'
        ? colors.syncConnecting
        : colors.syncOffline;

  // ADR-026 Amd2 (hci-gate) — ekran-okuyucuya YALNIZ kritik geçişte
  // ('disconnected') duyuru (OfflineBanner'ın alert paterniyle tutarlı);
  // her durum değişiminde konuşup dikkat dağıtmaz.
  useEffect(() => {
    if (socketStatus === 'disconnected') {
      AccessibilityInfo.announceForAccessibility(connectionLabel);
    }
  }, [socketStatus, connectionLabel]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.headerTitle}>{t('tables.title')}</Text>
          {/* ADR-026 Amd2 K1 — kalıcı bağlantı-durumu noktası; bağlıyken
              YALNIZ nokta (rush-hour minimalizm), değilken kısa etiket. */}
          <View
            style={styles.connWrap}
            accessible
            accessibilityLabel={connectionLabel}
          >
            <View
              style={[styles.connDot, { backgroundColor: connectionColor }]}
            />
            {socketStatus !== 'connected' ? (
              <Text style={styles.connLabel} numberOfLines={1}>
                {connectionLabel}
              </Text>
            ) : null}
          </View>
        </View>
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

      {areas.length > 0 || orphanCount > 0 ? (
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
                    {/* Karar D: (dolu/toplam) — web tab'ı ile birebir aynı format. */}
                    {`${area.name} (${counts.occupied}/${counts.total})`}
                  </Text>
                </Pressable>
              );
            })}

            {/* Karar D: "Bölgesiz" sözde-grup tab'ı — gerçek bölgelerden SONRA,
                yalnız ≥1 orphan varsa. Seçilince occupied orphan'lar (kurtarılan
                açık adisyon) görünür → garson masaya girip servis edebilir. */}
            {orphanCount > 0 ? (
              (() => {
                const isActive = effectiveAreaId === UNASSIGNED_AREA;
                const counts =
                  areaCounts.get(UNASSIGNED_AREA) ?? { occupied: 0, total: 0 };
                return (
                  <Pressable
                    style={[styles.pill, isActive && styles.pillActive]}
                    onPress={() => setActiveAreaId(UNASSIGNED_AREA)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        isActive && styles.pillTextActive,
                      ]}
                    >
                      {`${t('tables.group.unassigned')} (${counts.occupied}/${counts.total})`}
                    </Text>
                  </Pressable>
                );
              })()
            ) : null}
          </ScrollView>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.slate} />
          {/* ADR-026 Amd2 K2 — çıplak çark yerine durum metni; 10 sn geçerse
              erken Tekrar Dene (askıdaki fetch cancel+refetch ile kesilir). */}
          <Text style={styles.loadingText}>
            {t('tables.loading.connectingToServer')}
          </Text>
          {showSlowLoadRetry ? (
            <Pressable
              style={styles.retryButton}
              onPress={() => {
                void handleColdRetry();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
            >
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </Pressable>
          ) : null}
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
              refreshing={isPullRefreshing}
              onRefresh={() => {
                void handleRefresh();
              }}
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

      <TableActionsController
        target={actionTarget}
        onClose={() => setActionTarget(null)}
        onPaid={() => {
          // Masa kapandı; tahta query invalidation ile canlı tazelenir (Toast onaylar).
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    // Light-grey body so the white table cards + their soft shadows read clearly
    // (reference parity). The header (slate) and pills (surface) set their own.
    backgroundColor: colors.surface,
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
  // ADR-026 Amd2 K1 — başlık + bağlantı-durumu noktası aynı satırda.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  connWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  connDot: {
    // hci-gate: 12pt — dokunma hedefi değil (Fitts kapsamı dışı), tablet
    // mesafesinden okunabilirlik için 10pt'ten büyütüldü.
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  connLabel: {
    color: colors.slateText,
    fontSize: 13,
    opacity: 0.9,
  },
  // ADR-026 Amd2 K2 — soğuk-başlangıç durum metni (çıplak çark yasağı).
  loadingText: {
    marginTop: spacing.md,
    color: colors.textSecondary,
    fontSize: 15,
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
