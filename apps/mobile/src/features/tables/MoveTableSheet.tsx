import { Ionicons } from '@expo/vector-icons';
import { tableDisplayNo } from '@restoran-pos/shared-domain';
import { useEffect, useMemo, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { isApiError } from '../../api/errors';
import type { ApiTable } from '../../api/tables';
import {
  buttonHeight,
  colors,
  minTouchTarget,
  radius,
  spacing,
} from '../../theme';
import { useAreas, useMoveTable, useTables } from './queries';

interface MoveTableSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Order being moved. */
  orderId: string;
  /** Source table id — excluded from the picker. */
  sourceTableId: string;
  /** Region-local label of the source table ("Masa 3") for the confirm prompt. */
  sourceTableLabel: string;
  /** Called after the order is successfully moved. */
  onMoved: () => void;
}

/** An empty target table grouped under a region for the picker. */
interface TargetGroup {
  /** Area id or null (orphan / "Bölgesiz"). */
  areaId: string | null;
  areaName: string;
  tables: ApiTable[];
}

/**
 * Masayı Değiştir alt-sheet (ADR-028 Karar H).
 *
 * İki aşama: (1) hedef-masa seçici — YALNIZ boş (available + aktif sipariş yok)
 * masalar, bölgeye göre gruplu, kaynak masa hariç; (2) hafif onay ("Masa X →
 * Masa Y taşınsın mı?"). Onaylanınca `PATCH /orders/:orderId/table` çağrılır ve
 * başarıda `['tables']`+`['orders']` invalidate edilir (queries.useMoveTable).
 * Hedef masa eşzamanlı dolduysa (409 TABLE_ALREADY_OCCUPIED) net "artık dolu"
 * mesajı gösterilir ve liste yenilenir — seçici gerçeği yansıtsın. Masa taşıma
 * parasal DEĞİL; QuickPay'in idempotency-key koruması gerekmez (taşıma
 * idempotent: aynı hedefe yeniden = aynı masa reddi).
 */
export function MoveTableSheet({
  visible,
  onClose,
  orderId,
  sourceTableId,
  sourceTableLabel,
  onMoved,
}: MoveTableSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const tablesQuery = useTables();
  const areasQuery = useAreas();
  const moveMutation = useMoveTable();

  const [stage, setStage] = useState<'picker' | 'confirm'>('picker');
  const [target, setTarget] = useState<ApiTable | null>(null);

  // Fresh sheet on each open: back to the picker, clear prior selection/error.
  useEffect(() => {
    if (visible) {
      setStage('picker');
      setTarget(null);
      moveMutation.reset();
    }
  }, [visible]);

  // Boş (available + aktif sipariş yok) masalar, kaynak hariç, bölgeye göre
  // gruplu; bölgeler areasQuery sırasına, orphan grubu en sona. Web paritesi.
  const groups = useMemo<TargetGroup[]>(() => {
    const tables = tablesQuery.data ?? [];
    const areas = areasQuery.data ?? [];
    const empty = tables.filter(
      (tbl) =>
        tbl.status === 'available' &&
        tbl.active_order_id === null &&
        tbl.id !== sourceTableId,
    );
    const byArea = new Map<string | null, ApiTable[]>();
    for (const tbl of empty) {
      const list = byArea.get(tbl.area_id);
      if (list === undefined) {
        byArea.set(tbl.area_id, [tbl]);
      } else {
        list.push(tbl);
      }
    }
    const result: TargetGroup[] = [];
    for (const area of areas) {
      const list = byArea.get(area.id);
      if (list !== undefined && list.length > 0) {
        result.push({ areaId: area.id, areaName: area.name, tables: list });
      }
    }
    const orphans = byArea.get(null);
    if (orphans !== undefined && orphans.length > 0) {
      result.push({
        areaId: null,
        areaName: t('tables.group.unassigned'),
        tables: orphans,
      });
    }
    return result;
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
    if (target === null) {
      return;
    }
    const targetTableId = target.id;
    moveMutation.mutate(
      { orderId, tableId: targetTableId },
      {
        onSuccess: () => onMoved(),
        onError: (error) => {
          // Hata mesajı confirm aşamasında görünür kalır (Karar H req 4) —
          // stage/target sıfırlanmaz. Hedef eşzamanlı doldu → listeyi arka
          // planda tazele ki "Geri" sonrası seçici gerçeği yansıtsın.
          if (isApiError(error) && error.code === 'TABLE_ALREADY_OCCUPIED') {
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
    moveMutation.error !== null &&
    isApiError(moveMutation.error) &&
    moveMutation.error.code === 'TABLE_ALREADY_OCCUPIED'
      ? t('tables.move.occupied')
      : t('tables.move.error');

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
      <SafeAreaView
        style={styles.sheetWrap}
        edges={['bottom']}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {t('tables.move.title')} · {sourceTableLabel}
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
              <Text style={styles.centerText}>{t('tables.move.loading')}</Text>
            </View>
          ) : isError ? (
            <View style={styles.centerBox}>
              <Text style={styles.centerText}>{t('tables.move.loadError')}</Text>
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
                {t('tables.move.confirmMessage', {
                  source: sourceTableLabel,
                  target: labelFor(target),
                })}
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
                  accessibilityLabel={t('tables.move.back')}
                >
                  <Text style={styles.secondaryText}>
                    {t('tables.move.back')}
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
                  accessibilityLabel={t('tables.move.confirm')}
                >
                  {moveMutation.isPending ? (
                    <>
                      <ActivityIndicator color={colors.slateText} />
                      <Text style={styles.primaryText}>
                        {t('tables.move.moving')}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.primaryText}>
                      {t('tables.move.confirm')}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          ) : groups.length === 0 ? (
            <View style={styles.centerBox}>
              <Text style={styles.centerText}>{t('tables.move.noEmpty')}</Text>
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
              <Text style={styles.prompt}>{t('tables.move.choosePrompt')}</Text>
              <ScrollView
                style={styles.pickerScroll}
                contentContainerStyle={styles.pickerContent}
              >
                {groups.map((group) => (
                  <View key={group.areaId ?? '__orphan__'} style={styles.group}>
                    <Text style={styles.groupTitle}>{group.areaName}</Text>
                    <View style={styles.tableGrid}>
                      {group.tables.map((tbl) => (
                        <Pressable
                          key={tbl.id}
                          style={({ pressed }) => [
                            styles.tableBtn,
                            pressed && styles.pressed,
                          ]}
                          onPress={() => chooseTable(tbl)}
                          accessibilityRole="button"
                          accessibilityLabel={labelFor(tbl)}
                        >
                          <Text style={styles.tableBtnText} numberOfLines={1}>
                            {labelFor(tbl)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
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
  pickerScroll: {
    flexGrow: 0,
  },
  pickerContent: {
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  group: {
    gap: spacing.sm,
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  tableGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tableBtn: {
    minWidth: 88,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableBtnText: {
    fontSize: 16,
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
