import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build target: bundle <300KB gzipped (ADR-011 §10).
 * Code-splitting comes for free via React.lazy in router.tsx; chunk file naming
 * stays default to keep things simple in MVP.
 */
export default defineConfig({
  plugins: [react()],
  envPrefix: 'VITE_',
  server: {
    port: 5173,
    /**
     * Dev proxy: tüm API çağrıları `/api/*` prefix → backend (rewrite).
     * Frontend rotaları (`/tables`, `/dashboard`) prefix'siz, React Router'da
     * kalır — endpoint çakışması YOK.
     * Socket.IO ayrı `/socket.io` (default), ws true ile forward.
     */
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  /**
   * Preview proxy (Sprint 9 E2E, ADR-019): `vite preview` production build
   * serve eder ama `server.proxy`'i KULLANMAZ. E2E için ayrı `preview.proxy`
   * gerekli — yoksa /api/* istekleri 4173'e SPA fallback verir, axios hata.
   * Target env override: lokal `pos_e2e` API farklı portta çalışıyorsa.
   */
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: process.env['VITE_PREVIEW_API_TARGET'] ?? 'http://localhost:4001',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/socket.io': {
        target: process.env['VITE_PREVIEW_API_TARGET'] ?? 'http://localhost:4001',
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 350,
    rollupOptions: {
      output: {
        /**
         * Vendor code-splitting (DD KOD-3). Rota chunk'ları zaten React.lazy ile
         * bölünmüş; buradaki amaç TEK büyük vendor entry chunk'ını (~636KB) uzun
         * ömürlü, ayrı-cache'lenen mantıksal parçalara ayırmak — vendor nadir
         * değişir, uygulama kodu sık değişir → tekrar-indirme azalır.
         * React ekosistemi (react/react-dom/scheduler/router/hook-form) TEK
         * chunk'ta tutulur: context kimliği + import sırası riskini önler.
         * Not: xlsx artık dinamik import (ImportDrawer) → kendi async chunk'ına
         * düşer, burada listelenmesine gerek yok.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // xlsx dinamik import (ImportDrawer) → kendi async chunk'ında kalmalı;
          // elle atama yaparsak eager vendor'a düşer (tree-shake dışı).
          if (id.includes('xlsx')) return undefined;
          if (id.includes('lucide-react')) return 'vendor-icons';
          // ^ kullanılan lucide ikonları (whitelist + statik named) tek paylaşılan
          //   chunk'ta toplanır; namespace-import kaldırıldığı için artık tree-shake
          //   olur (DD KOD-3) — tam set değil yalnız kullanılanlar.
          // Yalnız HER-ZAMAN-AÇIK (eager, uygulama iskeleti) çekirdek kütüphaneleri
          // ayır — uzun ömürlü, ayrı-cache. radix/lucide/sonner/zod GİBİ tree-shake
          // edilebilir barrel'lar elle chunk'lanmaz (aksi halde kullanılmayan
          // export'lar da chunk'a girer; lucide tüm ikon setini getirir) →
          // kullanıldıkları rota/paylaşılan chunk'a doğal tree-shake ile dağılır.
          if (id.includes('@sentry')) return 'vendor-sentry';
          if (id.includes('@tanstack')) return 'vendor-query';
          if (id.includes('socket.io') || id.includes('engine.io')) return 'vendor-socket';
          if (id.includes('i18next')) return 'vendor-i18n';
          if (id.includes('date-fns') || id.includes('react-day-picker')) return 'vendor-date';
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/') ||
            id.includes('react-router') ||
            id.includes('@remix-run')
          ) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
