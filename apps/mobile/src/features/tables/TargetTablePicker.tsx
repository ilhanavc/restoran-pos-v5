import { formatMoney, tableDisplayNo } from '@restoran-pos/shared-domain';
import type { Area } from '@restoran-pos/shared-types';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ApiTable } from '../../api/tables';
import { colors, minTouchTarget, radius, spacing } from '../../theme';

/** Bölgeye göre gruplanmış hedef masalar (grup başlığı + kartlar). */
export interface TargetGroup {
  /** Bölge id'si veya `null` (bölgesiz orphan grup). */
  areaId: string | null;
  areaName: string;
  tables: ApiTable[];
}

/**
 * Aday masaları bölgeye göre gruplar — bölgeler `areas` sırasına, bölgesiz
 * orphan grup EN SONA (MergeTableSheet'ten çıkarıldı, davranış birebir aynı).
 *
 * Hangi masaların aday olduğuna ÇAĞIRAN karar verir: "Adisyon Aktar" yalnız
 * DOLU masaları, ADR-035 ürün taşıma ise DOLU ∪ BOŞ masaları geçirir (S3).
 *
 * @param candidates Filtrelenmiş aday masalar (kaynak masa çağıranda elenir).
 * @param areas Bölgeler — grup sırasını belirler.
 * @param unassignedLabel Bölgesiz grup başlığı (i18n'den gelir).
 */
export function groupTablesByArea(
  candidates: ApiTable[],
  areas: Area[],
  unassignedLabel: string,
): TargetGroup[] {
  const byArea = new Map<string | null, ApiTable[]>();
  for (const tbl of candidates) {
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
      areaName: unassignedLabel,
      tables: orphans,
    });
  }
  return result;
}

interface TargetTablePickerProps {
  groups: TargetGroup[];
  /**
   * BOŞ masada (tutar `null`) tutar yerine basılacak rozet. Verilmezse "—"
   * yazılır — "Adisyon Aktar" akışının bugünkü görünümü (o akışta aday zaten
   * hep dolu olduğu için pratikte hiç görünmez).
   */
  emptyBadge?: string;
  onSelect: (table: ApiTable) => void;
}

/**
 * Hedef-masa seçici ızgarası (web `TargetTablePicker` mobil ikizi).
 *
 * MergeTableSheet'in (ADR-029 K8) picker adımından ÇIKARILDI; ADR-035 S13
 * "hedef seçici MergeTableModal görünümü" kararı bu bileşenle karşılanır —
 * ürün taşıma akışı kendi seçicisini yazmaz, bunu kullanır.
 *
 * Saf sunum: aday seti + boş-durum kararı ÇAĞIRANIN (her sheet kendi boş-durum
 * metnini ve "Kapat" düğmesini korur). Kartta masa etiketi + adisyon tutarı;
 * tutarsız (boş) masada `emptyBadge`.
 */
export function TargetTablePicker({
  groups,
  emptyBadge,
  onSelect,
}: TargetTablePickerProps): React.JSX.Element {
  const { t } = useTranslation();

  function labelFor(tbl: ApiTable): string {
    const n = tableDisplayNo(tbl);
    return n !== null ? t('tables.tableLabel', { number: n }) : tbl.code;
  }

  return (
    <ScrollView style={styles.pickerScroll} contentContainerStyle={styles.pickerContent}>
      {groups.map((group) => (
        <View key={group.areaId ?? '__orphan__'} style={styles.group}>
          <Text style={styles.groupTitle}>{group.areaName}</Text>
          <View style={styles.tableGrid}>
            {group.tables.map((tbl) => {
              const totalCents = tbl.active_order_total_cents;
              return (
                <Pressable
                  key={tbl.id}
                  style={({ pressed }) => [
                    styles.tableBtn,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => onSelect(tbl)}
                  accessibilityRole="button"
                  accessibilityLabel={labelFor(tbl)}
                >
                  <Text style={styles.tableBtnText} numberOfLines={1}>
                    {labelFor(tbl)}
                  </Text>
                  <Text style={styles.tableBtnTotal} numberOfLines={1}>
                    {totalCents !== null
                      ? formatMoney(totalCents)
                      : emptyBadge ?? '—'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
    minWidth: 96,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tableBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  tableBtnTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.7,
  },
});
