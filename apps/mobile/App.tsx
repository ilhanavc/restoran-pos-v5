import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import './src/i18n/init';

/**
 * Minimal first-run screen (ADR-025 İş Kalemi 4 — skeleton only).
 *
 * Intentionally NOT a real screen: navigation, login, table list and order
 * entry are İş Kalemi 5. This proves the Expo Go boot path (Metro monorepo
 * resolution + i18n + safe-area) on a physical phone with the lowest possible
 * first-run risk. All user-visible text goes through `t()` (no hardcoded TR).
 */
export default function App(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.content}>
          <Text style={styles.title}>{t('app.title')}</Text>
          <Text style={styles.subtitle}>{t('app.subtitle')}</Text>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
});
