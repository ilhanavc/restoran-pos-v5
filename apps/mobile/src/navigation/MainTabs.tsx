import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMe } from '../api/client';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { KitchenScreen } from '../screens/KitchenScreen';
import { SalesScreen } from '../screens/SalesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TablesScreen } from '../screens/TablesScreen';
import { useAuthStore } from '../store/auth';
import { useCanSeeRevenue } from '../store/permissions';
import { colors, minTouchTarget, spacing, typography } from '../theme';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/** Ionicons `name` union'ı — literal string yerine kütüphanenin kendi tipi. */
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Sekme ikonu üreticisi. Aktif durumda DOLU, pasif durumda OUTLINE varyant
 * kullanılır: aktiflik yalnız renkle anlatılmaz (ADR-026 Amd5 K10 —
 * renk-körlüğü + parlak güneşte okunabilirlik).
 */
function tabIcon(outline: IoniconName, filled: IoniconName) {
  return function TabIcon({
    color,
    size,
    focused,
  }: {
    color: string;
    size: number;
    focused: boolean;
  }): React.JSX.Element {
    return (
      <Ionicons name={focused ? filled : outline} size={size} color={color} />
    );
  };
}

/**
 * Sekme etiketi — etiketler HER ZAMAN görünür (yalnız-ikon yasak, K10: garson
 * eğitimsiz kullanır, tanınırlık > hatırlama) ve aktif sekmede yazı ağırlığı
 * da artar (rengin ikinci ayırt edicisi). Metin `children` ile gelir (ekranın
 * `title` option'ı) → tek, kimliği sabit bileşen; her render'da yenisi
 * üretilmez.
 */
function TabLabel({
  color,
  focused,
  children,
}: {
  color: string;
  focused: boolean;
  children: string;
}): React.JSX.Element {
  return (
    <Text
      numberOfLines={1}
      style={[styles.label, { color }, focused && styles.labelActive]}
    >
      {children}
    </Text>
  );
}

// Kimlikleri sabit ikon bileşenleri (modül seviyesinde bir kez üretilir).
const TablesIcon = tabIcon('grid-outline', 'grid');
const SalesIcon = tabIcon('cash-outline', 'cash');
const KitchenIcon = tabIcon('restaurant-outline', 'restaurant');
const SettingsIcon = tabIcon('settings-outline', 'settings');

/**
 * Sekme kabuğu (ADR-026 Amendment 5 K1/K2/K4/K10).
 *
 * Masalar · Satış · Mutfak · Ayarlar; açılış sekmesi **Masalar**. `Order`
 * bilinçli olarak sekme çubuğunun DIŞINDA (root stack) kalır — sipariş
 * alırken tam ekran odak, yanlışlıkla sekme değiştirip sepetten çıkma riski
 * yok (K2).
 *
 * **Rol-reaktif sekme listesi (K1):** Satış yalnız `admin`/`cashier` için
 * KAYITLIDIR — yetkisiz rolde ekran hiç mount edilmez, dolayısıyla isteği de
 * atılmaz. Rol `useCanSeeRevenue()` (zustand selector) ile okunur; açılışta
 * profil `null` olup sonradan dolabildiği için (SecureStore hidrasyonu ya da
 * `GET /auth/me` tazelemesi) liste bir anlık görüntüye DONMAZ, rol geldiğinde
 * bu bileşen yeniden render edilip sekme belirir. Aynı tuzak S105'te ciro
 * rozetinde yaşanmıştı (#489).
 */
export function MainTabs(): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const canSeeRevenue = useCanSeeRevenue();

  const currentUser = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const setUser = useAuthStore((state) => state.setUser);

  // S105 — profil boşsa sunucudan tazele. İki durumu kapatır: (1) S105 ÖNCESİ
  // kurulmuş oturumlarda profil hiç saklanmamıştı, (2) rol sonradan
  // değişmişse güncel gelsin. Kabuk seviyesinde durur (eskiden TablesScreen'de
  // idi) çünkü artık SEKME LİSTESİ bu profile bağlı. Best-effort: ağ yoksa
  // sessizce geçilir, uygulama çalışmaya devam eder (rol bilinmezken yalnız
  // rol-korumalı sekme gizli kalır — güvenli yön).
  useEffect(() => {
    if (!isAuthenticated || currentUser !== null) return;
    let cancelled = false;
    void getMe()
      .then((me) => {
        if (!cancelled) void setUser(me);
      })
      .catch(() => {
        /* profil tazelenemedi — rol-korumalı sekme gizli kalır */
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, currentUser, setUser]);

  return (
    <View style={styles.shell}>
      {/* K4 — bağlantı bandı TEK yerde: dört sekmede de geçerli. */}
      <ConnectionBanner />
      <Tab.Navigator
        initialRouteName="Tables"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textSecondary,
          // K10 — çubuk yüksekliği >= minTouchTarget (52pt) + alt güvenli alan.
          // Kütüphane `paddingBottom: insets.bottom`'ı kendisi ekler; burada
          // yalnız toplam yükseklik verilir → içerik alanı tam 52pt kalır.
          // TUZAK: sekme-içi ekranlar bu yüzden `edges` listesinden 'bottom'u
          // ÇIKARIR (aksi halde çift boşluk).
          tabBarStyle: {
            height: minTouchTarget + insets.bottom,
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
          tabBarItemStyle: styles.item,
        }}
      >
        <Tab.Screen
          name="Tables"
          component={TablesScreen}
          options={{
            title: t('nav.tables'),
            tabBarLabel: TabLabel,
            tabBarIcon: TablesIcon,
          }}
        />
        {/* Yetkisiz rolde sekme HİÇ kayıtlı değildir (K1). */}
        {canSeeRevenue ? (
          <Tab.Screen
            name="Sales"
            component={SalesScreen}
            options={{
              title: t('nav.sales'),
              tabBarLabel: TabLabel,
              tabBarIcon: SalesIcon,
            }}
          />
        ) : null}
        <Tab.Screen
          name="Kitchen"
          component={KitchenScreen}
          options={{
            title: t('nav.kitchen'),
            tabBarLabel: TabLabel,
            tabBarIcon: KitchenIcon,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: t('nav.settings'),
            tabBarLabel: TabLabel,
            tabBarIcon: SettingsIcon,
          }}
        />
      </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  item: {
    paddingVertical: spacing.xs,
  },
  label: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
  },
  labelActive: {
    fontWeight: '800',
  },
});
