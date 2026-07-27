import { Ionicons } from '@expo/vector-icons';
import { tableDisplayNo } from '@restoran-pos/shared-domain';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isApiError } from '../../../api/errors';
import type { ApiOrderItem } from '../../../api/orders';
import type { ApiTable } from '../../../api/tables';
import {
  buttonHeight,
  colors,
  minTouchTarget,
  radius,
  spacing,
} from '../../../theme';
import {
  TargetTablePicker,
  groupTablesByArea,
  type TargetGroup,
} from '../../tables/TargetTablePicker';
import { useAreas, useTables } from '../../tables/queries';
import { useMoveOrderItem } from '../queries';

interface MoveItemToTableSheetProps {
  visible: boolean;
  /** Taşınacak KAYITLI kalem (sunucu gerçeği); null iken sheet render edilmez. */
  item: ApiOrderItem | null;
  /** Kaynak (kalemin şu anki) sipariş id'si. */
  sourceOrderId: string | null;
  /** Kaynak masa id'si — hedef listeden hariç tutulur (ITEM_MOVE_SAME_ORDER). */
  sourceTableId: string;
  /** Kaynak masanın bölge-yerel etiketi ("Masa 3") — başlık/onay metni için. */
  sourceTableLabel: string;
  onClose: () => void;
  /** Başarı — hedef masanın etiketiyle çağrılır (çağıran sheet'i kapatıp toast basar). */
  onMoved: (targetTableLabel: string) => void;
}

/**
 * Kalem taşıma hata kodu → i18n anahtarı. Sunucunun bu uçta üretebildiği 12
 * kodun TAMAMI + yetki (403) + mobil taşıma katmanının `NETWORK_ERROR`'ı
 * karşılanır; eşleşmeyen kod jenerik `order.moveItem.error`a düşer (çıplak
 * anahtar kullanıcıya asla görünmez).
 */
const MOVE_ITEM_ERROR_KEY: Record<string, string> = {
  ORDER_NOT_FOUND: 'order.moveItem.errors.ORDER_NOT_FOUND',
  ORDER_ITEM_NOT_FOUND: 'order.moveItem.errors.ORDER_ITEM_NOT_FOUND',
  TABLE_NOT_FOUND: 'order.moveItem.errors.TABLE_NOT_FOUND',
  ITEM_MOVE_SAME_ORDER: 'order.moveItem.errors.ITEM_MOVE_SAME_ORDER',
  ORDER_NOT_DINE_IN: 'order.moveItem.errors.ORDER_NOT_DINE_IN',
  ORDER_ALREADY_CLOSED: 'order.moveItem.errors.ORDER_ALREADY_CLOSED',
  ORDER_ITEM_NOT_MOVABLE: 'order.moveItem.errors.ORDER_ITEM_NOT_MOVABLE',
  ORDER_ITEM_ALREADY_PAID: 'order.moveItem.errors.ORDER_ITEM_ALREADY_PAID',
  ORDER_TOTAL_BELOW_PAID: 'order.moveItem.errors.ORDER_TOTAL_BELOW_PAID',
  ORDER_MOVE_CROSS_DAY: 'order.moveItem.errors.ORDER_MOVE_CROSS_DAY',
  MERGE_TARGET_NOT_OCCUPIED: 'order.moveItem.errors.MERGE_TARGET_NOT_OCCUPIED',
  TABLE_ALREADY_OCCUPIED: 'order.moveItem.errors.TABLE_ALREADY_OCCUPIED',
  AUTH_FORBIDDEN: 'order.moveItem.errors.AUTH_FORBIDDEN',
  NETWORK_ERROR: 'order.moveItem.errors.NETWORK_ERROR',
};

/** Hedef masanın durumu yarışta değişti → liste tazelenmeli (seçici gerçeği görsün). */
const STALE_TARGET_CODES: ReadonlySet<string> = new Set([
  'MERGE_TARGET_NOT_OCCUPIED',
  'TABLE_ALREADY_OCCUPIED',
  'ORDER_ALREADY_CLOSED',
  'ORDER_ITEM_NOT_FOUND',
]);

/**
 * "Ürünü Başka Masaya Taşı" alt-sheet'i — ADR-035 S13/S14 (Faz 1b, mobil).
 *
 * Web `MoveItemToTableModal` ikizi, MergeTableSheet iki-aşama deseniyle:
 * (1) hedef-masa seçici — DOLU ∪ BOŞ masalar (S3; boş hedefte sunucu yeni
 * adisyon açar, kartta "Boş" rozeti bunu seçmeden ÖNCE söyler), kaynak masa
 * hariç, `reserved`/`cleaning` masalar aday değil (Masayı Değiştir sınırıyla
 * aynı); (2) hafif onay + "fiş basılmaz" notu (S4). Onayda
 * `POST /orders/:orderId/items/:itemId/move` çağrılır ve ANINDA uygulanır —
 * bekleyen (staged) düzenleme katmanına yazmaz (S13; çağıran, kaydedilmemiş
 * değişiklik varken "Taşı"yı zaten kapalı tutar).
 *
 * Seçici bileşeni "Adisyon Aktar" ile ORTAK (`TargetTablePicker`); tek fark
 * aday filtresi ve `emptyBadge`.
 *
 * ⚠️ Geri bildirim: hata mesajı sheet'in İÇİNDE gösterilir, toast DEĞİL — RN'de
 * Modal her şeyin üstünde çizildiği için sheet açıkken toast görünmez ve
 * kullanıcı "tuş çalışmıyor" sanır (S104 canlı dersi, CancelOrderSheet ile aynı
 * çözüm). Başarı ise sheet KAPANDIKTAN sonra çağıranın toast'ıyla bildirilir.
 */
export function MoveItemToTableSheet({
  visible,
  item,
  sourceOrderId,
  sourceTableId,
  sourceTableLabel,
  onClose,
  onMoved,
}: MoveItemToTableSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tablesQuery = useTables();
  const areasQuery = useAreas();
  const moveMutation = useMoveOrderItem();

  const [stage, setStage] = useState<'picker' | 'confirm'>('picker');
  const [target, setTarget] = useState<ApiTable | null>(null);

  // Her açılışta taze sheet: seçiciye dön, eski seçim/hata temizlensin.
  useEffect(() => {
    if (visible) {
      setStage('picker');
      setTarget(null);
      moveMutation.reset();
    }
  }, [visible]);

  // Adaylar = DOLU (aktif adisyonu olan) ∪ BOŞ (available) masalar, kaynak
  // hariç — "Masayı Değiştir" (boş) ile "Adisyon Aktar" (dolu) akışlarının
  // birleşimi (S3). `reserved`/`cleaning` masalar hedef değildir.
  const groups = useMemo<TargetGroup[]>(() => {
    const candidates = (tablesQuery.data ?? []).filter(
      (tbl) =>
        tbl.id !== sourceTableId &&
        (tbl.active_order_id !== null || tbl.status === 'available'),
    );
    return groupTablesByArea(
      candidates,
      areasQuery.data ?? [],
      t('tables.group.unassigned'),
    );
  }, [tablesQuery.data, areasQuery.data, sourceTableId, t]);

  function labelFor(tbl: ApiTable): string {
    const n = tableDisplayNo(tbl);
    return n !== null ? t('tables.tableLabel', { number: n }) : tbl.code;
  }

  function chooseTable(tbl: ApiTable): void {
    setTarget(tbl);
    setStage('confirm');
  }

  function submit(): void {
    if (target === null || item === null || sourceOrderId === null) {
      return;
    }
    const targetLabel = labelFor(target);
    moveMutation.mutate(
      { orderId: sourceOrderId, itemId: item.id, targetTableId: target.id },
      {
        onSuccess: () => onMoved(targetLabel),
        onError: (error) => {
          // Hata onay aşamasında GÖRÜNÜR kalır (sheet kapanmaz) — kullanıcı
          // sebebi okur, "Geri" ile başka masa seçebilir. Yarış hatalarında
          // masa listesi arka planda tazelenir ki seçici gerçeği yansıtsın.
          if (isApiError(error) && STALE_TARGET_CODES.has(error.code)) {
            void tablesQuery.refetch();
          }
        },
      },
    );
  }

  // Taşıma işlenirken sheet'i kapatma (sonuç görünür kalsın).
  function handleClose(): void {
    if (moveMutation.isPending) {
      return;
    }
    onClose();
  }

  const isLoading = tablesQuery.isPending || areasQuery.isPending;
  const isError = tablesQuery.isError || areasQuery.isError;
  const errorMessage =
    moveMutation.error !== null && isApiError(moveMutation.error)
      ? t(MOVE_ITEM_ERROR_KEY[moveMutation.error.code] ?? 'order.moveItem.error')
      : t('order.moveItem.error');

  if (item === null) {
    return <Modal visible={false} transparent />;
  }

  const targetIsEmpty = target !== null && target.active_order_id === null;

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
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {t('order.moveItem.title')} · {sourceTableLabel}
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

          {isLoading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={colors.slate} />
              <Text style={styles.centerText}>
                {t('order.moveItem.loading')}
              </Text>
            </View>
          ) : isError ? (
            <View style={styles.centerBox}>
              <Text style={styles.centerText}>
                {t('order.moveItem.loadError')}
              </Text>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => {
                  void tablesQuery.refetch();
                  void areasQuery.refetch();
                }}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
              >
                <Text style={styles.secondaryText}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : stage === 'confirm' && target !== null ? (
            <>
              <Text style={styles.confirmMessage}>
                {t('order.moveItem.confirmMessage', {
                  qty: item.quantity,
                  item: item.product_name,
                  source: sourceTableLabel,
                  target: labelFor(target),
                })}
              </Text>
              {/* S3 — boş hedefte yeni adisyon açılacağı ÖNCEDEN söylenir. */}
              {targetIsEmpty ? (
                <Text style={styles.confirmHint}>
                  {t('order.moveItem.confirmNoteEmptyTable')}
                </Text>
              ) : null}
              {/* S4 — yazıcı davranışı açıkça söylenir: fiş BASILMAZ. */}
              <Text style={styles.confirmHint}>
                {t('order.moveItem.confirmNoteNoPrint')}
              </Text>
              {moveMutation.isError ? (
                <Text style={styles.errorText}>{errorMessage}</Text>
              ) : null}
              <View style={styles.confirmRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    styles.confirmBtn,
                    pressed && styles.pressed,
                    moveMutation.isPending && styles.disabled,
                  ]}
                  onPress={() => setStage('picker')}
                  disabled={moveMutation.isPending}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: moveMutation.isPending }}
                  accessibilityLabel={t('order.moveItem.back')}
                >
                  <Text style={styles.secondaryText}>
                    {t('order.moveItem.back')}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    styles.confirmBtn,
                    pressed && styles.pressed,
                    moveMutation.isPending && styles.disabled,
                  ]}
                  onPress={submit}
                  disabled={moveMutation.isPending}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: moveMutation.isPending }}
                  accessibilityLabel={t('order.moveItem.confirm')}
                >
                  {moveMutation.isPending ? (
                    <>
                      <ActivityIndicator color={colors.slateText} />
                      <Text style={styles.primaryText}>
                        {t('order.moveItem.moving')}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.primaryText}>
                      {t('order.moveItem.confirm')}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          ) : groups.length === 0 ? (
            <View style={styles.centerBox}>
              <Text style={styles.centerText}>
                {t('order.moveItem.noTarget')}
              </Text>
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
              <Text style={styles.prompt}>
                {t('order.moveItem.choosePrompt', { item: item.product_name })}
              </Text>
              <TargetTablePicker
                groups={groups}
                emptyBadge={t('order.moveItem.emptyTableBadge')}
                onSelect={chooseTable}
              />
            </>
          )}
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
    paddingBottom: spacing.md,
    maxHeight: '80%',
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
  prompt: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  confirmMessage: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  confirmHint: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
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
    marginTop: spacing.xs,
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
    backgroundColor: colors.slate,
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
