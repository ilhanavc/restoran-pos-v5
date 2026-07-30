import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { router } from './router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthBootstrapGate } from './components/AuthBootstrapGate';

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
        <AuthBootstrapGate>
          <RouterProvider router={router} />
          {/* Canlı bug (2026-07-30, kullanıcı gözlemi) — Radix Dialog açıkken
              `<body>`e `pointer-events:none` uygular (modal-dışı her şeyi
              etkileşimsiz kılmak için); Sonner'ın toast konteyneri body'nin
              bir kardeşi olduğundan bunu miras alır → toast görünür ama
              kapatma butonu tıklanamaz olur. En çok "Ayrı Ayrı Öde"de fark
              edilir çünkü o modal ödeme sonrası AÇIK kalır (çoğu akışta modal
              toast'tan önce kapanıp body kısıtlaması kalkıyor). Sabit:
              konteynere kendi `pointer-events:auto`'sunu ver — body'den gelen
              `none`'ı ezer, arka plan tıklamalarını etkilemez (yalnız toast
              alanı). */}
          <Toaster
            position="top-right"
            richColors
            closeButton
            style={{ pointerEvents: 'auto' }}
          />
        </AuthBootstrapGate>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
