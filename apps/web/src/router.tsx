import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoadingSkeleton } from './components/LoadingSkeleton';

const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const TablesListPage = lazy(() => import('./features/tables/TablesListPage'));
const MenuDefinitionsPage = lazy(() => import('./features/admin/MenuDefinitionsPage'));
const DiningAreasPage = lazy(() => import('./features/admin/DiningAreasPage'));
const AttributeGroupsPage = lazy(() => import('./features/admin/AttributeGroupsPage'));

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
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  { path: '*', element: <Navigate to="/login" replace /> },
]);
