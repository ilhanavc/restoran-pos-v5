import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus, Platform } from 'react-native';

/**
 * M10-A-02 — TanStack Query'yi React Native ağ + odak durumuna bağlar (resmi RN
 * reçetesi). Web'de tarayıcı `online`/`focus` olayları otomatik; RN'de bunlar
 * YOK, bu yüzden elle köprülenir:
 *   - online durumu `@react-native-community/netinfo`'dan (WiFi/veri var mı),
 *   - odak durumu RN `AppState`'ten (uygulama ön planda mı).
 * Offline'da query refetch durur; bağlantı/odak geri gelince otomatik resync.
 * (Mutation davranışı queryClient'ta `networkMode:'always'` ile ayrıdır —
 * sipariş/ödeme yolu offline'da bile denenir, idempotency-key duplikasyonu önler.)
 *
 * Idempotent: `App.tsx` boot'unda bir kez çağrılır; tekrar çağrı no-op.
 */
let wired = false;

export function setupNetworkManagers(): void {
  if (wired) return;
  wired = true;

  // NetInfo bağlantı olaylarını onlineManager'a köprüle. Uçtan-uca erişilebilirlik
  // (`isInternetReachable`) öncelikli; `null` → link-layer `isConnected`'e düş
  // ("WiFi bağlı ama ISP/cloud kesik" senaryosunda query'ler online sanılmasın).
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isInternetReachable ?? Boolean(state.isConnected));
    }),
  );

  // AppState 'active' → odak; arka plandan dönüşte bayat query'ler tazelenir.
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        if (Platform.OS !== 'web') {
          handleFocus(status === 'active');
        }
      },
    );
    return () => {
      subscription.remove();
    };
  });
}
