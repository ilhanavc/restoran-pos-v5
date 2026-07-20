import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, minTouchTarget, radius, spacing } from '../../../theme';
import { visibleTableActions, type TableActionKind } from '../actions';

interface TableActionSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Region-local table label ("Masa 3") for the sheet title. */
  tableLabel: string;
  /** Active order id; drives which actions render (null → none). */
  orderId: string | null;
  onSelect: (action: TableActionKind) => void;
}

/** Ionicons glyph per action (ADR-026 K3 visual language). */
const ACTION_ICON: Record<TableActionKind, keyof typeof Ionicons.glyphMap> = {
  quickPay: 'flash',
  printBill: 'print-outline',
  moveTable: 'swap-horizontal-outline',
  mergeTable: 'git-merge-outline',
  cancelOrder: 'close-circle-outline',
};

/** Yıkıcı aksiyonlar — kırmızı stil + üstünde ayırıcı (ADR-027 Amd2 K8). */
const DESTRUCTIVE_ACTIONS: ReadonlySet<TableActionKind> = new Set([
  'cancelOrder',
]);

/**
 * 3-nokta operasyonel aksiyon sheet (ADR-027 K4 + ADR-026 K1 sheet paterni).
 *
 * Dolu masa kartının kebab'ı / Order başlığı 3-noktasından açılır — AdisyonSheet
 * ile aynı alt-sheet chrome'u (tutamak + başlık + X + backdrop). Render edilen
 * aksiyonlar {@link visibleTableActions} TEK kaynağından gelir (K6 açık gating):
 * Hızlı Öde · Adisyon Yazdır · Masayı Değiştir · Adisyon Aktar · Siparişi İptal
 * Et. İkram/müşteri-ata + Faz B masa yönetimi HİÇ render edilmez. Parasal
 * aksiyon (Hızlı Öde) görsel olarak öne çıkar (koyu ikon rozeti); yıkıcı aksiyon
 * (İptal) en sonda, ayırıcıyla ve kırmızı stille durur (ADR-027 Amd2 K8).
 */
export function TableActionSheet({
  visible,
  onClose,
  tableLabel,
  orderId,
  onSelect,
}: TableActionSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const actions = visibleTableActions(orderId);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityElementsHidden
      />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {t('order.actions.title', { table: tableLabel })}
            </Text>
            <Pressable
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          </View>

          {actions.map((action) => {
            const isPay = action === 'quickPay';
            const isDestructive = DESTRUCTIVE_ACTIONS.has(action);
            return (
              <Pressable
                key={action}
                style={({ pressed }) => [
                  styles.action,
                  isDestructive && styles.actionDestructive,
                  pressed && styles.actionPressed,
                ]}
                onPress={() => onSelect(action)}
                accessibilityRole="button"
                accessibilityLabel={t(`order.actions.${action}`)}
              >
                <View
                  style={[
                    styles.iconBadge,
                    isPay && styles.iconBadgePay,
                    isDestructive && styles.iconBadgeDestructive,
                  ]}
                >
                  <Ionicons
                    name={ACTION_ICON[action]}
                    size={22}
                    color={
                      isPay
                        ? colors.slateText
                        : isDestructive
                          ? colors.danger
                          : colors.slate
                    }
                  />
                </View>
                <Text
                  style={[
                    styles.actionLabel,
                    isDestructive && styles.actionLabelDestructive,
                  ]}
                  numberOfLines={1}
                >
                  {t(`order.actions.${action}`)}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={colors.textSecondary}
                />
              </Pressable>
            );
          })}
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
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  actionPressed: {
    opacity: 0.6,
  },
  // Yıkıcı aksiyon: üstünde belirgin ayırıcı + kırmızı dil. Listenin sonunda
  // durur ki normal iş akışında yanlışlıkla dokunulmasın (ADR-027 Amd2 K8).
  actionDestructive: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  iconBadgeDestructive: {
    backgroundColor: '#fee2e2',
  },
  actionLabelDestructive: {
    color: colors.danger,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  iconBadgePay: {
    backgroundColor: colors.slate,
  },
  actionLabel: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
