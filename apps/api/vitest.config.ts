import { defineConfig } from 'vitest/config';

/**
 * Session 53d fix: `pool: 'threads'` — Vitest 2.x default forks pool child
 * process üretir; bazı Node 22 + Windows kombinasyonlarında parent env
 * (DATABASE_URL vb.) worker fork'a TAMAMI propagate olmuyor (test'ler
 * `describe.skipIf(DB_URL === undefined)` ile sessizce skip oluyor).
 * `threads` worker_threads tabanlıdır ve aynı process'te çalıştığı için
 * `process.env` doğrudan paylaşılır — integration test'ler güvenle koşar.
 *
 * Trade-off: thread isolation (memory leak senaryosu) forks kadar güçlü
 * değil; integration test sürelerimiz (15-20s) için sorun değil.
 *
 * `fileParallelism: false` — integration test'ler tek bir paylaşılan
 * postgres'e yazıyor (CI service container, dev local DB). Paralel
 * dosya çalıştırma worker thread'ler arası INSERT/DELETE race üretir
 * (örn. reports.test.ts toplam revenue, recent-orders open count
 * sızıntıları). Test dosyaları sıralı, içlerindeki `it()` blokları
 * yine paralel; süre artışı kabul edilebilir (~+3-5 sn).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: 'threads',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
