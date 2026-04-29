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
  build: {
    target: 'es2022',
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 350,
  },
});
