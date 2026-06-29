import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../navigation/types';
import {
  useSettingsStore,
  type ProductColumns,
} from '../store/settings';
import { colors, minTouchTarget, radius, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const COLUMN_OPTIONS: ProductColumns[] = [2, 3];

/**
 * Ayarlar (Settings) screen (ADR-026 Amendment 2026-06-29 D).
 *
 * A minimal, display-only settings surface — currently just the Order screen's
 * product grid column count (2 = roomy, 3 = dense). It is reached from a gear
 * icon on the Masalar header. Per the amendment this is a pure display
 * preference, not an operational/admin action, so it does not breach the K6
 * gating. Logout stays on the Masalar header (K9).
 */
export function SettingsScreen({ navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const productColumns = useSettingsStore((state) => state.productColumns);
  const setProductColumns = useSettingsStore(
    (state) => state.setProductColumns,
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('order.header.back')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.slateText} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('settings.title')}
        </Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.body}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('settings.productColumns.label')}</Text>
          <Text style={styles.rowHint}>{t('settings.productColumns.hint')}</Text>
          <View style={styles.segment}>
            {COLUMN_OPTIONS.map((option) => {
              const isSelected = productColumns === option;
              return (
                <Pressable
                  key={option}
                  style={[
                    styles.segmentButton,
                    isSelected && styles.segmentButtonActive,
                  ]}
                  onPress={() => {
                    void setProductColumns(option);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={t('settings.productColumns.option', {
                    count: option,
                  })}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      isSelected && styles.segmentTextActive,
                    ]}
                  >
                    {t('settings.productColumns.option', { count: option })}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.slate,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.slateText,
    fontSize: 18,
    fontWeight: '700',
  },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    padding: spacing.md,
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rowHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  segment: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segmentButton: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: colors.slate,
    borderColor: colors.slate,
  },
  segmentText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  segmentTextActive: {
    color: colors.slateText,
  },
});
