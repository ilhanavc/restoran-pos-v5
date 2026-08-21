import {
  createBrowserRouter,
  Navigate,
  useLocation,
  type RouteObject,
} from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoadingSkeleton } from './components/LoadingSkeleton';

const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const TablesListPage = lazy(() => import('./features/tables/TablesListPage'));
const MenuDefinitionsPage = lazy(() => import('./features/admin/MenuDefinitionsPage'));
const ProductEditorPage = lazy(() => import('./features/admin/menu-products/ProductEditorPage'));
const DiningAreasPage = lazy(() => import('./features/admin/DiningAreasPage'));
const AttributeGroupsPage = lazy(() => import('./features/admin/AttributeGroupsPage'));
const SettingsPage = lazy(() => import('./features/admin/SettingsPage'));
const PrintersPage = lazy(() => import('./features/admin/PrintersPage'));
const UsersPage = lazy(() => import('./features/admin/UsersPage'));
const AuditLogPage = lazy(() => import('./features/admin/AuditLogPage'));
const OrderScreenPage = lazy(() => import('./features/orders/OrderScreenPage'));
const CustomersPage = lazy(() => import('./features/customers/CustomersPage'));
const CustomerDetailPage = lazy(() => import('./features/customers/CustomerDetailPage'));
const KdsPage = lazy(() => import('./features/kds/KdsPage'));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'));
const PrivacyPolicyPage = lazy(() => import('./features/legal/PrivacyPolicyPage'));

/**
 * Sipariş ekranı route sarmalayıcısı — her navigasyonda TAZE instance garantisi.
 *
 * 🐛 Canlı bug (2026-08-11): masaya kaydedilmemiş ürün eklenmişken Caller ID
 * popup'ından "Sipariş Aç"a basılınca (`/tables/:tableId/order` → `/orders/new`,
 * SPA-içi `navigate()`), yeni paket siparişte önceki masanın sepeti duruyordu.
 *
 * Neden: iki route AYNI `<OrderScreenPage />` elemanını, JSX ağacında AYNI
 * pozisyonda render ediyordu. React reconciliation route path'ine değil eleman
 * TİPİNE bakar → `key` yoksa bunu unmount+remount değil "update" sayar, yani
 * component instance'ı yaşamaya devam eder. Sepet ise Zustand değil düz
 * `useState` (ADR-013 §1 "saf local state", `useOrderCart.ts`), dolayısıyla
 * instance ile birlikte hayatta kalıyordu. Tasarımın varsaydığı "tam sayfa
 * yenileme sepeti sıfırlar" güvencesi SPA navigasyonunda geçerli değil.
 *
 * Çözüm: `useLocation().key` — React Router'ın her history girdisine verdiği
 * benzersiz anahtar. `tableId`/query kombinasyonundan daha genel; şu üç vakayı
 * birden kapatır:
 *   1. masa ↔ masa (farklı `:tableId`)
 *   2. masa ↔ paket (farklı path, aynı component)
 *   3. paket ↔ paket (AYNI `/orders/new` path'i, farklı arayan/query) —
 *      `OpenTakeawayOrdersPanel`'ın `/orders/new?...&orderId=X` navigasyonu da
 *      buraya girer.
 *
 * Güvenli çünkü `OrderScreenPage` URL'i kendisi mutasyona uğratmıyor:
 * `useSearchParams()` yalnız OKUMA olarak kullanılıyor (setter destructure
 * edilmiyor) → ekran kendi altından location.key değiştirip kendini remount
 * ettiremez. Ekran-içi kalan senaryolar için var olan `cart.clear()` çağrıları
 * (kayıt başarısı sonrası) olduğu gibi geçerlidir.
 */
function OrderScreenRoute(): JSX.Element {
  const location = useLocation();
  return <OrderScreenPage key={location.key} />;
}

export const routes: RouteObject[] = [
  {
    path: '/login',
    element: (
      <Suspense fallback={<LoadingSkeleton />}>
        <LoginPage />
      </Suspense>
    ),
  },
  {
    // ADR-031 Amd4 K4 — Gizlilik politikası. HALKA AÇIK: bilerek `ProtectedRoute`
    // DIŞINDA, `/login` ile aynı düzeyde tanımlıdır. App Store ve Google Play
    // inceleme botları bu adrese ANONİM erişir; auth arkasına alınırsa mağaza
    // gönderimi reddedilir. Bu route'a auth/rol gardı EKLENMEZ.
    path: '/privacy',
    element: (
      <Suspense fallback={<LoadingSkeleton />}>
        <PrivacyPolicyPage />
      </Suspense>
    ),
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <DashboardPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/tables',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <TablesListPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/tables/:tableId/order',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <OrderScreenRoute />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/orders/new',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <OrderScreenRoute />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/tanimlamalar/menu-tanimlari',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <MenuDefinitionsPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/tanimlamalar/menu-tanimlari/urun/yeni',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <ProductEditorPage mode="create" />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/tanimlamalar/menu-tanimlari/urun/:id',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <ProductEditorPage mode="edit" />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/tanimlamalar/salon-bolgeleri',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <DiningAreasPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    // ADR-032 Amd2 — yazıcı yönetim ekranı (yalnız admin; backend authorize
    // 403 döner, ProtectedRoute rol gardı ile ekran da kapatılır).
    path: '/tanimlamalar/yazicilar',
    element: (
      <ProtectedRoute requiredRoles={['admin']}>
        <Suspense fallback={<LoadingSkeleton />}>
          <PrintersPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/tanimlamalar/ozellikler',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <AttributeGroupsPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/settings',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <SettingsPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/users',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <UsersPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    // ADR-037 — Denetim Günlüğü (yalnız admin; backend authorize(['admin'])
    // 403 döner, ProtectedRoute rol gardı ile ekran da kapatılır).
    path: '/admin/audit-logs',
    element: (
      <ProtectedRoute requiredRoles={['admin']}>
        <Suspense fallback={<LoadingSkeleton />}>
          <AuditLogPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/customers',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <CustomersPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/customers/:id',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LoadingSkeleton />}>
          <CustomerDetailPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/kds',
    element: (
      <ProtectedRoute requiredRoles={['kitchen', 'admin']}>
        <Suspense fallback={<LoadingSkeleton />}>
          <KdsPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/raporlar',
    element: (
      <ProtectedRoute requiredRoles={['admin', 'cashier']}>
        <Suspense fallback={<LoadingSkeleton />}>
          <ReportsPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  { path: '*', element: <Navigate to="/login" replace /> },
];

export const router = createBrowserRouter(routes);
