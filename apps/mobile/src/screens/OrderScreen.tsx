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
import type { OrderItemInput, ApiOrderItem } from '../api/orders';
import { genIdempotencyKey } from '../api/uuid';
import { useTables } from '../features/tables/queries';
import { useCart, type CartLine } from '../features/orders/cart';
import { CategoryGrid } from '../features/orders/components/CategoryGrid';
import { ProductCard } from '../features/orders/components/ProductCard';
import { AdisyonSheet } from '../features/orders/components/AdisyonSheet';
import { LineDetailSheet } from '../features/orders/components/LineDetailSheet';
import { SavedItemSheet } from '../features/orders/components/SavedItemSheet';
import { updateOrderItem, type OrderItemPatch } from '../api/client';
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
import {
  buttonHeight,
  colors,
  minTouchTarget,
  radius,
  shadow,
  spacing,
  typography,
} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Order'>;

const H_PADDING = spacing.md;
// A tight inter-card gap keeps the cards as wide as possible so the name fits
// beside the right-rail stepper. The column count is a user preference (ADR-026
// Amendment 2026-06-29 C): 2 = roomy, 3 = dense.
const GAP = spacing.sm;

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
  // ADR-013 Amd3 K3 — ikram yalnız admin/kasiyer; buton aksi hâlde gizli.
  const canComp = useAuthStore(
    (state) => state.user?.role === 'admin' || state.user?.role === 'cashier',
  );

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
  // ADR-026 Amendment 3 K1 — pending satır-detay modalı hedefi; null = kapalı.
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);
  // ADR-013 Amd3 — kayıtlı kalem detay sheet'i (PATCH yolu).
  const [editingSavedItem, setEditingSavedItem] = useState<ApiOrderItem | null>(
    null,
  );
  const [savingItem, setSavingItem] = useState(false);
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

  /**
   * Adisyona KAYDEDİLMİŞ adetler, ürün bazında (S104 — ürün sahibi talebi,
   * Adisyo paritesi: masaya girince kartta "hangi üründen kaç tane" görünsün).
   *
   * `cancelled` kalemler SAYILMAZ (iptal edilen ürün adisyonda yok). `product_id`
   * null olabilir (silinmiş ürün snapshot'ı) → atlanır. Sepet (`pendingQty`) ile
   * TOPLANMAZ; kart ikisini ayrı gösterir.
   */
  const savedQtyByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of existingItems) {
      if (it.status === 'cancelled' || it.product_id === null) continue;
      map.set(it.product_id, (map.get(it.product_id) ?? 0) + it.quantity);
    }
    return map;
  }, [existingItems]);

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
    // ADR-026 Amendment 3 K5 — tam payload (variantId + selectedAttributes +
    // note). Fiyat gönderilmez; sunucu otorite (orders.ts resolveItemAttributes).
    const items: OrderItemInput[] = cart.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      ...(line.variantId !== null ? { variantId: line.variantId } : {}),
      ...(line.note !== null ? { note: line.note } : {}),
      ...(line.selectedAttributes.length > 0
        ? {
            selectedAttributes: line.selectedAttributes.map((a) => ({
              groupId: a.groupId,
              optionId: a.optionId,
            })),
          }
        : {}),
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

  /**
   * ADR-013 Amendment 3 — kayıtlı kalem PATCH (adet/porsiyon/fiyat/not/sil/
   * ikram). Başarıda aktif sipariş yanıtı cache'e yazılır + masa tahtası
   * tazelenir (handleSave deseni). Kalem iptali son kalemse backend siparişi
   * kapatır → masaya dön (adisyon boş kalırsa 409-footgun'ı önlenir).
   */
  async function patchSavedItem(patch: OrderItemPatch): Promise<void> {
    const target = editingSavedItem;
    const activeOrder = activeOrderQuery.data ?? null;
    if (target === null || activeOrder === null) return;
    setSavingItem(true);
    try {
      const updated = await updateOrderItem(activeOrder.id, target.id, patch);
      queryClient.setQueryData(
        ['orders', 'by-table', tableId, 'active'],
        updated,
      );
      setEditingSavedItem(null);
      await queryClient.invalidateQueries({ queryKey: ['tables'] });
      await queryClient.invalidateQueries({
        queryKey: ['orders', 'by-table', tableId, 'active'],
      });
      // Kalem iptaliyle sipariş boşaldıysa backend `cancelled` döner → masaya dön.
      if (patch.status === 'cancelled' && updated.items.length === 0) {
        navigation.goBack();
        return;
      }
      setSheetVisible(true);
    } catch {
      Alert.alert(
        t('order.itemDetail.saveFailed'),
        t('order.save.error'),
        [{ text: t('common.close'), style: 'cancel' }],
      );
    } finally {
      setSavingItem(false);
    }
  }

  const isLoading = categoriesQuery.isLoading || productsQuery.isLoading;
  // ADR-026 Amendment 1 (hci-gate bulgusu, TablesScreen ile aynı aile) — menü
  // katalogu yalnız İLK yüklemede hataya düşer; cache'liyken başarısız bir
  // focus-refetch (K1) sipariş ortasında katalogu tam-ekran hatayla SİLMEZ.
  const isError = categoriesQuery.isLoadingError || productsQuery.isLoadingError;

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
            {/* Sepet doluyken dolu (filled) varyant — tek bakışta "bekleyen
                kalem var" sinyali; boşken ince outline (6. bulgu: ikon kalitesi). */}
            <Ionicons
              name={cart.totalQuantity > 0 ? 'receipt' : 'receipt-outline'}
              size={26}
              color={colors.slateText}
            />
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
              savedQuantity={savedQtyByProductId.get(item.id) ?? 0}
              width={cardWidth}
              onAdd={() => cart.addProduct(item)}
              onIncrement={() => cart.incrementProduct(item)}
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
        // Bar'ın KENDİSİ dokunmaz — yalnız sağdaki buton kaydeder.
        // Daha önce tüm bar Pressable'dı: özet yazısına ("3 ürün · ₺240") dokunmak
        // da siparişi gönderiyordu. Yanlışlıkla mutfağa sipariş düşmesi demek
        // olduğu için ürün sahibi bunu ilk bulgu olarak bildirdi (2026-07-20).
        <View
          // Bar'ı telefonun alt çentiğinin (home indicator) ötesine kadar doldur,
          // içerik güvenli alanda kalsın. Math.max, insets.bottom=0 olan
          // cihazlarda (Android) davranışı değiştirmez.
          style={[
            styles.saveBar,
            { paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          <Text style={styles.saveSummary} numberOfLines={1}>
            {t('order.bar.summary', {
              count: cart.totalQuantity,
              total: formatMoney(cart.subtotalCents),
            })}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.saveButton,
              saving && styles.saveButtonDisabled,
              pressed && !saving && styles.saveButtonPressed,
            ]}
            onPress={() => {
              void handleSave();
            }}
            disabled={saving}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            accessibilityLabel={t('order.bar.save')}
          >
            {saving ? (
              <>
                <ActivityIndicator color={colors.slateText} />
                <Text style={styles.saveText}>{t('order.bar.saving')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.saveText}>{t('order.bar.save')}</Text>
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={colors.slateText}
                />
              </>
            )}
          </Pressable>
        </View>
      ) : null}

      <AdisyonSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        tableLabel={tableLabel}
        existingItems={existingItems}
        existingTotalCents={existingTotalCents}
        cartLines={cart.lines}
        pendingSubtotalCents={cart.subtotalCents}
        onIncrement={cart.increment}
        onDecrement={cart.decrement}
        onRemove={cart.remove}
        // Alt bardaki Kaydet ile AYNI eylem — sheet'ten de kaydedilebilsin
        // (garson geri bildirimi 2026-07-20; handleSave sheet'i kendisi kapatır).
        onSave={() => {
          void handleSave();
        }}
        saving={saving}
        onEditLine={(line) => {
          // K1: adisyonu kapat, satır-detay modalını aç (kapanışta geri açılır).
          setSheetVisible(false);
          setEditingLine(line);
        }}
        onEditSavedItem={(item) => {
          setSheetVisible(false);
          setEditingSavedItem(item);
        }}
      />

      {/* ADR-013 Amendment 3 — kayıtlı kalem detay (adet/porsiyon/fiyat/not/
          sil/ikram). PATCH yolu; başarıda aktif sipariş + masa tahtası tazelenir. */}
      <SavedItemSheet
        item={editingSavedItem}
        product={
          editingSavedItem !== null
            ? products.find((p) => p.id === editingSavedItem.product_id) ?? null
            : null
        }
        canComp={canComp}
        isSaving={savingItem}
        onClose={() => {
          setEditingSavedItem(null);
          setSheetVisible(true);
        }}
        onSave={(patch) => void patchSavedItem(patch)}
        onVoid={() => {
          // S104 (ürün sahibi): silme ANINDA olmasın — onay iste. K6: silme
          // mutfağa iptal fişi gönderir, bunu da uyarıda söyle.
          const name = editingSavedItem?.product_name ?? '';
          Alert.alert(
            t('order.itemDetail.deleteConfirmTitle', { name }),
            t('order.itemDetail.deleteConfirmBody'),
            [
              { text: t('order.itemDetail.deleteConfirmKeep'), style: 'cancel' },
              {
                text: t('order.itemDetail.delete'),
                style: 'destructive',
                onPress: () => void patchSavedItem({ status: 'cancelled' }),
              },
            ],
          );
        }}
        onToggleComp={() =>
          void patchSavedItem({ isComped: !editingSavedItem?.is_comped })
        }
      />

      {/* ADR-026 Amendment 3 — porsiyon/özellik/not modalı (yalnız pending, K3).
          Kaydet cart.updateLine ile 5-tuple birleştirme yapar (K4). */}
      <LineDetailSheet
        line={editingLine}
        product={
          editingLine !== null
            ? products.find((p) => p.id === editingLine.productId) ?? null
            : null
        }
        onClose={() => {
          setEditingLine(null);
          setSheetVisible(true);
        }}
        onSave={(edit) => {
          if (editingLine !== null) {
            cart.updateLine(editingLine.rowId, edit);
          }
          setEditingLine(null);
          setSheetVisible(true);
        }}
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
    // Warm cream canvas (Adisyo reference) — white cards + pastel category
    // tiles read as their own layers on top; keeps card separation in bright
    // light (cards carry border + shadow).
    backgroundColor: colors.canvas,
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
    top: 2,
    right: 2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    // Koyu başlık üzerinde rozeti ikondan ayıran halka (6. bulgu).
    borderWidth: 2,
    borderColor: colors.slate,
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
    // white-on-surface like TablesScreen pills — surface-on-surface made the
    // box invisible once the page background changed (Amd4 gate finding).
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
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
  // Bar artık nötr bir yüzey: aksan rengi butonun kendisine ait, böylece
  // "buton nerede" sorusu tek bakışta cevaplanıyor (önceden tüm bar aksandı ve
  // ortada buton şekli yoktu — ürün sahibi 6. bulguda bunu bildirdi).
  saveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  saveSummary: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.semibold,
  },
  saveButton: {
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
  saveButtonPressed: {
    opacity: 0.85,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveText: {
    color: colors.slateText,
    fontSize: typography.fontSize.lg,
    // Token'lardaki en kalın değer '700'; bu ekranın birincil eylemi olduğu için
    // bilinçli olarak daha kalın (ADR-026 Amd4 K1 "yalnız dokunulan component").
    fontWeight: '800',
  },
});
