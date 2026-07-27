import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSocketStatus } from '../realtime/useSocketStatus';
import { colors, spacing } from '../theme';

/**
 * Bağlantı durumu bandı (ADR-026 Amendment 5 K4).
 *
 * Amd2'nin kalıcı "çevrimiçi" noktasının yerini alır: her şey yolundayken
 * HİÇBİR ŞEY göstermez (yeşil nokta ekran değerini hak etmiyordu), yalnız
 * kopuk/bağlanıyor durumunda ince bir bant çıkar. Sekme kabuğunda (`MainTabs`)
 * TEK yerde render edilir → dört sekmede de geçerlidir, ekranlara kopyalanmaz.
 *
 * Soket durumunun kaynağı DEĞİŞMEDİ (`useSocketStatus`; Amd1/Amd2 mekanizması
 * korunur). Ekran-okuyucuya yalnız kritik geçişte ('disconnected') duyurulur —
 * her durum değişiminde konuşup dikkat dağıtmaz (Amd2 hci-gate kararı).
 */
export function ConnectionBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const status = useSocketStatus();

  // Dinamik i18n-key kullanılmaz (tarayıcı literal key ister).
  const label =
    status === 'connecting'
      ? t('common.connection.connecting')
      : t('common.connection.offline');

  useEffect(() => {
    if (status === 'disconnected') {
      AccessibilityInfo.announceForAccessibility(label);
    }
  }, [status, label]);

  if (status === 'connected') {
    return null;
  }

  const isConnecting = status === 'connecting';
  return (
    <SafeAreaView
      style={[
        styles.wrap,
        isConnecting ? styles.wrapConnecting : styles.wrapOffline,
      ]}
      edges={['top']}
      pointerEvents="none"
      accessibilityRole="alert"
    >
      <Text
        style={[
          styles.text,
          isConnecting ? styles.textConnecting : styles.textOffline,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Akış elemanı (absolute DEĞİL) → içeriği aşağı iter, başlıkları örtmez
    // (OfflineBanner ile aynı desen).
    width: '100%',
  },
  wrapConnecting: {
    backgroundColor: colors.syncConnecting,
  },
  wrapOffline: {
    backgroundColor: colors.danger,
  },
  text: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  // Amber zeminde koyu metin, kırmızı zeminde beyaz — ikisi de AA üstü.
  textConnecting: {
    color: colors.textPrimary,
  },
  textOffline: {
    color: colors.slateText,
  },
});
