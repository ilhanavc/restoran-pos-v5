import { createBrowserRouter, Navigate } from 'react-router-dom';
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
const UsersPage = lazy(() => import('./features/admin/UsersPage'));
const OrderScreenPage = lazy(() => import('./features/orders/OrderScreenPage'));
const CustomersPage = lazy(() => import('./features/customers/CustomersPage'));
const CustomerDetailPage = lazy(() => import('./features/customers/CustomerDetailPage'));

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <Suspense fallback={<LoadingSkeleton />}>
        <LoginPage />
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
          <OrderScreenPage />
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
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  { path: '*', element: <Navigate to="/login" replace /> },
]);
