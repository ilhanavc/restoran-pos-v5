import { defineConfig } from 'vitest/config';

/**
 * apps/web unit test yapılandırması (ADR-037 K9 drift kilidi ile geldi).
 *
 * `e2e/` DIŞLANIR: orada Playwright spec'leri yaşar (`playwright.config.ts`),
 * vitest onları toplarsa `test.use() ... did not expect` hatasıyla patlar.
 * İki koşucu ayrı kalır: `pnpm test` = vitest (unit), `pnpm e2e` = Playwright.
 *
 * `environment: 'node'` — mevcut unit testler saf TS/JSON doğrulaması yapar;
 * DOM gerekirse (jsdom) ayrıca eklenir.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
