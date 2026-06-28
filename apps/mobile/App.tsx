import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import './src/i18n/init';
import type { RootStackParamList } from './src/navigation/types';
import { LoginScreen } from './src/screens/LoginScreen';
import { TablesScreen } from './src/screens/TablesScreen';
import { useAuthStore } from './src/store/auth';
import { colors } from './src/theme';

/**
 * Root component (ADR-026 K1/K4).
 *
 * SafeAreaProvider > GestureHandlerRootView > NavigationContainer > native
 * stack. The stack is auth-gated against the Zustand auth store: only the
 * relevant screen is mounted, so a successful login (or logout) swaps the
 * stack with no manual navigation call. On boot we hydrate tokens from
 * secure-store before rendering the gate; until then a plain background fills
 * the screen (light StatusBar content would be invisible on the white body, so
 * we use dark icons).
 */
const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App(): React.JSX.Element {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrate = useAuthStore((state) => state.hydrate);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    void hydrate().finally(() => {
      setHydrated(true);
    });
  }, [hydrate]);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="dark" />
        {hydrated ? (
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              {isAuthenticated ? (
                <Stack.Screen name="Tables" component={TablesScreen} />
              ) : (
                <Stack.Screen name="Login" component={LoginScreen} />
              )}
            </Stack.Navigator>
          </NavigationContainer>
        ) : (
          <View style={{ flex: 1, backgroundColor: colors.background }} />
        )}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
