import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@restoran-pos/shared-domain';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ApiOrderItem } from '../../../api/orders';
import { colors, minTouchTarget, radius, spacing } from '../../../theme';
import type { CartLine } from '../cart';
import { canWaiterEditOrderItem } from '../gating';
import { QtyStepper } from './QtyStepper';

interface AdisyonSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Region-local table label ("Masa 3") for the sheet title. */
  tableLabel: string;
  /** Saved items already on the bill (read-only in PR-5c). */
  existingItems: ApiOrderItem[];
  existingTotalCents: number;
  /** Logged-in waiter id — drives the K6 edit gate on saved items. */
  currentUserId: string | null;
  /** Pending local additions (editable). */
  cartLines: CartLine[];
  pendingSubtotalCents: number;
  onIncrement: (rowId: string) => void;
  onDecrement: (rowId: string) => void;
  onRemove: (rowId: string) => void;
}

/**
 * Adisyon bottom-sheet (ADR-026 K2).
 *
 * Opened from the header cart icon. Shows what is already on the table's bill
 * (saved items — read-only here; editing them is PR-5d) followed by the waiter's
 * pending additions (editable via the vertical stepper + a trash to drop a line
 * outright). The grand total sums both. There is NO "Kaydet" button in the sheet
 * — it lives in the Order screen's persistent bar (K7) — and NO kitchen-status
 * label (Hazır/Mutfakta) is shown to the waiter. Unauthorised actions (pay /
 * cancel / comp / transfer / print) are never rendered (K6).
 */
export function AdisyonSheet({
  visible,
  onClose,
  tableLabel,
  existingItems,
  existingTotalCents,
  currentUserId,
  cartLines,
  pendingSubtotalCents,
  onIncrement,
  onDecrement,
  onRemove,
}: AdisyonSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const hasExisting = existingItems.length > 0;
  const hasPending = cartLines.length > 0;
  const grandTotalCents = existingTotalCents + pendingSubtotalCents;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityElementsHidden />
      <SafeAreaView style={styles.sheetWrap} edges={['bottom']} pointerEvents="box-none">
        <View style={styles.sheet}>
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
                  {existingItems.map((item) => {
                    // K6: the waiter's own, not-yet-sent items stay full-opacity
                    // (they become editable in PR-5d); kitchen-sent items and
                    // other waiters' items are locked (dimmed, read-only).
                    const locked = !canWaiterEditOrderItem(item, currentUserId);
                    return (
                    <View
                      key={item.id}
                      style={[styles.row, locked && styles.rowReadOnly]}
                    >
                      <View style={styles.savedQty}>
                        <Text style={styles.savedQtyText}>{item.quantity}×</Text>
                      </View>
                      <View style={styles.rowBody}>
                        <Text style={styles.rowName} numberOfLines={2}>
                          {item.product_name}
                        </Text>
                        {item.variant_name_snapshot !== null ? (
                          <Text style={styles.rowVariant}>
                            {item.variant_name_snapshot}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.rowPrice}>
                        {formatMoney(item.total_cents)}
                      </Text>
                    </View>
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
                      <View style={styles.rowBody}>
                        <Text style={styles.rowName} numberOfLines={2}>
                          {line.productName}
                        </Text>
                        {line.variantName !== null ? (
                          <Text style={styles.rowVariant}>{line.variantName}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.rowPrice}>
                        {formatMoney(line.unitPriceCents * line.quantity)}
                      </Text>
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
        </View>
      </SafeAreaView>
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
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
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
  rowReadOnly: {
    opacity: 0.75,
  },
  savedQty: {
    width: 30 + 8,
    alignItems: 'center',
  },
  savedQtyText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rowBody: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  rowVariant: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  rowPrice: {
    fontSize: 15,
    fontWeight: '700',
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
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
});
