import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStore } from '../store/auth';
import { colors, minTouchTarget, spacing } from '../theme';

/**
 * Tables placeholder (ADR-026 K2).
 *
 * PR-5a deliberately ships no real table grid (that is PR-5b). Its purpose is
 * to prove the auth-gated navigation loop on a phone: dark-slate header,
 * top-right logout icon → `authStore.logout()` clears secure-store and routes
 * back to Login. All user-visible text via `t()`.
 */
export function TablesScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const logout = useAuthStore((state) => state.logout);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('tables.title')}</Text>
        <Pressable
          style={styles.logoutButton}
          onPress={() => {
            void logout();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('tables.logoutAriaLabel')}
        >
          <Ionicons name="log-out-outline" size={24} color={colors.slateText} />
        </Pressable>
      </View>

      <View style={styles.body}>
        <Text style={styles.comingSoon}>{t('tables.comingSoon')}</Text>
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    color: colors.slateText,
    fontSize: 20,
    fontWeight: '700',
  },
  logoutButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  comingSoon: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
