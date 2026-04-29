import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { router } from './router';
import { ErrorBoundary } from './components/ErrorBoundary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors closeButton />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
