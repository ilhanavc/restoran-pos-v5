import { Ionicons } from '@expo/vector-icons';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
} from '@react-navigation/native';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatElapsed } from '../features/tables/elapsed';
import {
  groupIntoBatches,
  type KitchenBatch,
} from '../features/kitchen/batches';
import { KDS_ORDERS_KEY, useKdsOrders } from '../features/kitchen/queries';
import type { MainTabScreenProps } from '../navigation/types';
import { useCanCreateTakeaway } from '../store/permissions';
import {
  buttonHeight,
  colors,
  minTouchTarget,
  radius,
  shadow,
  spacing,
  typography,
} from '../theme';

/**
 * Mutfak ekranı (ADR-026 Amendment 5 K7 + **Amendment 6**).
 *
 * **Salt-okunur** kuyruk: masa **ve** paket açık siparişlerin mutfağa giden
 * (kitchen_print) kalemleri, EN YENİ ÜSTTE (K7 revizyonu, ürün sahibi
 * 2026-07-27) — paket dahil tek kronolojik düzen. Sunucu FIFO (`created_at
 * ASC`) gönderir; web KDS kontratı (ADR-020 K4) değişmesin diye ters çevirme
 * İSTEMCİDE yapılır.
 *
 * **Kartın birimi bir SİPARİŞ değil, bir GÖNDERİMdir** (Amd6 K1; Amd5 K7'nin
 * "ilave mevcut kartın içine işlenir" sınırı KAPATILDI). Bir masaya ilave
 * girildiğinde kuyrukta AYRI bir kart açılır ve en üste girer; ilk gönderimin
 * kalemleri o kartta TEKRAR ETMEZ (K3). Bölme/sıralama kararı saf fonksiyonda
 * (`features/kitchen/batches.ts`), bu bileşen ikinci bir koşul taşımaz.
 * Geçen süre GÖNDERİMİN yaşıdır, adisyonun değil (K5).
 *
 * **KART seviyesinde aksiyon YOKTUR** (Amd5 K7 aynen yürürlükte): durum
 * butonu, dokunma, kaydırma aksiyonu render edilmez. Yazma ucu
 * (`PATCH /orders/:o/items/:i/status`) garsona/kasiyere kapalıdır ve bu ekran
 * onu çağırmaz. Restoranda aşçı KDS durumu güncellemiyor; garsonun ihtiyacı
 * "hangi sipariş sırada" sorusunun cevabı.
 *
 * **EKRAN seviyesinde tek aksiyon vardır: "Paket Sipariş" FAB'ı**
 * (ADR-039 K5.0.3 — Amd5 K7'nin kısmi ve DAR reversal'ı). FAB mevcut
 * siparişlerin durumunu değiştirmez, YENİ bir sipariş yaratır; Amd5 K7'nin
 * koruduğu değere ("garson yanlışlıkla kalem durumu değiştirmesin")
 * dokunmaz. Bu ayrım bilinçlidir: "madem Mutfak artık aksiyon alıyor"
 * gerekçesiyle karta ikinci bir aksiyon SIZDIRILAMAZ (ADR-039 K12.11).
 *
 * FAB rol-koşulludur (K10.2): `admin`/`cashier`/`waiter` görür, `kitchen`
 * GÖRMEZ, rol bilinmezken (profil tazelenemedi) gizli kalır. Sekmenin kendisi
 * koşulsuz kayıtlı olduğu için (`MainTabs.tsx`) tek koruma hattı budur.
 *
 * Tazeleme: sekmeye dönünce refetch + aşağı çekince + yalnız odaklıyken 30 sn
 * poll (queries.ts).
 */
export function KitchenScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const ordersQuery = useKdsOrders(isFocused);
  const insets = useSafeAreaInsets();
  // ADR-039 K10.2/K10.4 — FAB'ın TEK koruma hattı. Sekme koşulsuz kayıtlı
  // olduğu için `kitchen` rolü bu ekranı görür; butonu görmemesi buradan
  // gelir. Rol `null` iken (profil tazelenemedi) da `false` döner.
  const canCreateTakeaway = useCanCreateTakeaway();
  // Sekme ekranı ama root stack'e (`Takeaway`) push eder → composite tip.
  const navigation =
    useNavigation<MainTabScreenProps<'Kitchen'>['navigation']>();

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

  // Amd6 K1/K4: gönderim bazlı kartlar, en yeni üstte. Bölme ve sıralama
  // tamamen saf fonksiyonda — ekran burada ikinci bir kural uygulamaz.
  const batches = useMemo(
    () => groupIntoBatches(ordersQuery.data ?? []),
    [ordersQuery.data],
  );

  const renderBatch = ({ item }: { item: KitchenBatch }): React.JSX.Element => {
    const isTakeaway = item.orderType === 'takeaway';
    const code = item.tableCodeSnapshot;
    const title = isTakeaway
      ? t('kitchen.takeaway')
      : code === null
        ? t('kitchen.tableUnknown')
        : item.areaNameSnapshot !== null
          ? t('kitchen.tableWithArea', { area: item.areaNameSnapshot, code })
          : t('kitchen.tableLabel', { code });

    // Amd6 K5 — GÖNDERİMİN yaşı. Eskiden siparişin yaşıydı: 40 dk önce açılmış
    // bir masaya az önce girilen ilave "40 dk bekliyor" görünürdü.
    const elapsedMs = Date.now() - new Date(item.batchAt).getTime();

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
            {/*
              Amd6 K6 — İLAVE rozeti. RENK-BAĞIMSIZ (ADR-020 K8 daltonik
              kuralı): ayırt ediciliği metin + kontur taşır, dolgu rengi değil.
            */}
            {item.isAddition ? (
              <View style={styles.additionBadge}>
                <Text style={styles.additionBadgeText}>
                  {t('kitchen.additionBadge')}
                </Text>
              </View>
            ) : null}
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
    // Amd5 hci-fix — üst inset App kabuğunda tüketilir, ekran taşımaz.
    <View style={styles.safe}>
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
          data={batches}
          // Amd6 K5 — sipariş id'si tek başına benzersiz DEĞİL (aynı adisyonun
          // birden çok gönderimi listede yan yana durur).
          keyExtractor={(batch) => batch.key}
          // Yeni-üstte düzende taze gönderim index-0'a girer (prepend); bu prop
          // okunan kartın ekran konumunu korur, liste aşağı "sıçramaz". Amd6 ile
          // kart sayısı arttığı için daha da kritik (K9).
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          renderItem={renderBatch}
          // K5.0.4 — FAB en alttaki kartın ÜSTÜNE binmesin: liste alt dolgusu
          // FAB yüksekliği + yerleşim boşluğu kadar artırılır. FAB yokken
          // (kitchen rolü / rol bilinmiyor) dolgu da eklenmez.
          contentContainerStyle={[
            styles.list,
            canCreateTakeaway && {
              paddingBottom: spacing.md + buttonHeight + spacing.lg,
            },
          ]}
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

      {/*
        ADR-039 K5.0 — "Paket Sipariş" FAB. Metinli + ikonlu (SALT-İKON DEĞİL,
        K10.6): sekme etiketi "Mutfak" kaldığı için keşfedilebilirliği taşıyan
        şey butonun kendi yazısıdır. Boş kuyrukta da görünür (K5.0.5) —
        "sipariş yokken paket açamıyorum" arızası doğmasın diye liste
        dallanmasının DIŞINDA render edilir.

        Alt konum: tab bar yüksekliği + alt güvenli alan hesaba katılır. Bu
        ekran sekme içindedir ve `edges` listesinde 'bottom' YOKTUR (Amd5 K10
        çift-boşluk tuzağı) → inset burada elle eklenir.
      */}
      {canCreateTakeaway ? (
        <Pressable
          style={({ pressed }) => [
            styles.fab,
            { bottom: spacing.md + insets.bottom },
            pressed && styles.fabPressed,
          ]}
          onPress={() => navigation.navigate('Takeaway')}
          accessibilityRole="button"
          accessibilityLabel={t('takeaway.createFab')}
        >
          <Ionicons name="bag-add" size={22} color={colors.slateText} />
          <Text style={styles.fabText}>{t('takeaway.createFab')}</Text>
        </Pressable>
      ) : null}
    </View>
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
  // Renk-bağımsız rozet: kontur + koyu metin (ADR-020 K8). Dolgu yok ki
  // gri tonlamada da kart başlığından ayrışsın.
  additionBadge: {
    borderWidth: 1,
    borderColor: colors.slate,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  additionBadgeText: {
    // hci-reviewer önerisi: yeni hazırlama-riski sinyali, göz taraması için sm→md
    fontSize: typography.fontSize.md,
    fontWeight: '800',
    color: colors.slate,
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
  // ADR-039 K5.0.4 — hedef >= minTouchTarget (52pt); yüzen, sağ altta.
  fab: {
    position: 'absolute',
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: buttonHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    ...shadow,
  },
  fabPressed: {
    opacity: 0.85,
  },
  fabText: {
    color: colors.slateText,
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
  },
});
