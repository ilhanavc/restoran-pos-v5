import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { useNetworkOffline } from '../realtime/useNetworkOffline';
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
 * Amd5 hci-fix: (1) üst inset'i TÜKETMEZ — tek tüketici App kabuğu; (2) ağ
 * tamamen kesikken render ETMEZ: o durumda `OfflineBanner` zaten görünür,
 * "İnternet yok" + "Sunucu yok" ikilisi aynı anda çıkarak kafa karıştırmasın.
 * Bu bant yalnız "internet var ama sunucuya ulaşılamıyor" durumunu anlatır.
 *
 * Soket durumunun kaynağı DEĞİŞMEDİ (`useSocketStatus`; Amd1/Amd2 mekanizması
 * korunur). Ekran-okuyucuya yalnız kritik geçişte ('disconnected') duyurulur —
 * her durum değişiminde konuşup dikkat dağıtmaz (Amd2 hci-gate kararı).
 */
export function ConnectionBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const status = useSocketStatus();
  const networkOffline = useNetworkOffline();

  // Dinamik i18n-key kullanılmaz (tarayıcı literal key ister).
  const label =
    status === 'connecting'
      ? t('common.connection.connecting')
      : t('common.connection.offline');

  const visible = status !== 'connected' && !networkOffline;

  useEffect(() => {
    if (visible && status === 'disconnected') {
      AccessibilityInfo.announceForAccessibility(label);
    }
  }, [visible, status, label]);

  if (!visible) {
    return null;
  }

  const isConnecting = status === 'connecting';
  return (
    <View
      style={[
        styles.wrap,
        isConnecting ? styles.wrapConnecting : styles.wrapOffline,
      ]}
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
    </View>
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
