import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import './src/i18n/init';
import { queryClient } from './src/api/queryClient';
import type { RootStackParamList } from './src/navigation/types';
import { connectSocket, disconnectSocket } from './src/realtime/socket';
import { setupNetworkManagers } from './src/realtime/network';
import { OfflineBanner } from './src/components/OfflineBanner';
import { LoginScreen } from './src/screens/LoginScreen';
import { OrderScreen } from './src/screens/OrderScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TablesScreen } from './src/screens/TablesScreen';
import { useAuthStore } from './src/store/auth';
import { useSettingsStore } from './src/store/settings';
import { colors } from './src/theme';

/**
 * Realtime bridge (ADR-010 §11.6 + ADR-026 Amendment 2026-06-29 PR-5d D).
 *
 * Owns the socket lifecycle against the auth state: connects on login (and on a
 * hydrated session), disconnects on logout, and re-arms on a silent token
 * rotation (the effect re-runs when `accessToken` changes). The backend has no
 * `tables.statusChanged` event, so masa liveness is derived INDIRECTLY from
 * `orders.*`: any order create / cancel / status change invalidates the tables
 * board (and open-order queries) so the cards refresh — including the waiter's
 * own "Kaydet". Payloads are not parsed (only invalidate), which side-steps the
 * dine-in `takeawayStage: null` payload-schema mismatch. Renders nothing.
 */
function RealtimeBridge(): null {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const accessToken = useAuthStore((state) => state.accessToken);

  useEffect(() => {
    if (!isAuthenticated || accessToken === null) {
      disconnectSocket();
      return;
    }
    const socket = connectSocket(accessToken);
    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      // ADR-010 §11.6 Amendment (2026-07-01) — bölge pill'leri de tazelensin
      // (admin masa/bölge CRUD board sync).
      void queryClient.invalidateQueries({ queryKey: ['areas'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      // A teammate closing/paying a table changes its split-state too (ADR-027).
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      // ADR-010 §11.6 Amendment 3 (2026-07-01) — admin menü CRUD katalog sync.
      // Mobil menü query'leri 5 dk staleTime taşır; invalidate baypas edip
      // katalogu anında tazeler (products.changed/categories.changed sonrası).
      void queryClient.invalidateQueries({ queryKey: ['menu', 'products'] });
      void queryClient.invalidateQueries({ queryKey: ['menu', 'categories'] });
    };
    socket.on('orders.created', invalidate);
    socket.on('orders.cancelled', invalidate);
    socket.on('orders.statusChanged', invalidate);
    // ADR-010 §11.6 Amendment (2026-07-01) — admin masa/bölge CRUD board sync.
    socket.on('tables.changed', invalidate);
    socket.on('areas.changed', invalidate);
    // ADR-010 §11.6 Amendment 3 (2026-07-01) — admin menü CRUD katalog sync.
    socket.on('products.changed', invalidate);
    socket.on('categories.changed', invalidate);
    // M10-A-03 — reconnect sonrası tam-resync: WiFi kesintisinde kaçan event'ler
    // (Socket.IO kopukluk sırasındakileri replay etmez) telafisiz kalmasın;
    // 'connect'te tüm board (tables/areas/orders/payments/menu) tazelenir →
    // sessiz-bayat ekran kapanır.
    socket.on('connect', invalidate);
    // ADR-026 Amendment 1 K3 — returning to the foreground nudges a dead
    // socket immediately instead of waiting out the reconnect backoff (1–5 s);
    // the 'connect' handler above then runs the full resync.
    const appStateSubscription = AppState.addEventListener('change', (status) => {
      if (status === 'active' && !socket.connected) {
        socket.connect();
      }
    });
    return () => {
      appStateSubscription.remove();
      socket.off('orders.created', invalidate);
      socket.off('orders.cancelled', invalidate);
      socket.off('orders.statusChanged', invalidate);
      socket.off('tables.changed', invalidate);
      socket.off('areas.changed', invalidate);
      socket.off('products.changed', invalidate);
      socket.off('categories.changed', invalidate);
      socket.off('connect', invalidate);
    };
  }, [isAuthenticated, accessToken, queryClient]);

  return null;
}

/**
 * Root component (ADR-026 K1/K4).
 *
 * SafeAreaProvider > GestureHandlerRootView > QueryClientProvider >
 * NavigationContainer > native stack. The stack is auth-gated against the
 * Zustand auth store: only the relevant screen(s) are mounted, so a successful
 * login (or logout) swaps the stack with no manual navigation call. Server
 * state (tables, areas, ...) is owned by a single module-level TanStack Query
 * client (ADR-026 K4). On boot we hydrate tokens from secure-store before
 * rendering the gate; until then a plain background fills the screen (light
 * StatusBar content would be invisible on the white body, so we use dark icons).
 */
const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App(): React.JSX.Element {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrateSettings = useSettingsStore((state) => state.hydrate);
  const [hydrated, setHydrated] = useState(false);

  // M10-A-02 — TanStack Query'yi RN ağ/odak durumuna bağla (offline'da query
  // refetch durur, bağlantı gelince resync). App ömrü boyunca bir kez.
  useEffect(() => {
    setupNetworkManagers();
  }, []);

  useEffect(() => {
    void Promise.all([hydrate(), hydrateSettings()]).finally(() => {
      setHydrated(true);
    });
  }, [hydrate, hydrateSettings]);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <QueryClientProvider client={queryClient}>
          <RealtimeBridge />
          <OfflineBanner />
          {hydrated ? (
            <NavigationContainer>
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                {isAuthenticated ? (
                  <>
                    <Stack.Screen name="Tables" component={TablesScreen} />
                    <Stack.Screen name="Order" component={OrderScreen} />
                    <Stack.Screen name="Settings" component={SettingsScreen} />
                  </>
                ) : (
                  <Stack.Screen name="Login" component={LoginScreen} />
                )}
              </Stack.Navigator>
            </NavigationContainer>
          ) : (
            <View style={{ flex: 1, backgroundColor: colors.background }} />
          )}
        </QueryClientProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
