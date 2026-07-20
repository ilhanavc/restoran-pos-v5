import { Ionicons } from '@expo/vector-icons';
import {
  OrderCancelReasonSchema,
  type OrderCancelReason,
} from '@restoran-pos/shared-types';
import { useEffect, useState } from 'react';
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

import {
  buttonHeight,
  colors,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from '../../../theme';

interface CancelOrderSheetProps {
  visible: boolean;
  tableLabel: string;
  /** Kaç ürün iptal edilecek — kullanıcı ne kaybettiğini görsün. */
  itemCount: number;
  /** Mutfağa gitmiş kalem sayısı; > 0 ise ek uyarı gösterilir. */
  sentItemCount: number;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (reason: OrderCancelReason) => void;
}

/**
 * K7 — ön-tanımlı sebepler; sıra = ekrandaki çip sırası.
 *
 * Şemadan TÜRETİLİR, elle sayılmaz: liste mobil + web + sunucu doğrulaması
 * olmak üzere üç yerde kullanılıyor; elle kopyalanırsa biri değiştiğinde
 * diğerleri sessizce ayrışır (web'de seçilebilen bir sebep sunucuda 400 alır).
 */
const REASONS: readonly OrderCancelReason[] = OrderCancelReasonSchema.options;

/**
 * Adisyon iptali onay sheet'i (ADR-027 Amendment 2 K8).
 *
 * ÇİFT ONAY DEĞİL, TEK SEBEP EKRANI. "Emin misiniz?" tipi boş bir ikinci
 * dialog eklemek yerine sebep seçimi zorunlu tutuldu: seçim zaten ikinci
 * bilinçli dokunuştur ve boş onaydan farklı olarak KASIT KANITI üretir
 * (audit'e yazılır). Yanlış dokunuşa karşı koruma da bundan gelir.
 *
 * Sebep seçilene kadar "İptal Et" butonu PASİFtir (K7 — mobilde zorunlu).
 * Serbest metin yoktur: yoğun saatte klavye akışı keser, üstelik serbest alana
 * müşteri adı/telefonu yazılır ve denetim kaydı PII'ye bulaşır (KVKK).
 */
export function CancelOrderSheet({
  visible,
  tableLabel,
  itemCount,
  sentItemCount,
  submitting,
  onCancel,
  onConfirm,
}: CancelOrderSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<OrderCancelReason | null>(null);

  // Sheet her açılışta temiz başlar — önceki iptalin sebebi taşınmaz.
  useEffect(() => {
    if (visible) setReason(null);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={submitting ? undefined : onCancel}
      accessibilityViewIsModal
    >
      {/* Yıkıcı akış: backdrop dokunuşu kapatır (henüz bir şey olmadı), ama
          gönderim sürerken kilitli. */}
      <Pressable
        style={styles.backdrop}
        onPress={submitting ? undefined : onCancel}
        accessibilityElementsHidden
      />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.warnBadge}>
              <Ionicons name="alert" size={22} color={colors.danger} />
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {t('order.cancelOrder.title', { table: tableLabel })}
            </Text>
          </View>

          <Text style={styles.summary}>
            {t('order.cancelOrder.summary', { count: itemCount })}
          </Text>
          {sentItemCount > 0 ? (
            <View style={styles.kitchenWarn}>
              <Ionicons name="flame-outline" size={18} color={colors.danger} />
              <Text style={styles.kitchenWarnText}>
                {t('order.cancelOrder.kitchenWarning', { count: sentItemCount })}
              </Text>
            </View>
          ) : null}

          <Text style={styles.reasonLabel}>
            {t('order.cancelOrder.reasonLabel')}
          </Text>
          <ScrollView
            style={styles.reasonScroll}
            contentContainerStyle={styles.reasonList}
            showsVerticalScrollIndicator={false}
          >
            {REASONS.map((code) => {
              const selected = reason === code;
              return (
                <Pressable
                  key={code}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setReason(code)}
                  disabled={submitting}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={t(`order.cancelOrder.reason.${code}`)}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selected ? colors.danger : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      selected && styles.chipTextSelected,
                    ]}
                  >
                    {t(`order.cancelOrder.reason.${code}`)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={styles.dismissBtn}
              onPress={onCancel}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={t('order.cancelOrder.dismiss')}
            >
              <Text style={styles.dismissText}>
                {t('order.cancelOrder.dismiss')}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.confirmBtn,
                (reason === null || submitting) && styles.confirmBtnDisabled,
                pressed && reason !== null && !submitting
                  ? styles.confirmBtnPressed
                  : null,
              ]}
              onPress={() => {
                if (reason !== null) onConfirm(reason);
              }}
              disabled={reason === null || submitting}
              accessibilityRole="button"
              accessibilityState={{ disabled: reason === null || submitting }}
              accessibilityLabel={t('order.cancelOrder.confirm')}
            >
              {submitting ? (
                <ActivityIndicator color={colors.slateText} />
              ) : (
                <Text style={styles.confirmText}>
                  {t('order.cancelOrder.confirm')}
                </Text>
              )}
            </Pressable>
          </View>
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
    paddingHorizontal: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  warnBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: typography.fontSize.xl,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  summary: {
    marginTop: spacing.sm,
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
  },
  kitchenWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#fef2f2',
  },
  kitchenWarnText: {
    flex: 1,
    fontSize: typography.fontSize.md,
    fontWeight: '700',
    color: colors.danger,
  },
  reasonLabel: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reasonScroll: {
    flexGrow: 0,
  },
  reasonList: {
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipSelected: {
    borderColor: colors.danger,
    backgroundColor: '#fef2f2',
  },
  chipText: {
    flex: 1,
    fontSize: typography.fontSize.lg,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chipTextSelected: {
    fontWeight: '800',
    color: colors.danger,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  dismissBtn: {
    minHeight: buttonHeight,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  confirmBtn: {
    flex: 1,
    minHeight: buttonHeight,
    borderRadius: radius.lg,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnPressed: {
    opacity: 0.85,
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
    color: colors.slateText,
  },
});
