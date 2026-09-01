import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@restoran-pos/shared-domain';
import type { ProductWithVariants } from '@restoran-pos/shared-types';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, minTouchTarget, radius, spacing, typography } from '../../../theme';
import type { OrderItemPatch } from '../../../api/client';
import type { ApiOrderItem } from '../../../api/orders';

/**
 * Kaydedilmiş kalem detay sheet'i — ADR-013 Amendment 3 (mobil).
 *
 * Web `ItemDetailModal` muadili; kapsam: adet · porsiyon · birim fiyat · not ·
 * sil · ikram. Web'le AYNI backend uçları (`PATCH /orders/:id/items/:itemId`).
 *
 * K6 kullanıcıya söylenir: adet/fiyat/not/porsiyon fiş BASMAZ; SİL mutfağa iptal
 * fişi gönderir. K3: fiyat/adet/porsiyon/not herkeste; İKRAM yalnız `canComp`
 * (admin/kasiyer) — buton aksi hâlde render EDİLMEZ (ADR-026 K6).
 *
 * ADR-035 S13 — "Başka Masaya Taşı" da buradan başlar ve ANLIK çalışır (bekleyen
 * katmana yazmaz): kaydedilmemiş değişiklik varken buton KAPALI, gerekçesi
 * hemen altında yazar. Yetkisiz rolde (`canMove=false`) hiç render edilmez.
 */
interface SavedItemSheetProps {
  /** null = kapalı. */
  item: ApiOrderItem | null;
  /** Kalemin ürünü (porsiyon listesi); null → porsiyon bloğu gizli. */
  product: ProductWithVariants | null;
  canComp: boolean;
  /** ADR-035 S9 — admin/kasiyer/garson; false ise Taşı butonu render EDİLMEZ. */
  canMove: boolean;
  /** Adisyonda bekleyen (kaydedilmemiş) değişiklik var → taşıma kapalı (S13). */
  moveBlocked: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: (patch: OrderItemPatch) => void;
  onVoid: () => void;
  onToggleComp: () => void;
  /** Hedef masa seçicisine devreder (çağıran bu sheet'i kapatır). */
  onMove: () => void;
}

export function SavedItemSheet({
  item,
  product,
  canComp,
  canMove,
  moveBlocked,
  isSaving,
  onClose,
  onSave,
  onVoid,
  onToggleComp,
  onMove,
}: SavedItemSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [qty, setQty] = useState(1);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [priceText, setPriceText] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (item === null) return;
    setQty(item.quantity);
    setVariantId(item.variant_id_snapshot ?? null);
    setPriceText((item.unit_price_cents / 100).toFixed(2).replace('.', ','));
    setNote(item.note ?? '');
  }, [item]);

  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const noteRowRef = useRef<View>(null);
  const noteFocusedRef = useRef(false);
  const keyboardScreenYRef = useRef<number | null>(null);

  /**
   * KeyboardAvoidingView'in kendi konum hesaplaması Modal içinde güvenilmez
   * (hem iOS hem Android'de canlı doğrulandı, RN'in bilinen Modal+klavye
   * kısıtı) — Not alanı odaktayken klavyenin gerçek ekran konumuna (screenY)
   * karşı elle scroll düzeltmesi yapılır. İKİ tetikleyici gerekir: klavye
   * SIFIRDAN açılırken (show event) VE klavye ZATEN açıkken kullanıcı başka
   * bir alandan (ör. Birim Fiyat) doğrudan Not'a geçtiğinde — ikincisi
   * olmadan "önce fiyatı düzenle, sonra not ekle" akışında düzeltme sessizce
   * atlanır.
   */
  function adjustNoteScroll(keyboardScreenY: number): void {
    const scrollNode = scrollRef.current;
    const noteNode = noteRowRef.current;
    if (scrollNode === null || noteNode === null) return;
    noteNode.measure((_x, _y, _w, height, _pageX, pageY) => {
      const overlap = pageY + height + spacing.md - keyboardScreenY;
      if (overlap > 0) {
        scrollNode.scrollTo({ y: scrollOffsetRef.current + overlap, animated: true });
      }
    });
  }

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, (e) => {
      keyboardScreenYRef.current = e.endCoordinates.screenY;
      if (noteFocusedRef.current) adjustNoteScroll(e.endCoordinates.screenY);
    });
    return () => sub.remove();
  }, []);

  const variants = product?.variants ?? [];
  const parsedPrice = Math.round(
    Number(priceText.replace(/\./g, '').replace(',', '.')) * 100,
  );
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice >= 0;
  const lineTotal = priceValid ? parsedPrice * qty : 0;

  if (item === null) return <Modal visible={false} transparent />;

  const baseVariant = item.variant_id_snapshot ?? null;
  const basePrice = item.unit_price_cents;
  const dirty =
    qty !== item.quantity ||
    variantId !== baseVariant ||
    (priceValid && parsedPrice !== basePrice) ||
    note !== (item.note ?? '');

  const handleSave = (): void => {
    const patch: OrderItemPatch = {
      ...(qty !== item.quantity && { quantity: qty }),
      ...(variantId !== baseVariant && { variantId }),
      ...(priceValid && parsedPrice !== basePrice && { unitPriceCents: parsedPrice }),
      ...(note !== (item.note ?? '') && { note: note === '' ? null : note }),
    };
    onSave(patch);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={isSaving ? undefined : onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {item.product_name}
            </Text>
            <Pressable
              onPress={onClose}
              disabled={isSaving}
              hitSlop={8}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>{t('order.itemDetail.subtitle')}</Text>

          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScroll={(e) => {
              scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
          >
            {/* Adet */}
            <View style={styles.qtyRow}>
              <Text style={styles.label}>{t('order.itemDetail.qty')}</Text>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={isSaving || qty <= 1}
                  style={[styles.stepBtn, (qty <= 1 || isSaving) && styles.stepBtnOff]}
                  accessibilityRole="button"
                  accessibilityLabel={t('order.itemDetail.qtyDown')}
                >
                  <Ionicons name="remove" size={20} color={colors.textPrimary} />
                </Pressable>
                <Text style={styles.qtyText}>{qty}</Text>
                <Pressable
                  onPress={() => setQty((q) => Math.min(99, q + 1))}
                  disabled={isSaving || qty >= 99}
                  style={[styles.stepBtn, (qty >= 99 || isSaving) && styles.stepBtnOff]}
                  accessibilityRole="button"
                  accessibilityLabel={t('order.itemDetail.qtyUp')}
                >
                  <Ionicons name="add" size={20} color={colors.textPrimary} />
                </Pressable>
              </View>
            </View>

            {/* Porsiyon */}
            {variants.length > 0 ? (
              <View style={styles.block}>
                <Text style={styles.label}>{t('order.itemDetail.portion')}</Text>
                <View style={styles.variantGrid}>
                  {variants.map((v) => {
                    const selected = variantId === v.id;
                    return (
                      <Pressable
                        key={v.id}
                        onPress={() => setVariantId(selected ? null : v.id)}
                        disabled={isSaving}
                        style={[styles.variantChip, selected && styles.variantChipOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text
                          style={[
                            styles.variantText,
                            selected && styles.variantTextOn,
                          ]}
                        >
                          {v.name}
                          {v.priceDeltaCents !== 0
                            ? `  ${v.priceDeltaCents > 0 ? '+' : ''}${formatMoney(v.priceDeltaCents)}`
                            : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* Birim fiyat */}
            <View style={styles.block}>
              <Text style={styles.label}>{t('order.itemDetail.unitPrice')}</Text>
              <TextInput
                value={priceText}
                onChangeText={setPriceText}
                editable={!isSaving}
                keyboardType="decimal-pad"
                style={styles.priceInput}
              />
              <Text style={styles.hint}>{t('order.itemDetail.priceScopeHint')}</Text>
            </View>

            {/* Satır toplamı */}
            <View style={styles.totalRow}>
              <Text style={styles.label}>{t('order.itemDetail.lineTotal')}</Text>
              <Text style={styles.totalValue}>
                {priceValid ? formatMoney(lineTotal) : '—'}
              </Text>
            </View>

            {/* Not */}
            <View style={styles.block} ref={noteRowRef}>
              <Text style={styles.label}>{t('order.itemDetail.note')}</Text>
              <TextInput
                value={note}
                onChangeText={(v) => setNote(v.slice(0, 280))}
                editable={!isSaving}
                multiline
                style={styles.noteInput}
                onFocus={() => {
                  noteFocusedRef.current = true;
                  // Klavye zaten açıkken (ör. Birim Fiyat'tan geçiş) yeni
                  // bir show event gelmez — son bilinen konumla hemen düzelt.
                  if (keyboardScreenYRef.current !== null) {
                    setTimeout(() => adjustNoteScroll(keyboardScreenYRef.current as number), 50);
                  }
                }}
                onBlur={() => {
                  noteFocusedRef.current = false;
                }}
              />
            </View>

            {/* Sil / İkram */}
            <View style={styles.actionRow}>
              <Pressable
                onPress={onVoid}
                disabled={isSaving}
                style={[styles.actionBtn, styles.dangerBtn]}
                accessibilityRole="button"
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text style={[styles.actionText, { color: colors.danger }]}>
                  {t('order.itemDetail.delete')}
                </Text>
              </Pressable>
              {canComp ? (
                <Pressable
                  onPress={onToggleComp}
                  disabled={isSaving}
                  style={styles.actionBtn}
                  accessibilityRole="button"
                >
                  <Ionicons name="gift-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.actionText}>
                    {item.is_comped
                      ? t('order.itemDetail.uncomp')
                      : t('order.itemDetail.comp')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.printHint}>
              {t('order.itemDetail.deletePrintsHint')}
            </Text>

            {/* ADR-035 — "Başka Masaya Taşı". Yalnız KAYDEDİLMİŞ ve iptal
                edilmemiş kalemde (bekleyen silme işaretli satır `cancelled`
                görünür → taşınamaz, sunucu da 409 verirdi). */}
            {canMove && item.status !== 'cancelled' ? (
              <View style={styles.moveBlock}>
                <Pressable
                  onPress={onMove}
                  disabled={isSaving || moveBlocked || dirty}
                  style={[
                    styles.moveBtn,
                    (isSaving || moveBlocked || dirty) && styles.moveBtnOff,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: isSaving || moveBlocked || dirty,
                  }}
                  accessibilityLabel={t('order.itemDetail.move')}
                >
                  <Ionicons
                    name="swap-horizontal"
                    size={18}
                    color={colors.textPrimary}
                  />
                  <Text style={styles.actionText}>
                    {t('order.itemDetail.move')}
                  </Text>
                </Pressable>
                {/* İki farklı engel, iki farklı çözüm: bu sheet'teki yerel giriş
                    (`dirty`) için ALTTAKİ Kaydet; adisyondaki bekleyen değişiklik
                    (`moveBlocked`) için sheet'i kapatıp adisyonun Kaydet'i. */}
                {dirty ? (
                  <Text style={styles.printHint}>
                    {t('order.itemDetail.moveDirtyHint')}
                  </Text>
                ) : moveBlocked ? (
                  <Text style={styles.printHint}>
                    {t('order.itemDetail.moveBlockedHint')}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          {/* Alt bar */}
          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              disabled={isSaving}
              style={[styles.footBtn, styles.footCancel]}
              accessibilityRole="button"
            >
              <Text style={styles.footCancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={isSaving || !dirty || !priceValid}
              style={[
                styles.footBtn,
                styles.footSave,
                (isSaving || !dirty || !priceValid) && styles.footSaveOff,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.footSaveText}>
                {isSaving
                  ? t('order.itemDetail.saving')
                  : t('order.itemDetail.save')}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  kav: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '90%',
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: {
    flex: 1,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
  },
  closeBtn: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
  },
  block: { marginTop: spacing.md, gap: spacing.xs },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.4 },
  qtyText: {
    minWidth: 32,
    textAlign: 'center',
    fontSize: typography.fontSize.xl,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
  },
  variantGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  variantChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  variantChipOn: { borderColor: colors.accent, backgroundColor: colors.surface },
  variantText: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
  },
  variantTextOn: { color: colors.accent },
  priceInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
  },
  hint: { fontSize: typography.fontSize.xs, color: colors.textSecondary },
  totalRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  totalValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
  },
  noteInput: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: typography.fontSize.md,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  actionRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  dangerBtn: { borderColor: colors.danger },
  actionText: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
  },
  printHint: {
    marginTop: spacing.xs,
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
  },
  moveBlock: { marginTop: spacing.md },
  moveBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  moveBtnOff: { opacity: 0.4 },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footBtn: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  footCancel: { borderWidth: 1, borderColor: colors.border },
  footCancelText: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.bold,
    color: colors.textSecondary,
  },
  footSave: { backgroundColor: colors.accent },
  footSaveOff: { opacity: 0.5 },
  footSaveText: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.bold,
    color: colors.background,
  },
});
