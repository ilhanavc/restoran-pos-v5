import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Cihazın ağ erişilebilirliği — `true` ise internet YOK (M10-A-02).
 *
 * Mantık `OfflineBanner` içinden buraya çıkarıldı (hci-gate bulgusu): iki
 * banner aynı anda "İnternet yok" + "Sunucu bağlantısı yok" diye konuşmasın
 * diye `ConnectionBanner` de aynı kaynağı okumak zorunda. Yeni bağımlılık
 * yok — zaten kurulu `@react-native-community/netinfo`.
 *
 * Uçtan-uca erişilebilirlik (`isInternetReachable`) önceliklidir; `null`
 * (henüz bilinmiyor) iken link-layer `isConnected`'e düşülür. Bu, restoranda
 * sık görülen "WiFi bağlı ama ISP/cloud kesik" durumunu da yakalar. `null`
 * iken çevrimdışı SAYILMAZ (yanlış alarm yok).
 */
export function useNetworkOffline(): boolean {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable ?? state.isConnected;
      setOffline(reachable === false);
    });
    return unsubscribe;
  }, []);

  return offline;
}
