import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { OpenTakeawayOrder } from '../../api/schemas';
import {
  colors,
  minTouchTarget,
  radius,
  shadow,
  spacing,
  typography,
} from '../../theme';
import { nextStageAction } from './takeaway';

/**
 * Paket sipariş kartı — ADR-039 Amendment 2 K4/K15.
 *
 * Web muadili `apps/web/src/features/orders/components/TakeawayOrderCard.tsx`
 * **referanstır, kopya değil** (RN ≠ DOM). Web'den taşınan şey görsel DİL:
 * aşama rengine göre sol kenar şeridi + aynı renk değerleri (tema token'ı,
 * `takeawayPreparing`/`takeawayOutForDelivery` — web `--warning`/`--info` ile
 * birebir) ki aynı sipariş kasada ve mutfakta aynı renkte görünsün.
 *
 * Aksiyonlar kartın ÜSTÜNDE (ürün sahibinin istediği yerleşim). Tek aşama
 * butonu render edilir — `nextStageAction` tekil karar döndürür, iki buton
 * asla birlikte etkin olmaz (K6).
 *
 * ⚠️ ADR-020 K8 (daltonik): şerit tek başına bilgi taşımaz — aşama METİN
 * etiketi de kartta durur.
 */
export interface TakeawayQueueCardProps {
  order: OpenTakeawayOrder;
  /** Aşama ilerletme. `markDelivered` onay adımını ÇAĞIRAN tarafta geçer. */
  onAdvance: (order: OpenTakeawayOrder) => void;
  /**
   * Müşteriyi ara. **Verilmezse buton hiç render edilmez** — `kitchen` rolünde
   * numara hiçbir yoldan gelmediği için (ADR-039 Amd2 G2: KVKK maskesi +
   * `/customers/*` mutfağa kapalı) ekran bu prop'u geçmez.
   * Desen: [[feedback_readonly_reuse_live_component]] — yetkisiz aksiyonu
   * gizlemek için ayrı bir bileşen yazılmaz, handler verilmez.
   */
  onCall?: (order: OpenTakeawayOrder) => void;
  /** Bu kart için istek uçuyor — buton devre dışı + metin değişir. */
  busy: boolean;
}

function formatMoney(cents: number): string {
  return `${(cents / 100).toFixed(2)} ₺`;
}

export function TakeawayQueueCard({
  order,
  onAdvance,
  onCall,
  busy,
}: TakeawayQueueCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const action = nextStageAction(order.takeawayStage);
  const isOut = order.takeawayStage === 'out_for_delivery';

  const stripeColor = isOut
    ? colors.takeawayOutForDelivery
    : colors.takeawayPreparing;
  const stageLabel = isOut
    ? t('kitchen.takeawayQueue.stageOutForDelivery')
    : t('kitchen.takeawayQueue.stagePreparing');

  const actionLabel =
    action.kind === 'markOut'
      ? t('kitchen.takeawayQueue.markOut')
      : t('kitchen.takeawayQueue.markDelivered');

  return (
    <View style={styles.card}>
      {/* Sol kenar şeridi — aşama rengi (web kartının deseni). */}
      <View style={[styles.stripe, { backgroundColor: stripeColor }]} />

      <View style={styles.body}>
        {/* Aksiyon satırı — kartın ÜSTÜNDE (ürün sahibi yerleşimi). */}
        <View style={styles.actions}>
          {action.kind === 'none' ? null : (
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                { backgroundColor: stripeColor },
                (busy || pressed) && styles.actionButtonDim,
              ]}
              disabled={busy}
              onPress={() => onAdvance(order)}
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
            >
              <Text style={styles.actionButtonText} numberOfLines={1}>
                {actionLabel}
              </Text>
            </Pressable>
          )}

          {onCall === undefined ? null : (
            <Pressable
              style={({ pressed }) => [
                styles.callButton,
                pressed && styles.actionButtonDim,
              ]}
              onPress={() => onCall(order)}
              accessibilityRole="button"
              accessibilityLabel={t('kitchen.takeawayQueue.call')}
            >
              <Ionicons name="call-outline" size={18} color={colors.slate} />
              <Text style={styles.callButtonText}>
                {t('kitchen.takeawayQueue.call')}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Birincil: müşteri adı (K15.3 — en büyük, en ağır). */}
        <Text style={styles.customerName} numberOfLines={1}>
          {order.customerName ?? t('kitchen.takeawayQueue.noCustomer')}
        </Text>

        {/* İkincil: tutar + aşama etiketi (şeridin metin karşılığı). */}
        <View style={styles.metaRow}>
          <Text style={styles.total}>{formatMoney(order.totalCents)}</Text>
          <Text style={[styles.stageLabel, { color: stripeColor }]}>
            {stageLabel}
          </Text>
        </View>

        {/* Üçüncül: sipariş no — küçük, düşük kontrast, köşede. */}
        <Text style={styles.orderNo}>{`#${order.orderNo}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadow,
  },
  /** Şerit genişliği kasıtlı olarak ince: görsel çapa, aksiyon çağrısı değil. */
  stripe: {
    width: 5,
  },
  body: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  actionButton: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actionButtonDim: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: colors.slateText,
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.bold,
  },
  callButton: {
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  callButtonText: {
    color: colors.slate,
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.semibold,
  },
  customerName: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  total: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.semibold,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  stageLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.weight.semibold,
  },
  orderNo: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
});
