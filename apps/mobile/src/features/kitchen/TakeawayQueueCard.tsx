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
        {/*
          Kimlik satırı — hci kapısı bulgusu (S130, Nielsen #5 hata önleme):
          aksiyon butonu kartın ÜSTÜNDE olduğu için (ürün sahibi yerleşimi)
          kullanıcı HANGİ siparişe bastığını ancak bastıktan sonra görüyordu.
          "Teslimata Çıkarıldı" adımında onay YOK ve sıralı akış tek yönlü →
          yanlış karta basmanın geri dönüşü olmaz. Bu tek satır, kimliği
          butonun ÜSTÜNE taşır; asıl kimlik bloğu aşağıda aynen kalır.
        */}
        <Text style={styles.identityLine} numberOfLines={1}>
          {`#${order.orderNo} · ${
            order.customerName ?? t('kitchen.takeawayQueue.noCustomer')
          }`}
        </Text>

        {/* Aksiyon satırı — kartın ÜSTÜNDE (ürün sahibi yerleşimi). */}
        <View style={styles.actions}>
          {action.kind === 'none' ? null : (
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                (busy || pressed) && styles.actionButtonDim,
              ]}
              disabled={busy}
              onPress={() => onAdvance(order)}
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
            >
              {/* İki satıra izin verilir: web-parite etiketi ("Teslimata
                  Çıkarıldı") dar telefonda tek satıra sığmayabilir; kırpmak
                  yerine sarmalanır. */}
              <Text style={styles.actionButtonText} numberOfLines={2}>
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
          <Text style={styles.stageLabel}>{stageLabel}</Text>
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
  /** Kimlik önizlemesi: küçük, düşük kontrast — asıl başlık aşağıda. */
  identityLine: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.weight.semibold,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  /**
   * Dolgu `accent` — aşama rengi DEĞİL. Aşama rengi beyaz metinle 2.87:1
   * veriyordu (hci kapısı, S130); `accent` 5.91:1. Renk sinyali şeritte kalır,
   * buton metni her koşulda okunur.
   */
  actionButton: {
    flex: 1,
    backgroundColor: colors.accent,
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
    textAlign: 'center',
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
  /** Nötr renk: aşama rengi beyaz zeminde 2.87:1 ile okunmuyordu. */
  stageLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.weight.semibold,
    color: colors.textSecondary,
  },
  orderNo: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
});
