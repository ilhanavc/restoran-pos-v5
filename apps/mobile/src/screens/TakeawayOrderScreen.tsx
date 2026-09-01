import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@restoran-pos/shared-domain';
import type { ProductWithVariants } from '@restoran-pos/shared-types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createTakeawayOrder } from '../api/client';
import { genIdempotencyKey } from '../api/uuid';
import { useCart, type CartLine } from '../features/orders/cart';
import { AdisyonSheet } from '../features/orders/components/AdisyonSheet';
import { CategoryGrid } from '../features/orders/components/CategoryGrid';
import { LineDetailSheet } from '../features/orders/components/LineDetailSheet';
import { ProductCard } from '../features/orders/components/ProductCard';
import { useMenuCategories, useMenuProducts } from '../features/orders/queries';
import { CustomerSheet } from '../features/takeaway/CustomerSheet';
import {
  PaymentTypeSheet,
  type PlannedPaymentType,
} from '../features/takeaway/PaymentTypeSheet';
import {
  resolveIdempotencyKey,
  sheetAfterNext,
} from '../features/takeaway/flow';
import {
  buildTakeawayItems,
  canSubmitTakeaway,
} from '../features/takeaway/payload';
import { invalidateAfterTakeawaySave } from '../features/takeaway/refresh';
import type { RootStackParamList } from '../navigation/types';
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

type Props = NativeStackScreenProps<RootStackParamList, 'Takeaway'>;

const H_PADDING = spacing.md;
const GAP = spacing.sm;

/**
 * Paket (takeaway) sipariş oluşturma — ADR-039 (+ Amendment 1).
 *
 * **Giriş noktası Mutfak sekmesindeki FAB'dır** (K5.0, ürün sahibi kararı);
 * bu ekran root stack'te, sekme çubuğunun DIŞINDA yaşar — `OrderScreen` ile
 * aynı gerekçe (ADR-026 Amd5 K2): sipariş alırken tam-ekran odak, yanlışlıkla
 * sekme değiştirip sepetten çıkma riski yok.
 *
 * **Akış (Amd1 K1 — K5 adım 2 SUPERSEDE edildi, web ile hizalıdır):** ekran
 * doğrudan **ürün kataloğuyla** açılır → sepet doldurulur → "Devam" → müşteri
 * **sheet**'i (seçili müşteri varsa atlanır, Amd1 K4) → ödeme tipi sheet'i →
 * tek `POST /orders` → Mutfak listesine dön + liste tazelenir (K5.5: garson
 * kaydettiğini anında görür, "kayboldu mu?" sorusu doğmaz).
 *
 * Müşteri hâlâ **zorunlu kapıdır** (Amd1 K3): `sheetAfterNext` müşterisiz
 * ödeme sheet'ini açmaz, `canSubmitTakeaway` müşterisiz POST'a izin vermez.
 * Garson `TAKEAWAY_CUSTOMER_REQUIRED` sunucu reddini hiç görmez; değişen tek
 * şey, kapının ekranın başında değil "Devam" tuşunda durmasıdır.
 *
 * **Bileşen yeniden kullanımı ZORUNLU (K5 adım 3 / DoD 11):** katalog, kart,
 * adet adımlayıcı, satır-detayı ve adisyon `features/orders`'tan gelir. İkinci
 * bir sipariş ekranı yazmak yasaktır — porsiyon/özellik/not (ADR-026 Amd3) ve
 * fiyat override (ADR-013 Amd5) davranışları iki kopyada ayrışırsa "paket
 * çalışıyor, masa çalışmıyor" sınıfı arıza garantidir.
 *
 * **Kapsam DIŞI (K6/K12):** aşama yönetimi, düzenleme, iptal, tahsilat, adres
 * GİRİŞİ, yazıcı hedefi seçimi. Garson paket siparişi AÇAR; kasa kapatır.
 */
export function TakeawayOrderScreen({
  navigation,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const categoriesQuery = useMenuCategories();
  const productsQuery = useMenuProducts();
  const cart = useCart();

  const [customer, setCustomer] = useState<{
    id: string;
    fullName: string;
  } | null>(null);
  const [customerVisible, setCustomerVisible] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [paymentType, setPaymentType] = useState<PlannedPaymentType | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const numColumns = useSettingsStore((state) => state.productColumns);
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.floor(
    (windowWidth - H_PADDING * 2 - GAP * (numColumns - 1)) / numColumns,
  );

  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );
  const products = useMemo(
    () => productsQuery.data ?? [],
    [productsQuery.data],
  );

  useEffect(() => {
    const first = categories[0];
    if (selectedCategoryId === null && first !== undefined) {
      setSelectedCategoryId(first.id);
    }
  }, [categories, selectedCategoryId]);

  const visibleProducts = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('tr');
    if (query.length > 0) {
      return products.filter((p) =>
        p.name.toLocaleLowerCase('tr').includes(query),
      );
    }
    return products.filter((p) => p.categoryId === selectedCategoryId);
  }, [products, searchQuery, selectedCategoryId]);

  /**
   * ADR-013 Amd1 K9 / ADR-039 K1 — attempt-sabit idempotency key.
   *
   * İlk Kaydet denemesinde üretilir; hata sonrası "Tekrar Dene" AYNI key'i
   * taşır (ref null'a düşene kadar) → sunucu ikinci isteği 200 replay ile
   * yanıtlar. Mobil ağı kararsızdır; bu olmadan retry = çift sipariş = çift
   * mutfak fişi + çift paket fişi + çift para.
   */
  const saveKeyRef = useRef<string | null>(null);

  const canSubmit = canSubmitTakeaway({
    customerId: customer?.id ?? null,
    plannedPaymentType: paymentType,
    lineCount: cart.lines.length,
  });

  async function handleSave(): Promise<void> {
    if (saving || !canSubmit || customer === null || paymentType === null) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    saveKeyRef.current = resolveIdempotencyKey(
      saveKeyRef.current,
      genIdempotencyKey,
    );
    try {
      await createTakeawayOrder(
        {
          customerId: customer.id,
          plannedPaymentType: paymentType,
          items: buildTakeawayItems(cart.lines),
        },
        saveKeyRef.current,
      );
      saveKeyRef.current = null; // başarı → sonraki sipariş için taze key
      cart.clear();
      setPaymentVisible(false);
      // K5.5 — Mutfak listesi TAZELENİR ve garson kaydettiği siparişi orada
      // görür. Çağrı await EDİLMEZ: liste ekranı zaten odaklanınca da refetch
      // eder, kullanıcıyı ağ turu kadar bekletmeyiz.
      invalidateAfterTakeawaySave(queryClient);
      navigation.goBack();
    } catch {
      // Satır-içi hata (sheet AÇIK kalır — modal üstünde toast görünmez).
      // Sepet korunur; garson aynı key ile tekrar deneyebilir.
      setSaveError(t('takeaway.save.error'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * "Devam" → müşteri yoksa müşteri sheet'i, varsa doğrudan ödeme sheet'i
   * (Amd1 K3/K4). Dallanma kararı `sheetAfterNext`'tedir ve orada test edilir;
   * burada ikinci bir koşul TAŞINMAZ — tek koruma hattı = tek test noktası.
   */
  function handleNext(): void {
    setSaveError(null);
    setSheetVisible(false);
    if (sheetAfterNext(customer?.id ?? null) === 'customer') {
      setCustomerVisible(true);
      return;
    }
    setPaymentVisible(true);
  }

  /** Sepette ürün varken geri → onay (yanlışlıkla kaybetmesin). */
  function handleBack(): void {
    if (cart.lines.length === 0) {
      navigation.goBack();
      return;
    }
    Alert.alert(
      t('takeaway.leaveDialog.title'),
      t('takeaway.leaveDialog.body'),
      [
        { text: t('takeaway.leaveDialog.stay'), style: 'cancel' },
        {
          text: t('takeaway.leaveDialog.confirm'),
          style: 'destructive',
          onPress: () => navigation.goBack(),
        },
      ],
    );
  }

  const isLoading = categoriesQuery.isLoading || productsQuery.isLoading;
  const isError = categoriesQuery.isLoadingError || productsQuery.isLoadingError;

  return (
    <View style={styles.safe}>
      <View style={styles.header}>
        {/* Ürün adımı ekranın KÖKÜDÜR → geri tek anlama gelir: akıştan çık
            (Amd1 K2/K5). İkinci bir "adım geri" semantiği yoktur. */}
        <Pressable
          style={styles.iconButton}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('order.header.back')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.slateText} />
        </Pressable>
        <View style={styles.headerTexts}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t('takeaway.title')}
          </Text>
          {/* Müşteri seçiliyse ad İKİNCİL satırda görünür (Amd1 K6, web
              `subtitleOverride` paritesi) — başlık adım-koşullu değildir. */}
          {customer !== null ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {customer.fullName}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={styles.iconButton}
          onPress={() => setSheetVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={t('order.header.cartLabel', {
            count: cart.totalQuantity,
          })}
        >
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
              // Paket sipariş HER ZAMAN yenidir: kayıtlı adisyon yok →
              // "kayıtlı adet" rozeti hep 0 (masa akışıyla tek fark).
              savedQuantity={0}
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
        <View
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
              pressed && styles.saveButtonPressed,
            ]}
            onPress={handleNext}
            accessibilityRole="button"
            accessibilityLabel={t('takeaway.bar.next')}
          >
            <Text style={styles.saveText}>{t('takeaway.bar.next')}</Text>
            <Ionicons
              name="arrow-forward-circle"
              size={22}
              color={colors.slateText}
            />
          </Pressable>
        </View>
      ) : null}

      <AdisyonSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        // Müşteri artık sepetten SONRA seçilir (Amd1 K1) → henüz yokken
        // adisyon başlığı ekranın adını taşır, boş kalmaz.
        tableLabel={customer?.fullName ?? t('takeaway.title')}
        // Paket sipariş yeni doğar: kayıtlı kalem yok, bekleyen yama yok.
        existingItems={[]}
        existingTotalCents={0}
        cartLines={cart.lines}
        pendingSubtotalCents={cart.subtotalCents}
        onIncrement={cart.increment}
        onDecrement={cart.decrement}
        onRemove={cart.remove}
        onSave={handleNext}
        // handleNext siparişi KAYDETMEZ; müşteri/ödeme sheet'ini açar. Buton
        // bu yüzden alt bardaki nötr "Devam" etiketini taşır — "Kaydet" deseydi
        // hiçbir şey kaydedilmemişken kaydedildi sanılırdı (Nielsen #2).
        saveLabel={t('takeaway.bar.next')}
        saving={saving}
        onEditLine={(line) => {
          setSheetVisible(false);
          setEditingLine(line);
        }}
        // Kayıtlı kalem hiç olmadığı için tetiklenemez; prop zorunlu.
        onEditSavedItem={() => undefined}
      />

      <LineDetailSheet
        line={editingLine}
        product={
          editingLine !== null
            ? (products.find((p) => p.id === editingLine.productId) ?? null)
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

      <CustomerSheet
        visible={customerVisible}
        selectedName={customer?.fullName ?? null}
        onSelect={(selected) => {
          setCustomer(selected);
          setCustomerVisible(false);
          // Web paritesi: müşteri seçilir seçilmez ödeme adımına geçilir
          // (`OrderScreenPage.tsx:1347-1353`). Sepet zaten dolu olduğu için
          // araya üçüncü bir dokunuş girmez.
          setPaymentVisible(true);
        }}
        // Kapatma sepete DOKUNMAZ (Amd1 K5): garson ürün adımına döner,
        // sepeti olduğu gibi bulur.
        onClose={() => setCustomerVisible(false)}
      />

      <PaymentTypeSheet
        visible={paymentVisible}
        customerName={customer?.fullName ?? ''}
        totalCents={cart.subtotalCents}
        selected={paymentType}
        onSelect={(type) => {
          setPaymentType(type);
          setSaveError(null);
        }}
        onClose={() => {
          if (saving) return;
          setPaymentVisible(false);
        }}
        onConfirm={() => {
          void handleSave();
        }}
        saving={saving}
        errorMessage={saveError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
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
  headerTexts: {
    flex: 1,
  },
  headerTitle: {
    textAlign: 'center',
    color: colors.slateText,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    textAlign: 'center',
    color: colors.slateText,
    fontSize: typography.fontSize.sm,
    opacity: 0.85,
  },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
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
  saveText: {
    color: colors.slateText,
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
  },
});
