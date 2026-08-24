import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@restoran-pos/shared-domain';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  buttonHeight,
  colors,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from '../../theme';

export type PlannedPaymentType = 'cash' | 'card';

interface PaymentTypeSheetProps {
  visible: boolean;
  customerName: string;
  totalCents: number;
  selected: PlannedPaymentType | null;
  onSelect: (type: PlannedPaymentType) => void;
  onClose: () => void;
  onConfirm: () => void;
  saving: boolean;
  /**
   * Kaydetme hatası — SATIR-İÇİ gösterilir, toast DEĞİL. RN'de bir Modal
   * görünürken toast onun ALTINDA kalır ve hiç görünmez
   * ([[feedback_rn_modal_layout_traps]]); garson "tuş çalışmadı" sanıp ikinci
   * kez basar. Idempotency key retry'da aynı kaldığı için ikinci basış zarar
   * vermez, ama belirsizlik yine de kabul edilemez.
   */
  errorMessage: string | null;
}

/**
 * Paket akışı — **3. adım: ödeme tipi** (ADR-039 K5 adım 4, ADR-017 kontratı).
 *
 * Bu bir TAHSİLAT değil, bir PLANLAMADIR (`planned_payment_type`): para
 * hareketi teslimde, web tarafında gerçekleşir (K6 asimetrisi). Bu yüzden
 * ekranda "Öde" değil "Kaydet" yazar ve tutar bilgi amaçlı gösterilir.
 *
 * `transfer` sunulmaz: DB enum'unda var, paket MVP akışında yok (ADR-017 §UI).
 */
export function PaymentTypeSheet({
  visible,
  customerName,
  totalCents,
  selected,
  onSelect,
  onClose,
  onConfirm,
  saving,
  errorMessage,
}: PaymentTypeSheetProps): React.JSX.Element {
  const { t } = useTranslation();

  const options: Array<{
    type: PlannedPaymentType;
    icon: React.ComponentProps<typeof Ionicons>['name'];
  }> = [
    { type: 'cash', icon: 'cash-outline' },
    { type: 'card', icon: 'card-outline' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('takeaway.payment.title')}</Text>
            <Pressable
              style={styles.iconButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          </View>

          <Text style={styles.summary} numberOfLines={1}>
            {t('takeaway.payment.summary', {
              customer: customerName,
              total: formatMoney(totalCents),
            })}
          </Text>

          <View style={styles.options}>
            {options.map((option) => {
              const isSelected = selected === option.type;
              return (
                <Pressable
                  key={option.type}
                  style={[
                    styles.option,
                    isSelected && styles.optionSelected,
                  ]}
                  onPress={() => onSelect(option.type)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={t(`takeaway.payment.${option.type}`)}
                >
                  <Ionicons
                    name={option.icon}
                    size={24}
                    color={isSelected ? colors.slateText : colors.textPrimary}
                  />
                  <Text
                    style={[
                      styles.optionText,
                      isSelected && styles.optionTextSelected,
                    ]}
                  >
                    {t(`takeaway.payment.${option.type}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {errorMessage !== null ? (
            <Text style={styles.errorText}>{errorMessage}</Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.confirmButton,
              (saving || selected === null) && styles.confirmDisabled,
              pressed && !saving && selected !== null && styles.confirmPressed,
            ]}
            onPress={onConfirm}
            disabled={saving || selected === null}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving || selected === null }}
            accessibilityLabel={t('takeaway.payment.confirm')}
          >
            {saving ? (
              <>
                <ActivityIndicator color={colors.slateText} />
                <Text style={styles.confirmText}>
                  {t('takeaway.payment.saving')}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.confirmText}>
                  {t('takeaway.payment.confirm')}
                </Text>
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={colors.slateText}
                />
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
  },
  options: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: buttonHeight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  optionText: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  optionTextSelected: {
    color: colors.slateText,
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.danger,
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: buttonHeight,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
  },
  confirmPressed: {
    opacity: 0.85,
  },
  confirmDisabled: {
    opacity: 0.5,
  },
  confirmText: {
    color: colors.slateText,
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
  },
});
