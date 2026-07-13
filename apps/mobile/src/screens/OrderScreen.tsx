import { Ionicons } from '@expo/vector-icons';
import { formatMoney, tableDisplayNo } from '@restoran-pos/shared-domain';
import type { ProductWithVariants } from '@restoran-pos/shared-types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { addOrderItems, createOrder } from '../api/client';
import type { OrderItemInput } from '../api/orders';
import { genIdempotencyKey } from '../api/uuid';
import { useTables } from '../features/tables/queries';
import { useCart } from '../features/orders/cart';
import { CategoryGrid } from '../features/orders/components/CategoryGrid';
import { ProductCard } from '../features/orders/components/ProductCard';
import { AdisyonSheet } from '../features/orders/components/AdisyonSheet';
import {
  useActiveOrderForTable,
  useMenuCategories,
  useMenuProducts,
} from '../features/orders/queries';
import {
  TableActionsController,
  type TableActionTarget,
} from '../features/payments/TableActionsController';
import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../store/auth';
import { useSettingsStore } from '../store/settings';
import { colors, minTouchTarget, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Order'>;

const H_PADDING = spacing.md;
// A tight inter-card gap keeps the cards as wide as possible so the name fits
// beside the right-rail stepper. The column count is a user preference (ADR-026
// Amendment 2026-06-29 C): 2 = roomy, 3 = dense.
const GAP = spacing.xs;

/**
 * Sipariş (Order) screen — catalog + cart (ADR-026 K2/K3/K4/K6/K7).
 *
 * Dark-slate header [back · table · cart icon+badge] over a fixed search box and
 * a colour category grid, then a 3-column product catalog. Tapping a product
 * adds its default variant straight to the local cart (no modal — ADR-013 §10.1).
 * The cart icon opens the Adisyon bottom-sheet (saved items read-only + pending
 * additions with steppers). A persistent dark "Kaydet" bar appears while the
 * cart is dirty; saving persists + auto-sends to the kitchen (K7) — mocked here,
 * real transport in PR-5d. Leaving with a dirty cart prompts a confirm (K4).
 * No payment / cancel / comp / transfer / print affordances are rendered (K6).
 */
export function OrderScreen({ route, navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { tableId } = route.params;

  const tablesQuery = useTables();
  const categoriesQuery = useMenuCategories();
  const productsQuery = useMenuProducts();
  const activeOrderQuery = useActiveOrderForTable(tableId);
  const cart = useCart();
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);

  // Column count is a user preference (ADR-026 Amendment C); card width follows
  // the live window width so it stays correct on rotation / different devices.
  const numColumns = useSettingsStore((state) => state.productColumns);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.floor(
    (windowWidth - H_PADDING * 2 - GAP * (numColumns - 1)) / numColumns,
  );

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  // Masa 3-nokta menüsü hedefi (ADR-027 K4); null = kapalı.
  const [actionTarget, setActionTarget] = useState<TableActionTarget | null>(
    null,
  );

  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );
  const products = useMemo(
    () => productsQuery.data ?? [],
    [productsQuery.data],
  );

  // Default to the first category once the menu loads (web parity: first tab).
  useEffect(() => {
    const first = categories[0];
    if (selectedCategoryId === null && first !== undefined) {
      setSelectedCategoryId(first.id);
    }
  }, [categories, selectedCategoryId]);

  // Kalıcı per-bölge display_no etiketi (ADR-009 Amendment 2026-06-30 Karar A),
  // tıklanan masa kartı + web board + fiş + KDS ile birebir aynı. Bölgesiz
  // orphan (null) → ham code. Eski pozisyonel ordinal drift'i giderildi.
  const table = useMemo(
    () => (tablesQuery.data ?? []).find((tbl) => tbl.id === tableId) ?? null,
    [tablesQuery.data, tableId],
  );
  const tableLabel = useMemo(() => {
    if (table === null) {
      return '';
    }
    const n = tableDisplayNo(table);
    return n !== null ? t('tables.tableLabel', { number: n }) : table.code;
  }, [table, t]);

  // Silinen-masa guard (web OrderScreenPage paritesi): masa listesi yüklendikten
  // SONRA hedef masa yoksa (navigasyon ile render arası admin masayı sildi),
  // sipariş ekranı boş/çökük görünmesin — Türkçe "Masa bulunamadı" + Masalara
  // dön. Liste henüz yüklenirken (isPending) beklenir, erken tetiklenmez.
  const tableMissing = tablesQuery.isSuccess && table === null;

  // Search across all products when a query is typed; otherwise the selected
  // category (ADR-026 K2). Turkish-aware case folding.
  const visibleProducts = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('tr');
    if (query.length > 0) {
      return products.filter((p) =>
        p.name.toLocaleLowerCase('tr').includes(query),
      );
    }
    return products.filter((p) => p.categoryId === selectedCategoryId);
  }, [products, searchQuery, selectedCategoryId]);

  const activeOrder = activeOrderQuery.data ?? null;
  const existingItems = activeOrder?.items ?? [];
  const existingTotalCents = activeOrder?.total_cents ?? 0;

  // ADR-013 Amendment 1 K9 — attempt-sabit idempotency key (QuickPaySheet
  // paterni). İlk Kaydet denemesinde üretilir; Alert "Tekrar Dene" retry'ı AYNI
  // key'i kullanır (ref null'a düşene kadar) → sunucu tek sipariş / tek batch
  // garantiler. Başarıda null'a çekilir (sonraki batch için taze key).
  const saveKeyRef = useRef<string | null>(null);

  async function handleSave(): Promise<void> {
    // Kaydet (K7): persist the pending cart, then refresh the board and return
    // to Masalar silently — no success popup (owner: the board update is the
    // confirmation). New table → POST /orders; already-open table → add items.
    // The backend auto-sends to the kitchen on save (no separate action).
    if (saving || cart.lines.length === 0) {
      return;
    }
    const items: OrderItemInput[] = cart.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      ...(line.variantId !== null ? { variantId: line.variantId } : {}),
    }));
    setSaving(true);
    // ADR-013 Amd1 K9 — key ilk denemede üretilir; retry aynı key'i taşır.
    if (saveKeyRef.current === null) {
      saveKeyRef.current = genIdempotencyKey();
    }
    const saveKey = saveKeyRef.current;
    try {
      const activeOrder = activeOrderQuery.data ?? null;
      const saved =
        activeOrder !== null
          ? await addOrderItems(activeOrder.id, items, saveKey)
          : await createOrder({ tableId, orderType: 'dine_in', items }, saveKey);
      // ADR-013 Amd1 K9 — otoriter yanıtı (replay dahil) active-order cache'ine
      // yaz: bayat-cache + "hangi siparişteyim" belirsizliğini kapatır (Blok 10).
      queryClient.setQueryData(['orders', 'by-table', tableId, 'active'], saved);
      saveKeyRef.current = null; // başarı → sonraki batch için taze key
      cart.clear();
      // Refetch the board + this table's open order; the realtime orders.created
      // event also invalidates ['tables'], so the masa card fills either way.
      await queryClient.invalidateQueries({ queryKey: ['tables'] });
      await queryClient.invalidateQueries({
        queryKey: ['orders', 'by-table', tableId, 'active'],
      });
      setSheetVisible(false);
      navigation.goBack();
    } catch {
      // No PII in the message; the cart is preserved so the waiter can retry
      // straight from the alert (HCI: one-tap recovery during rush hour).
      Alert.alert(t('order.save.errorTitle'), t('order.save.error'), [
        { text: t('common.close'), style: 'cancel' },
        {
          text: t('common.retry'),
          onPress: () => {
            void handleSave();
          },
        },
      ]);
    } finally {
      setSaving(false);
    }
  }

  const isLoading = categoriesQuery.isLoading || productsQuery.isLoading;
  const isError = categoriesQuery.isError || productsQuery.isError;

  // Silinen-masa guard (web paritesi) — TÜM hook'lardan SONRA erken return
  // (hook sırası sabit kalır). Boş/çökük ekran yerine anlaşılır Türkçe mesaj +
  // tek dokunuşla Masalara dönüş.
  if (tableMissing) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
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
            {t('order.errors.tableNotFound')}
          </Text>
          <View style={styles.iconButton} />
        </View>
        <View style={styles.centerBox}>
          <Text style={styles.centerText}>
            {t('order.errors.tableNotFound')}
          </Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel={t('order.errors.backToTables')}
          >
            <Ionicons
              name="arrow-back"
              size={18}
              color={colors.slateText}
            />
            <Text style={styles.retryText}>
              {t('order.errors.backToTables')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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
          {tableLabel}
        </Text>
        <View style={styles.headerRight}>
          {/* 3-nokta operasyonel menü — yalnız aktif sipariş varsa (ADR-027 K4:
              garson masaya gitmeden ödeme/baskı yapabilir). */}
          {activeOrder !== null ? (
            <Pressable
              style={styles.iconButton}
              onPress={() =>
                setActionTarget({ orderId: activeOrder.id, tableLabel, tableId })
              }
              accessibilityRole="button"
              accessibilityLabel={t('order.actions.open', { table: tableLabel })}
            >
              <Ionicons
                name="ellipsis-vertical"
                size={22}
                color={colors.slateText}
              />
            </Pressable>
          ) : null}
          <Pressable
            style={styles.iconButton}
            onPress={() => setSheetVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t('order.header.cartLabel', {
              count: cart.totalQuantity,
            })}
          >
            <Ionicons name="receipt-outline" size={24} color={colors.slateText} />
            {cart.totalQuantity > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{cart.totalQuantity}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.controls}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('order.header.searchPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        {searchQuery.trim().length === 0 ? (
          <CategoryGrid
            categories={categories}
            selectedId={selectedCategoryId}
            onSelect={setSelectedCategoryId}
          />
        ) : null}
      </View>

      {isError ? (
        <View style={styles.centerBox}>
          <Text style={styles.centerText}>{t('order.catalog.error')}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => {
              void categoriesQuery.refetch();
              void productsQuery.refetch();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
          >
            <Ionicons name="refresh" size={18} color={colors.slateText} />
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : isLoading ? (
        <View style={styles.centerBox}>
          <Text style={styles.centerText}>{t('common.loading')}</Text>
        </View>
      ) : (
        <FlatList<ProductWithVariants>
          // Remount when the column count changes — FlatList cannot switch
          // numColumns in place.
          key={`cols-${numColumns}`}
          data={visibleProducts}
          keyExtractor={(item) => item.id}
          numColumns={numColumns}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              quantity={cart.pendingQtyByProductId.get(item.id) ?? 0}
              width={cardWidth}
              onAdd={() => cart.addProduct(item)}
              onDecrement={() => cart.decrementProduct(item)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <Text style={styles.centerText}>
                {searchQuery.trim().length > 0
                  ? t('order.catalog.noSearchResults')
                  : t('order.catalog.empty')}
              </Text>
            </View>
          }
        />
      )}

      {cart.isDirty ? (
        <Pressable
          // Pad the bar past the phone's bottom inset (gesture bar) so the
          // slate fills edge-to-edge but the label sits above it.
          style={[
            styles.saveBar,
            { paddingBottom: spacing.md + insets.bottom },
            saving && styles.saveBarDisabled,
          ]}
          onPress={() => {
            void handleSave();
          }}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          accessibilityLabel={t('order.bar.save')}
        >
          <Text style={styles.saveSummary} numberOfLines={1}>
            {t('order.bar.summary', {
              count: cart.totalQuantity,
              total: formatMoney(cart.subtotalCents),
            })}
          </Text>
          <View style={styles.saveAction}>
            {saving ? (
              <>
                <ActivityIndicator color={colors.slateText} />
                <Text style={styles.saveText}>{t('order.bar.saving')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.saveText}>{t('order.bar.save')}</Text>
                <Ionicons name="checkmark" size={20} color={colors.slateText} />
              </>
            )}
          </View>
        </Pressable>
      ) : null}

      <AdisyonSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        tableLabel={tableLabel}
        existingItems={existingItems}
        existingTotalCents={existingTotalCents}
        currentUserId={currentUserId}
        cartLines={cart.lines}
        pendingSubtotalCents={cart.subtotalCents}
        onIncrement={cart.increment}
        onDecrement={cart.decrement}
        onRemove={cart.remove}
      />

      <TableActionsController
        target={actionTarget}
        onClose={() => setActionTarget(null)}
        onPaid={() => navigation.goBack()}
      />
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.slateText,
    fontSize: 11,
    fontWeight: '700',
  },
  controls: {
    paddingHorizontal: H_PADDING,
    paddingTop: spacing.sm,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 44,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  centerText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.slate,
  },
  retryText: {
    color: colors.slateText,
    fontSize: 15,
    fontWeight: '700',
  },
  columnWrapper: {
    gap: GAP,
    paddingHorizontal: H_PADDING,
  },
  listContent: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
    gap: GAP,
  },
  saveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.slate,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  saveBarDisabled: {
    opacity: 0.7,
  },
  saveSummary: {
    flex: 1,
    color: colors.slateText,
    fontSize: 15,
    fontWeight: '600',
  },
  saveAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  saveText: {
    color: colors.slateText,
    fontSize: 17,
    fontWeight: '800',
  },
});
