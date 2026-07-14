import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../theme';

/**
 * M10-A-02 — Kalıcı çevrimdışı göstergesi (POS checklist: "sync durumu sürekli
 * ekranda + internet yokluğunda görünür uyarı"). Garson sorunu 15sn timeout
 * beklemeden anında görür.
 *
 * `App.tsx`'te normal flex-akış elemanı olarak render edilir (absolute DEĞİL) →
 * içeriği aşağı iter, ekran header'larını ÖRTMEZ (hci gate). Bağlıyken null
 * döner. i18n-key'li (mobil %100 disiplin). `accessibilityRole="alert"` ile
 * ekran-okuyucuya bildirilir.
 */
export function OfflineBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // Uçtan-uca erişilebilirlik (`isInternetReachable`) öncelikli; `null`
      // (henüz bilinmiyor) → link-layer `isConnected`'e düş. "WiFi bağlı ama
      // ISP/cloud kesik" (restoranda sık) senaryosunu da yakalar. `null` iken
      // bant gösterilmez (yanlış alarm yok).
      const reachable = state.isInternetReachable ?? state.isConnected;
      setOffline(reachable === false);
    });
    return unsubscribe;
  }, []);

  if (!offline) {
    return null;
  }

  return (
    <SafeAreaView
      style={styles.wrap}
      edges={['top']}
      pointerEvents="none"
      accessibilityRole="alert"
    >
      <Text style={styles.text} numberOfLines={2}>
        {t('common.offline')}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.danger,
  },
  text: {
    color: colors.slateText,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
});
