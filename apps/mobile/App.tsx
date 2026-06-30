import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import './src/i18n/init';
import { queryClient } from './src/api/queryClient';
import type { RootStackParamList } from './src/navigation/types';
import { connectSocket, disconnectSocket } from './src/realtime/socket';
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
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    };
    socket.on('orders.created', invalidate);
    socket.on('orders.cancelled', invalidate);
    socket.on('orders.statusChanged', invalidate);
    return () => {
      socket.off('orders.created', invalidate);
      socket.off('orders.cancelled', invalidate);
      socket.off('orders.statusChanged', invalidate);
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
