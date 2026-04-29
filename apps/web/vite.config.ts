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
    proxy: {
      '/health': 'http://localhost:3001',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 350,
  },
});
