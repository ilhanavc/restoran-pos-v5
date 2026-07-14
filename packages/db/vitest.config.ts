import { defineConfig } from 'vitest/config';

/**
 * Session 53d fix: pool=threads + fileParallelism=false — apps/api ile aynı
 * disiplin (apps/api/vitest.config.ts).
 *
 * - `pool: 'threads'`: forks pool Node 22 + Windows'ta DATABASE_URL'i worker
 *   fork'a propagate edemiyor (testler `describe.skipIf` ile sessizce skip
 *   oluyordu). worker_threads tabanlı `process.env` paylaşımı.
 * - `fileParallelism: false`: integration test'ler (refresh-tokens, tables,
 *   users) aynı paylaşılan postgres'e yazıyor; tenants fixture'ları aynı
 *   `name: 'Test Tenant'` üzerinden aynı `slug`'ı üretiyor → paralel
 *   `tenants_slug_key` UNIQUE çakışması. Sıralı çalıştırma + afterAll DELETE
 *   ile çakışma elenir. Süre artışı kabul edilebilir (3 dosya, ~5 sn).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: 'threads',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/generated.ts'],
    },
  },
});
