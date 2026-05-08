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
  },
});
