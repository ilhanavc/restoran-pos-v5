import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@restoran-pos/shared-domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PaymentMethod } from '../../api/payments';
import { genIdempotencyKey } from '../../api/uuid';
import { colors, buttonHeight, minTouchTarget, radius, spacing } from '../../theme';
import { buildQuickPayRequest } from './paymentRequest';
import { useQuickPay, useSplitState } from './queries';

interface QuickPaySheetProps {
  visible: boolean;
  onClose: () => void;
  tableLabel: string;
  orderId: string;
  /** Called after the payment succeeds (order closed). */
  onPaid: () => void;
}

/**
 * Hızlı Öde alt-sheet (ADR-027 K3/K4 — tek-dokunuş tam tahsilat + K3 onay).
 *
 * İki aşama: (1) yöntem seçimi (Nakit/Kart), (2) **hafif onay** (ADR-027 K3 —
 * aksiyon-öncesi tek-dokunuş onay: yanlış-tahsilat koruması). Onaylanınca tam
 * kalan tutar `pay_and_close` ile tahsil edilir ve masa kapanır. Tutar otoritesi
 * split-state (`remainingTotalCents`) — kart üzerindeki eski toplamla değil,
 * canlı kalanla ödenir. Idempotency-Key aşama-2 girişinde üretilir ve retry'de
 * korunur (çift-tahsilat koruması). Split/kısmi/bahşiş bu sheet'te YOK (v5.1).
 */
export function QuickPaySheet({
  visible,
  onClose,
  tableLabel,
  orderId,
  onPaid,
}: QuickPaySheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const splitStateQuery = useSplitState(visible ? orderId : null);
  const payMutation = useQuickPay();

  const [stage, setStage] = useState<'method' | 'confirm'>('method');
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  // Stable across retries of the same attempt (replay-safe); reset per attempt.
  const idempotencyKeyRef = useRef<string | null>(null);

  // Fresh sheet on each open: back to method selection, clear prior error/success.
  // `payMutation.reset` is stable (TanStack), so `visible` is the only trigger.
  useEffect(() => {
    if (visible) {
      setStage('method');
      setMethod(null);
      idempotencyKeyRef.current = null;
      payMutation.reset();
    }
  }, [visible]);

  const remaining = splitStateQuery.data?.remainingTotalCents ?? 0;
  const methodLabel =
    method === 'cash'
      ? t('payment.method.cash')
      : method === 'card'
        ? t('payment.method.card')
        : '';

  function chooseMethod(next: PaymentMethod): void {
    setMethod(next);
    idempotencyKeyRef.current = genIdempotencyKey();
    setStage('confirm');
  }

  function submit(): void {
    if (method === null || remaining <= 0) {
      return;
    }
    const request = buildQuickPayRequest({
      orderId,
      method,
      remainingCents: remaining,
      idempotencyKey: idempotencyKeyRef.current ?? undefined,
    });
    idempotencyKeyRef.current = request.idempotencyKey;
    payMutation.mutate(request, { onSuccess: () => onPaid() });
  }

  // Ödeme işlenirken sheet'i HİÇBİR yoldan kapatma (backdrop / X / Android geri):
  // sonuç (başarı/hata) görünür kalmalı — sessiz kayıp + belirsiz tekrar-deneme
  // önlenir. İşlem 15 sn transport timeout'unda kesin sonlanır (http.ts).
  function handleClose(): void {
    if (payMutation.isPending) {
      return;
    }
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdrop}
        onPress={handleClose}
        accessibilityElementsHidden
      />
      <SafeAreaView style={styles.sheetWrap} edges={['bottom']} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {t('payment.quick.title')} · {tableLabel}
            </Text>
            <Pressable
              style={styles.closeBtn}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          </View>

          {splitStateQuery.isPending ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={colors.slate} />
              <Text style={styles.centerText}>{t('payment.quick.loading')}</Text>
            </View>
          ) : splitStateQuery.isError ? (
            <View style={styles.centerBox}>
              <Text style={styles.centerText}>{t('payment.quick.error')}</Text>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => {
                  void splitStateQuery.refetch();
                }}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
              >
                <Text style={styles.secondaryText}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : remaining <= 0 ? (
            <View style={styles.centerBox}>
              <Text style={styles.centerText}>{t('payment.quick.noBalance')}</Text>
              <Pressable
                style={styles.secondaryBtn}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Text style={styles.secondaryText}>{t('common.close')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.amountBox}>
                <Text style={styles.amountLabel}>
                  {t('payment.quick.amountLabel')}
                </Text>
                <Text style={styles.amountValue}>{formatMoney(remaining)}</Text>
              </View>

              {stage === 'method' ? (
                <>
                  <Text style={styles.prompt}>{t('payment.quick.chooseMethod')}</Text>
                  <View style={styles.methodRow}>
                    <Pressable
                      style={({ pressed }) => [styles.methodBtn, pressed && styles.pressed]}
                      onPress={() => chooseMethod('cash')}
                      accessibilityRole="button"
                      accessibilityLabel={t('payment.method.cash')}
                    >
                      <Ionicons name="cash-outline" size={26} color={colors.slate} />
                      <Text style={styles.methodText}>{t('payment.method.cash')}</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.methodBtn, pressed && styles.pressed]}
                      onPress={() => chooseMethod('card')}
                      accessibilityRole="button"
                      accessibilityLabel={t('payment.method.card')}
                    >
                      <Ionicons name="card-outline" size={26} color={colors.slate} />
                      <Text style={styles.methodText}>{t('payment.method.card')}</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.confirmMessage}>
                    {t('payment.confirm.message', {
                      amount: formatMoney(remaining),
                      method: methodLabel,
                    })}
                  </Text>
                  {payMutation.isError ? (
                    <Text style={styles.errorText}>{t('payment.confirm.error')}</Text>
                  ) : null}
                  <View style={styles.confirmRow}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        styles.confirmBtn,
                        pressed && styles.pressed,
                        payMutation.isPending && styles.disabled,
                      ]}
                      onPress={() => setStage('method')}
                      disabled={payMutation.isPending}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: payMutation.isPending }}
                      accessibilityLabel={t('payment.confirm.back')}
                    >
                      <Text style={styles.secondaryText}>
                        {t('payment.confirm.back')}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryBtn,
                        styles.confirmBtn,
                        pressed && styles.pressed,
                        payMutation.isPending && styles.disabled,
                      ]}
                      onPress={submit}
                      disabled={payMutation.isPending}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: payMutation.isPending }}
                      accessibilityLabel={t('payment.confirm.confirm')}
                    >
                      {payMutation.isPending ? (
                        <>
                          <ActivityIndicator color={colors.slateText} />
                          <Text style={styles.primaryText}>
                            {t('payment.confirm.processing')}
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.primaryText}>
                          {t('payment.confirm.confirm')}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </>
              )}
            </>
          )}
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
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
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
  centerBox: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  centerText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  amountBox: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  amountLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  amountValue: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  prompt: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  methodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  methodBtn: {
    flex: 1,
    minHeight: 88,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  methodText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  confirmMessage: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  confirmBtn: {
    flex: 1,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: buttonHeight,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  primaryText: {
    color: colors.slateText,
    fontSize: 17,
    fontWeight: '800',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: buttonHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
});
