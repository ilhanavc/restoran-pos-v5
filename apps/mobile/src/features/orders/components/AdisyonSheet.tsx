import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@restoran-pos/shared-domain';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ApiOrderItem } from '../../../api/orders';
import type { OrderItemPatch } from '../../../api/client';
import {
  buttonHeight,
  colors,
  minTouchTarget,
  radius,
  shadow,
  spacing,
  typography,
} from '../../../theme';
import type { CartLine } from '../cart';
import { QtyStepper } from './QtyStepper';

interface AdisyonSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Region-local table label ("Masa 3") for the sheet title. */
  tableLabel: string;
  /** Adisyona kayıtlı kalemler; satıra dokununca detay sheet'i açılır (Amd3).
   *  ADR-013 Amd4: bekleyen yama uygulanmış (merged) halleri gelir. */
  existingItems: ApiOrderItem[];
  /** ADR-013 Amd4 K10 — itemId → bekleyen yama. Satırdaki "değişti"/"silinecek"
   *  işareti bu haritadan türetilir. */
  stagedItemIds?: ReadonlyMap<string, OrderItemPatch>;
  /** ADR-013 Amd4 K4 — bekleyen değişikliği/silmeyi commit ÖNCESİ geri alır. */
  onUnstageSavedItem?: (itemId: string) => void;
  existingTotalCents: number;
  /** Pending local additions (editable). */
  cartLines: CartLine[];
  pendingSubtotalCents: number;
  onIncrement: (rowId: string) => void;
  onDecrement: (rowId: string) => void;
  onRemove: (rowId: string) => void;
  /** Tap a pending row body → open the line-detail modal (ADR-026 Amd3 K1). */
  onEditLine: (line: CartLine) => void;
  /** ADR-013 Amd3 — kayıtlı satıra dokun → kalem detay sheet'i. */
  onEditSavedItem: (item: ApiOrderItem) => void;
  /**
   * Kaydet — Order ekranının alt barındaki AYNI eylemi çağırır (tek akış).
   * Yalnız bekleyen kalem varken buton render edilir.
   */
  onSave: () => void;
  /**
   * Butonun etiketi. Varsayılan `order.bar.save` ("Kaydet") — adisyona kaydeden
   * ekranlar (Order) hiçbir şey geçmez. `onSave` kaydetmeyip bir sonraki adıma
   * geçiyorsa (paket akışı: müşteri/ödeme sheet'i) çağıran ekran NÖTR bir etiket
   * geçmeli; yoksa hiçbir şey kaydedilmemişken buton "Kaydet" der (Nielsen #2).
   * Zaten çevrilmiş metin beklenir, i18n key DEĞİL.
   */
  saveLabel?: string;
  /** Kaydetme sürüyor → buton kilitli + "Kaydediliyor…" (çift gönderim yok). */
  saving: boolean;
}

/**
 * Adisyon bottom-sheet (ADR-026 K2).
 *
 * Opened from the header cart icon. Shows what is already on the table's bill
 * (saved items — read-only, K3) followed by the waiter's pending additions
 * (editable via the vertical stepper + a trash to drop a line, and — ADR-026
 * Amendment 3 K1 — tapping the row body opens the porsiyon/özellik/not modal).
 * Both saved and pending rows surface porsiyon + özellik özeti + not read-only
 * (K6). The grand total sums both. NO kitchen-status label (Hazır/Mutfakta) is
 * shown. Unauthorised actions (pay / cancel / comp / transfer / print) are never
 * rendered (ADR-026 K6).
 *
 * KAYDET (K7 revize — garson geri bildirimi, ürün sahibi 2026-07-20): sheet
 * artık kendi Kaydet butonunu taşır. K7 "tek kaydet butonu, hep aynı yerde"
 * diyordu; sahada garsonlar adisyonu gözden geçirip kaydetmek için sheet'i
 * KAPATMAK zorunda kalıyordu. Buton, Order ekranındaki bar ile AYNI `onSave`
 * eylemini çağırır (iki ayrı kaydetme yolu YOK, tek akışın ikinci girişi) ve
 * yalnız bekleyen kalem varken görünür.
 */
export function AdisyonSheet({
  visible,
  onClose,
  tableLabel,
  existingItems,
  stagedItemIds,
  onUnstageSavedItem,
  existingTotalCents,
  cartLines,
  pendingSubtotalCents,
  onIncrement,
  onDecrement,
  onRemove,
  onEditLine,
  onEditSavedItem,
  onSave,
  saveLabel,
  saving,
}: AdisyonSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // S104 BUG — iptal edilen (cancelled) kalem listede KALIYORDU (web AdisyonPanel
  // filtreliyor, mobil filtrelemiyordu): kullanıcı ürünü sildi, satır düşmedi
  // ama sunucu toplamı düştüğü için fiyat düştü. Web ile birebir filtre.
  const visibleExisting = existingItems.filter(
    (it) => it.status !== 'cancelled',
  );
  const hasExisting = visibleExisting.length > 0;
  const hasPending = cartLines.length > 0;
  // Amd4 K8 — sheet'teki Kaydet yeni ürün VEYA bekleyen kalem düzenlemesi/
  // silmesi varken görünür. Aksi halde garson değişikliği burada görüp
  // kaydedemez, sheet'i kapatmak zorunda kalırdı (K7'nin çözdüğü sürtünmenin
  // aynısı).
  const hasStagedEdits = (stagedItemIds?.size ?? 0) > 0;
  const canSave = hasPending || hasStagedEdits;
  const grandTotalCents = existingTotalCents + pendingSubtotalCents;

  // ADR-026 Amendment 3 K6 — özellik özeti: virgüllü; ücretli seçenek `+₺x`.
  const attrSummary = (
    attrs: { name: string; extraCents: number }[],
  ): string =>
    attrs
      .map((a) =>
        a.extraCents > 0
          ? `${a.name} ${t('order.attributes.extraPrice', {
              amount: formatMoney(a.extraCents),
            })}`
          : a.name,
      )
      .join(', ');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityElementsHidden />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {t('order.adisyon.title', { table: tableLabel })}
            </Text>
            <Pressable
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('order.adisyon.close')}
            >
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          </View>

          {!hasExisting && !hasPending ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>{t('order.adisyon.empty')}</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {hasExisting ? (
                <>
                  <Text style={styles.sectionLabel}>
                    {t('order.adisyon.existingTitle')}
                  </Text>
                  {visibleExisting.map((item) => {
                    // ADR-013 Amd3 — kayıtlı satır artık DÜZENLENEBİLİR: dokun →
                    // SavedItemSheet (adet/porsiyon/fiyat/not/sil/ikram). Eski
                    // "Kilitli" rozeti kalktı (S104 #462 sahiplik+durum kapılarını
                    // kaldırdı → kilit her zaman false'du, hiç görünmüyordu).
                    // Amd4 K10 — bekleyen değişiklik taşıyan satır görsel olarak
                    // ayrışır; "silinecek" satır DÜZENLENEMEZ (önce geri al).
                    const staged = stagedItemIds?.get(item.id);
                    const stagedVoid = staged?.status === 'cancelled';
                    const hasStaged = staged !== undefined;
                    return (
                    <Pressable
                      key={item.id}
                      style={({ pressed }) => [
                        styles.row,
                        hasStaged && styles.rowStaged,
                        // Silinecek satır KIRMIZI şeritle ayrışır: koşarken
                        // bakılırken metin okumadan da fark edilsin (rozet +
                        // üstü çizili + renk üç ayrı sinyal).
                        stagedVoid === true && styles.rowStagedVoid,
                        // Dokunuş no-op olsa bile "sistem gördü" geri bildirimi
                        // verilir; aksi halde satır bozuk sanılır.
                        pressed && styles.rowPressed,
                      ]}
                      onPress={() => {
                        if (stagedVoid) return;
                        onEditSavedItem(item);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: stagedVoid }}
                    >
                      <View style={styles.savedQty}>
                        <Text style={styles.savedQtyText}>{item.quantity}×</Text>
                      </View>
                      <View style={styles.rowBody}>
                        <Text
                          style={[
                            styles.rowName,
                            stagedVoid === true && styles.rowNameVoided,
                          ]}
                          numberOfLines={2}
                        >
                          {item.product_name}
                        </Text>
                        {hasStaged ? (
                          <Text
                            style={[
                              styles.stagedBadge,
                              stagedVoid === true
                                ? styles.stagedBadgeVoid
                                : styles.stagedBadgeEdit,
                            ]}
                          >
                            {stagedVoid === true
                              ? t('order.adisyon.stagedVoidBadge')
                              : t('order.adisyon.stagedEditBadge')}
                          </Text>
                        ) : null}
                        {/* K6: porsiyon (web `?? 'Tam'` paritesi) + özellik özeti
                            + not — kayıtlı satırda read-only. */}
                        <Text style={styles.rowVariant}>
                          {item.variant_name_snapshot ??
                            t('order.adisyon.portionFallback')}
                        </Text>
                        {item.attributes.length > 0 ? (
                          <Text style={styles.rowAttrs}>
                            {attrSummary(
                              item.attributes.map((a) => ({
                                name: a.option_name_snapshot,
                                extraCents: a.extra_price_cents_snapshot,
                              })),
                            )}
                          </Text>
                        ) : null}
                        {item.note !== null && item.note !== '' ? (
                          <Text style={styles.rowNote}>{item.note}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.rowPrice}>
                        {formatMoney(item.total_cents)}
                      </Text>
                      {/* Amd4 K4 — "Geri al" satırın SAĞ ucunda, ana dokunma
                          bandından geometrik olarak ayrık (hci gate blocker:
                          gövdeye gömülüyken garson ürün adına dokunurken
                          yanlışlıkla basıp değişikliğini kaybedebiliyordu). */}
                      {hasStaged && onUnstageSavedItem !== undefined ? (
                        <Pressable
                          onPress={() => onUnstageSavedItem(item.id)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={t('order.adisyon.unstage')}
                          style={({ pressed }) => [
                            styles.unstageButton,
                            pressed && styles.unstageButtonPressed,
                          ]}
                        >
                          <Ionicons
                            name="arrow-undo"
                            size={20}
                            color={colors.accent}
                          />
                          <Text style={styles.unstageText}>
                            {t('order.adisyon.unstageShort')}
                          </Text>
                        </Pressable>
                      ) : null}
                    </Pressable>
                    );
                  })}
                </>
              ) : null}

              {hasPending ? (
                <>
                  {hasExisting ? (
                    <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>
                      {t('order.adisyon.pendingTitle')}
                    </Text>
                  ) : null}
                  {cartLines.map((line) => (
                    <View key={line.rowId} style={styles.row}>
                      <QtyStepper
                        quantity={line.quantity}
                        onIncrement={() => onIncrement(line.rowId)}
                        onDecrement={() =>
                          line.quantity > 1
                            ? onDecrement(line.rowId)
                            : onRemove(line.rowId)
                        }
                        decrementIcon={line.quantity > 1 ? 'remove' : 'trash'}
                        increaseLabel={t('order.adisyon.itemIncrease')}
                        decreaseLabel={
                          line.quantity > 1
                            ? t('order.adisyon.itemDecrease')
                            : t('order.adisyon.itemRemove')
                        }
                      />
                      {/* K1: satır gövdesine dokunma → satır-detay modalı
                          (qty-stepper/sil ayrı dokunma hedefi olarak kalır). */}
                      <Pressable
                        style={({ pressed }) => [
                          styles.rowBody,
                          pressed && styles.rowBodyPressed,
                        ]}
                        onPress={() => onEditLine(line)}
                        accessibilityRole="button"
                        accessibilityLabel={t('order.adisyon.editLine', {
                          name: line.productName,
                        })}
                      >
                        <Text style={styles.rowName} numberOfLines={2}>
                          {line.productName}
                        </Text>
                        {/* K6: porsiyon (Tam fallback) + özellik özeti + not. */}
                        <Text style={styles.rowVariant}>
                          {line.variantName ??
                            t('order.adisyon.portionFallback')}
                        </Text>
                        {line.selectedAttributes.length > 0 ? (
                          <Text style={styles.rowAttrs}>
                            {attrSummary(
                              line.selectedAttributes.map((a) => ({
                                name: a.optionName,
                                extraCents: a.extraPriceCents,
                              })),
                            )}
                          </Text>
                        ) : null}
                        {line.note !== null && line.note !== '' ? (
                          <Text style={styles.rowNote}>{line.note}</Text>
                        ) : null}
                      </Pressable>
                      <Text style={styles.rowPrice}>
                        {formatMoney(line.unitPriceCents * line.quantity)}
                      </Text>
                      {/* Y3: satırın düzenlenebilir olduğunu belli eden gösterge. */}
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={colors.textSecondary}
                        accessible={false}
                      />
                    </View>
                  ))}
                </>
              ) : null}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <Text style={styles.totalLabel}>{t('order.adisyon.total')}</Text>
            <Text style={styles.totalValue}>{formatMoney(grandTotalCents)}</Text>
          </View>

          {/* K7 revize: bekleyen kalem varken sheet'ten de kaydedilebilir.
              Order barındaki butonla AYNI eylemi çağırır. Amd4 K8: bekleyen
              kalem düzenlemesi/silmesi de bu butonu görünür kılar. */}
          {canSave ? (
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                saving && styles.saveButtonDisabled,
                pressed && !saving && styles.saveButtonPressed,
              ]}
              onPress={onSave}
              disabled={saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              accessibilityLabel={saveLabel ?? t('order.bar.save')}
            >
              {saving ? (
                <>
                  <ActivityIndicator color={colors.slateText} />
                  <Text style={styles.saveButtonText}>{t('order.bar.saving')}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.saveButtonText}>
                    {saveLabel ?? t('order.bar.save')}
                  </Text>
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={colors.slateText}
                  />
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '85%',
    // Tek ürünlü adisyonda sheet kısalıp içerik ekranın en dibinde kalıyordu
    // (İlhan, 2026-07-20, iPhone). Alt taban: içerik üstten başlar, boş alan
    // altta kalır.
    minHeight: '45%',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  // Tipografi: Adisyo-parite büyütme (İlhan, 2026-07-20 — "yazılar küçük ve
  // zor görünüyor, kalınlaştıralım"; referans ekran görüntüsü).
  title: {
    flex: 1,
    fontSize: typography.fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  closeBtn: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBox: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  sectionLabelSpaced: {
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  savedQty: {
    width: 30 + 8,
    alignItems: 'center',
  },
  savedQtyText: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  rowBody: {
    flex: 1,
  },
  rowBodyPressed: {
    opacity: 0.6,
  },
  rowName: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  // ADR-013 Amd4 K10 — bekleyen değişiklik/silme gösterimi (web AdisyonPanel
  // paritesi: mor şerit + rozet, silinecek satırda üstü çizili).
  rowStaged: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingLeft: spacing.sm,
  },
  /** "Silinecek" satır — kırmızı şerit (renk + rozet + üstü çizili = 3 sinyal). */
  rowStagedVoid: {
    borderLeftColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  /** Dokunuş geri bildirimi — no-op satırda da "sistem gördü" sinyali. */
  rowPressed: {
    opacity: 0.7,
  },
  rowNameVoided: {
    textDecorationLine: 'line-through',
  },
  stagedBadge: {
    alignSelf: 'flex-start',
    fontSize: typography.fontSize.sm,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  stagedBadgeEdit: {
    color: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  stagedBadgeVoid: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  // hci gate: POS dokunma tabanı (pos-checklist §4). Satırın sağ ucunda, ana
  // "detayı aç" bandından ayrık; yanlış dokunuş değişikliği sıfırlıyordu.
  unstageButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
  },
  unstageButtonPressed: {
    opacity: 0.6,
  },
  unstageText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.accent,
  },
  rowVariant: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rowAttrs: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rowNote: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  rowPrice: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  totalValue: {
    fontSize: typography.fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  // Order ekranındaki Kaydet butonuyla aynı görsel dil (aynı eylem, aynı görünüm).
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: buttonHeight,
    marginTop: spacing.md,
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
  saveButtonText: {
    color: colors.slateText,
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
  },
});
