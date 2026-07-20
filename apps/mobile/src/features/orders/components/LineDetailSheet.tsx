import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@restoran-pos/shared-domain';
import type { ProductWithVariants } from '@restoran-pos/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
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

import type {
  AttributeOptionRow,
  EffectiveAttributeGroupRow,
} from '../../../api/schemas';
import {
  colors,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from '../../../theme';
import type { CartLine, CartLineAttribute, CartLineEdit } from '../cart';
import { useEffectiveAttributeGroups } from '../queries';

interface LineDetailSheetProps {
  /** The pending cart line being edited; `null` closes the sheet. */
  line: CartLine | null;
  /** The line's product (variants + base price); `null` while the menu loads. */
  product: ProductWithVariants | null;
  onClose: () => void;
  onSave: (edit: CartLineEdit) => void;
}

/** Shared empty set for read-only `.has()` fallbacks (no per-render allocation). */
const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

const MAX_NOTE = 280;
// hitSlop lifts the 44pt qty buttons past the 52pt HCI target (44 + 2×8 = 60);
// QtyStepper.tsx applies the same idiom (hci-gate Y4).
const HIT_SLOP = 8;

/**
 * Satır-detay modalı — "Porsiyon ve Özellikler" (ADR-026 Amendment 3 K2/K7).
 *
 * Web `OrderProductDetailModal` muadili, RN bottom-sheet idiomuyla (AdisyonSheet
 * deseni). Yalnız PENDING satır düzenlenir (K3). Sıra: Adet stepper → Porsiyon
 * (>=2 varyant kart-grid / ==1 bilgi satırı / 0 gizli) → Özellikler (single=tek
 * seçim, multiple=çoklu; is_required işaret; +₺ etiketi) → Not (280) → alt bar
 * "adet × birim = toplam" + Vazgeç/Kaydet. Fiyat CLIENT'ta yalnız GÖSTERİM (K5);
 * otorite sunucuda. Özellik verisi mevcut menü endpoint'inden (K5, yeni endpoint
 * yok). Kaydet, `onSave` ile cart.updateLine'ı çağırır (K4 birleştirme). Sheet
 * KeyboardAvoidingView içinde — Not alanı açılınca Kaydet klavye arkasında
 * kalmaz (hci-gate B1).
 *
 * KAPATMA (hci-gate B2 revize — ürün sahibi, 2026-07-20): backdrop artık
 * kapatır, ama KOŞULLU. B2'nin özgün gerekçesi "onaysız veri kaybı"ydı ve
 * geçerli; çözüm backdrop'u ölü bırakmak yerine kirliliğe bakmak: değişiklik
 * yoksa arkaplan dokunuşu doğrudan kapatır (tek çıkışın küçük bir X olması
 * rahatsız ediciydi), değişiklik varsa onay sorulur. Sipariş ekranının dolu
 * sepetle çıkışta onay sorması (ADR-026 K4) ile aynı desen.
 */
/**
 * Sheet durumunun belirlenimli imzası — kirlilik karşılaştırması için.
 * Seçenek kimlikleri sıralanır ki seçim SIRASI sahte fark üretmesin.
 */
function stateSignature(
  quantity: number,
  variantId: string | null,
  selections: Record<string, Set<string>>,
  note: string,
): string {
  const attrs = Object.keys(selections)
    .sort()
    .map((groupId) => `${groupId}:${[...(selections[groupId] ?? [])].sort().join('+')}`)
    .join(',');
  return `${quantity}|${variantId ?? ''}|${attrs}|${note.trim()}`;
}

export function LineDetailSheet({
  line,
  product,
  onClose,
  onSave,
}: LineDetailSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const groupsQuery = useEffectiveAttributeGroups(product?.id ?? null);
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);

  const variants = product?.variants ?? [];
  const basePrice = product?.priceCents ?? 0;

  const [quantity, setQuantity] = useState(1);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null,
  );
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  /**
   * Sheet AÇILDIĞI ANDAKİ durumun imzası (kirlilik tabanı).
   *
   * Kalemin ham değerleriyle karşılaştırmak YANLIŞ olurdu: açılışta grupların
   * `is_default` seçenekleri otomatik işaretleniyor, dolayısıyla hızlı-eklenmiş
   * (özelliksiz) bir kalemde kullanıcı hiçbir şeye dokunmadan "değişmiş"
   * görünürdü ve her arkaplan dokunuşunda boş yere onay sorulurdu.
   */
  const baselineRef = useRef<string>('');

  // Re-seed the qty / porsiyon / note whenever a new line opens (line identity).
  useEffect(() => {
    if (line === null) {
      return;
    }
    setQuantity(line.quantity);
    setNote(line.note ?? '');
    const vs = product?.variants ?? [];
    const defaultVariant = vs.find((v) => v.isDefault) ?? vs[0] ?? null;
    setSelectedVariantId(line.variantId ?? defaultVariant?.id ?? null);
    setErrors({});
  }, [line, product]);

  // Seed the attribute selections from the line, else the groups' defaults
  // (is_default). Runs again once the async groups resolve (K5).
  useEffect(() => {
    if (line === null) {
      return;
    }
    const init: Record<string, Set<string>> = {};
    for (const g of groups) {
      const set = new Set<string>();
      const chosen = line.selectedAttributes.filter((a) => a.groupId === g.id);
      if (chosen.length > 0) {
        for (const a of chosen) set.add(a.optionId);
      } else {
        for (const opt of g.options) {
          if (!opt.is_default) continue;
          if (g.selection_type === 'single') {
            if (set.size === 0) set.add(opt.id);
          } else {
            set.add(opt.id);
          }
        }
      }
      init[g.id] = set;
    }
    setSelections(init);

    // Taban imza: bu effect seçenekleri, üstteki effect adet/porsiyon/notu
    // TOHUMLAR — ikisi de `line`'a bağlı olduğundan aynı turda çalışır.
    const vs = product?.variants ?? [];
    const seededVariantId =
      line.variantId ?? (vs.find((v) => v.isDefault) ?? vs[0])?.id ?? null;
    baselineRef.current = stateSignature(
      line.quantity,
      seededVariantId,
      init,
      line.note ?? '',
    );
  }, [line, groups, product]);

  function toggleOption(group: EffectiveAttributeGroupRow, optionId: string): void {
    setSelections((prev) => {
      const cur = new Set(prev[group.id] ?? []);
      if (group.selection_type === 'single') {
        // Tek-seçim: aynı seçeneğe tekrar dokunmak seçimi kaldırır (radyo davranışı).
        if (cur.has(optionId)) {
          cur.clear();
        } else {
          cur.clear();
          cur.add(optionId);
        }
      } else if (cur.has(optionId)) {
        cur.delete(optionId);
      } else {
        cur.add(optionId);
      }
      return { ...prev, [group.id]: cur };
    });
    setErrors((prev) => {
      if (prev[group.id] !== true) return prev;
      const next = { ...prev };
      delete next[group.id];
      return next;
    });
  }

  const totalExtraCents = useMemo(() => {
    let sum = 0;
    for (const g of groups) {
      const sel = selections[g.id];
      if (sel === undefined) continue;
      for (const opt of g.options) {
        if (sel.has(opt.id)) sum += opt.extra_price_cents;
      }
    }
    return sum;
  }, [groups, selections]);

  const selectedVariant =
    variants.find((v) => v.id === selectedVariantId) ?? null;
  const variantDelta = selectedVariant?.priceDeltaCents ?? 0;
  const unitPriceCents = basePrice + variantDelta + totalExtraCents;
  const lineTotalCents = unitPriceCents * quantity;

  /**
   * Kapatma isteği (X · backdrop · Android geri). Kaydedilmemiş değişiklik
   * varsa onay sorar, yoksa doğrudan kapatır (hci-gate B2 revizyonu).
   */
  function requestClose(): void {
    const dirty =
      stateSignature(quantity, selectedVariantId, selections, note) !==
      baselineRef.current;
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert(
      t('order.attributes.discardTitle'),
      t('order.attributes.discardBody'),
      [
        { text: t('order.attributes.discardStay'), style: 'cancel' },
        {
          text: t('order.attributes.discardLeave'),
          style: 'destructive',
          onPress: onClose,
        },
      ],
    );
  }

  // Kaydet, özellikler yüklenirken/hataya düşünce kilitlenir — kaydedilen kalem
  // eksik/yanlış özellikle sunucuya gitmesin (hci-gate Y2). Grup yoksa açık.
  const attrsBlocked = groupsQuery.isLoading || groupsQuery.isError;
  const hasRequiredError = Object.keys(errors).length > 0;

  function handleSave(): void {
    if (product === null || line === null) return;
    // is_required grupta boş seçim → satır-içi hata; kaydetmeden dur (web paritesi).
    const nextErrors: Record<string, boolean> = {};
    for (const g of groups) {
      if (g.is_required && (selections[g.id]?.size ?? 0) === 0) {
        nextErrors[g.id] = true;
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const optById = new Map<string, AttributeOptionRow>();
    for (const g of groups) for (const opt of g.options) optById.set(opt.id, opt);

    const flat: CartLineAttribute[] = [];
    for (const g of groups) {
      const sel = selections[g.id];
      if (sel === undefined) continue;
      for (const optId of sel) {
        const opt = optById.get(optId);
        if (opt === undefined) continue;
        flat.push({
          groupId: g.id,
          optionId: opt.id,
          optionName: opt.name,
          extraPriceCents: opt.extra_price_cents,
        });
      }
    }

    const trimmedNote = note.trim();
    onSave({
      variantId: selectedVariantId,
      variantName: selectedVariant?.name ?? null,
      unitPriceCents,
      quantity,
      selectedAttributes: flat,
      note: trimmedNote === '' ? null : trimmedNote,
    });
  }

  return (
    <Modal
      visible={line !== null}
      animationType="slide"
      transparent
      onRequestClose={requestClose}
      accessibilityViewIsModal
    >
      {/* B2 revize: backdrop kapatır, ama kaydedilmemiş değişiklik varsa önce
          onay sorar (requestClose). */}
      <Pressable
        style={styles.backdrop}
        onPress={requestClose}
        accessibilityElementsHidden
      />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoidingWrap}
        >
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title} numberOfLines={1}>
                  {t('order.attributes.title')}
                </Text>
                <Text style={styles.productName} numberOfLines={1}>
                  {product?.name ?? ''}
                </Text>
              </View>
              <Pressable
                style={styles.closeBtn}
                onPress={requestClose}
                accessibilityRole="button"
                accessibilityLabel={t('order.attributes.cancel')}
              >
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {/* 1) Adet */}
              <View style={styles.qtyRow}>
                <Text style={styles.sectionLabel}>
                  {t('order.attributes.qtyLabel')}
                </Text>
                <View style={styles.qtyControl}>
                  <Pressable
                    style={styles.qtyBtn}
                    onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                    hitSlop={HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel={t('order.attributes.decrement')}
                  >
                    <Ionicons name="remove" size={22} color={colors.textPrimary} />
                  </Pressable>
                  <Text style={styles.qtyValue}>{quantity}</Text>
                  <Pressable
                    style={styles.qtyBtn}
                    onPress={() => setQuantity((q) => Math.min(99, q + 1))}
                    hitSlop={HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel={t('order.attributes.increment')}
                  >
                    <Ionicons name="add" size={22} color={colors.textPrimary} />
                  </Pressable>
                </View>
              </View>

              {/* 2) Porsiyon — >=2 kart-grid / ==1 bilgi satırı / 0 gizli (K2). */}
              {variants.length >= 2 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    {t('order.attributes.portionLabel')}
                  </Text>
                  <View style={styles.portionGrid}>
                    {variants.map((v) => {
                      const selected = v.id === selectedVariantId;
                      return (
                        <Pressable
                          key={v.id}
                          style={[
                            styles.portionCard,
                            selected && styles.cardSelected,
                          ]}
                          onPress={() => setSelectedVariantId(v.id)}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          accessibilityLabel={v.name}
                        >
                          <Text style={styles.portionName}>{v.name}</Text>
                          <Text style={styles.portionPrice}>
                            {formatMoney(basePrice + v.priceDeltaCents)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : variants.length === 1 && selectedVariant !== null ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    {t('order.attributes.portionLabel')}
                  </Text>
                  <Text style={styles.portionInfo}>
                    {selectedVariant.name} —{' '}
                    {formatMoney(basePrice + selectedVariant.priceDeltaCents)}
                  </Text>
                </View>
              ) : null}

              {/* 3) Özellikler — yüklenirken/hatada bilgi, boşsa bölüm gizli (K5). */}
              {groupsQuery.isLoading ? (
                <Text style={styles.infoText}>
                  {t('order.attributes.loading')}
                </Text>
              ) : groupsQuery.isError ? (
                <View style={styles.section}>
                  <Text style={styles.errorText}>
                    {t('order.attributes.loadFailed')}
                  </Text>
                  {/* Y1: yükleme hatası dead-end değil — Tekrar dene. */}
                  <Pressable
                    style={styles.retryBtn}
                    onPress={() => {
                      void groupsQuery.refetch();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.retry')}
                  >
                    <Ionicons name="refresh" size={16} color={colors.slateText} />
                    <Text style={styles.retryText}>
                      {t('common.retry')}
                    </Text>
                  </Pressable>
                </View>
              ) : groups.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    {t('order.attributes.sectionTitle')}
                  </Text>
                  {groups.map((group) => {
                    const sel = selections[group.id] ?? EMPTY_SELECTION;
                    const isSingle = group.selection_type === 'single';
                    const hasError = errors[group.id] === true;
                    return (
                      <View key={group.id} style={styles.group}>
                        <Text
                          style={[
                            styles.groupTitle,
                            hasError && styles.groupTitleError,
                          ]}
                        >
                          {group.name}
                          <Text style={styles.groupMeta}>
                            {'  '}
                            {isSingle
                              ? t('order.attributes.selectionSingle')
                              : t('order.attributes.selectionMultiple')}
                            {group.is_required
                              ? ` · ${t('order.attributes.requiredTag')}`
                              : ''}
                          </Text>
                        </Text>
                        {hasError ? (
                          <Text style={styles.groupError}>
                            {t('order.attributes.requiredError')}
                          </Text>
                        ) : null}
                        <View style={styles.optionGrid}>
                          {group.options.map((opt) => {
                            const selected = sel.has(opt.id);
                            return (
                              <Pressable
                                key={opt.id}
                                style={[
                                  styles.optionCard,
                                  selected && styles.cardSelected,
                                ]}
                                onPress={() => toggleOption(group, opt.id)}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                                accessibilityLabel={opt.name}
                              >
                                {selected ? (
                                  <Ionicons
                                    name="checkmark-circle"
                                    size={16}
                                    color={colors.slate}
                                  />
                                ) : null}
                                <View>
                                  <Text style={styles.optionName}>{opt.name}</Text>
                                  <Text style={styles.optionPrice}>
                                    {opt.extra_price_cents === 0
                                      ? t('order.attributes.free')
                                      : t('order.attributes.extraPrice', {
                                          amount: formatMoney(opt.extra_price_cents),
                                        })}
                                  </Text>
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {/* 4) Ürün notu */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  {t('order.attributes.noteLabel')}
                </Text>
                <TextInput
                  style={styles.noteInput}
                  value={note}
                  onChangeText={setNote}
                  maxLength={MAX_NOTE}
                  placeholder={t('order.attributes.notePlaceholder')}
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>

            {/* O1: zorunlu seçim eksikse alt barda her-zaman-görünür tek satır. */}
            {hasRequiredError ? (
              <Text style={styles.footerError}>
                {t('order.attributes.requiredFooter')}
              </Text>
            ) : null}

            {/* Alt bar — adet × birim = toplam + Vazgeç/Kaydet (K2). */}
            <View style={styles.footer}>
              <Text style={styles.footerSummary} numberOfLines={1}>
                {t('order.attributes.lineSummary', {
                  count: quantity,
                  unit: formatMoney(unitPriceCents),
                  total: formatMoney(lineTotalCents),
                })}
              </Text>
              <View style={styles.footerActions}>
                <Pressable
                  style={styles.cancelBtn}
                  onPress={requestClose}
                  accessibilityRole="button"
                  accessibilityLabel={t('order.attributes.cancel')}
                >
                  <Text style={styles.cancelText}>
                    {t('order.attributes.cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.saveBtn, attrsBlocked && styles.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={attrsBlocked}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: attrsBlocked }}
                  accessibilityLabel={t('order.attributes.save')}
                >
                  <Ionicons name="checkmark" size={20} color={colors.slateText} />
                  <Text style={styles.saveText}>
                    {t('order.attributes.save')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  // Sheet yüksekliği SARMALAYICIDA sabitlenir, sheet'in kendisinde DEĞİL:
  // yüzde değerler yalnız belirli-yükseklikli ebeveyne karşı çözülür.
  // KeyboardAvoidingView içerik-yükseklikli olduğundan yüzdeyi sheet'e koymak
  // (ilk deneme, 2026-07-20) sheet'i büyüttü ama arkaplan ekran dibine
  // uzanmadı — altta saydam şerit kalıp önceki ekran göründü (İlhan bulgusu).
  // Sarmalayıcı sheetWrap'e (flex:1 = tam ekran) karşı %80'e sabitlenir;
  // sheet onu doldurur → arkaplan dibe kadar opak, içerik uzunsa içeride
  // kayar (body ScrollView).
  avoidingWrap: {
    height: '80%',
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  // Tipografi: büyütme (İlhan, 2026-07-20 — sheet "küçük" geri bildirimi).
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  productName: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    // flex:1 — sabit-yükseklikli sheet'te boş alanı gövde yutar, footer
    // (Vazgeç/Kaydet) her zaman sheet'in dibinde durur.
    flex: 1,
  },
  bodyContent: {
    paddingBottom: spacing.md,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  section: {
    marginTop: spacing.md,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  qtyBtn: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.md,
    backgroundColor: colors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: {
    minWidth: 32,
    textAlign: 'center',
    fontSize: typography.fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  portionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  portionCard: {
    minWidth: 120,
    minHeight: minTouchTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portionName: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  portionPrice: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
    marginTop: 2,
  },
  portionInfo: {
    fontSize: typography.fontSize.lg,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  cardSelected: {
    borderColor: colors.slate,
    backgroundColor: colors.surface,
  },
  group: {
    marginBottom: spacing.md,
  },
  groupTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  groupTitleError: {
    color: colors.danger,
  },
  groupMeta: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  groupError: {
    fontSize: 12,
    color: colors.danger,
    marginBottom: spacing.xs,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: minTouchTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  optionName: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  optionPrice: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginTop: 1,
  },
  noteInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: typography.fontSize.lg,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  infoText: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: 14,
    color: colors.danger,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.slate,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.slateText,
  },
  footerError: {
    fontSize: 12,
    color: colors.danger,
    paddingTop: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerSummary: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cancelBtn: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.slateText,
  },
});
