import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { useNetworkOffline } from '../realtime/useNetworkOffline';
import { colors, spacing } from '../theme';

/**
 * M10-A-02 — Kalıcı çevrimdışı göstergesi (POS checklist: "sync durumu sürekli
 * ekranda + internet yokluğunda görünür uyarı"). Garson sorunu 15sn timeout
 * beklemeden anında görür. Ağ durumu mantığı `useNetworkOffline`'da
 * (ConnectionBanner ile paylaşılır — Amd5 hci-fix).
 *
 * `App.tsx`'te normal flex-akış elemanı olarak render edilir (absolute DEĞİL) →
 * içeriği aşağı iter, ekran header'larını ÖRTMEZ (hci gate). Üst inset'i
 * TÜKETMEZ: tek tüketici App kabuğundaki SafeAreaView'dur (Amd5 hci-fix —
 * üç katmanlı inset yığılması buradan doğmuştu). Bağlıyken null döner.
 * i18n-key'li (mobil %100 disiplin). `accessibilityRole="alert"` ile
 * ekran-okuyucuya bildirilir.
 */
export function OfflineBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const offline = useNetworkOffline();

  if (!offline) {
    return null;
  }

  return (
    <View style={styles.wrap} pointerEvents="none" accessibilityRole="alert">
      <Text style={styles.text} numberOfLines={2}>
        {t('common.offline')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
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
