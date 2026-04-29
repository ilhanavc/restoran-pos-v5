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
     * Dev proxy: frontend & backend tek origin görünür.
     * SameSite=Strict cookie cross-port ihtilafları önlenir.
     */
    proxy: {
      '/auth': 'http://localhost:3001',
      '/users': 'http://localhost:3001',
      '/menu': 'http://localhost:3001',
      '/products': 'http://localhost:3001',
      '/tables': 'http://localhost:3001',
      '/areas': 'http://localhost:3001',
      '/orders': 'http://localhost:3001',
      '/settings': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
      '/realtime': { target: 'http://localhost:3001', ws: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 350,
  },
});
